"""Postgres-backed Mongo-compatible collections for Tally."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Iterator

import httpx
from bson import ObjectId
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from psycopg.errors import UniqueViolation

from pg_query import (
    aggregate as run_aggregate,
    apply_update,
    compile_query,
    doc_id,
    fmt_dt,
    from_jsonable,
    match_doc,
    NUMERIC_SORT_FIELDS,
    project_doc,
    sort_docs,
    to_jsonable,
)

try:
    from pymongo import ReturnDocument
    from pymongo.errors import DuplicateKeyError
except ImportError:  # pragma: no cover
    class ReturnDocument:
        BEFORE = False
        AFTER = True

    class DuplicateKeyError(Exception):
        pass


DESCENDING = -1
ASCENDING = 1
DOCS_TABLE = "public.docs"


@dataclass
class InsertOneResult:
    inserted_id: Any


@dataclass
class InsertManyResult:
    inserted_ids: list[Any]


@dataclass
class UpdateResult:
    matched_count: int
    modified_count: int
    upserted_id: Any = None


@dataclass
class DeleteResult:
    deleted_count: int


def _as_sort(sort: Any) -> list[tuple[str, int]] | None:
    if not sort:
        return None
    if isinstance(sort, str):
        return [(sort, 1)]
    if isinstance(sort, tuple) and len(sort) == 2 and isinstance(sort[0], str):
        return [(sort[0], int(sort[1]))]
    if isinstance(sort, list):
        out: list[tuple[str, int]] = []
        for item in sort:
            if isinstance(item, tuple):
                out.append((str(item[0]), int(item[1])))
            else:
                out.append((str(item), 1))
        return out
    return None


def _index_ident(collection: str, keys: list[tuple[str, int]], unique: bool) -> str:
    bits = [collection] + [f"{name}_{'1' if direction >= 0 else 'm1'}" for name, direction in keys]
    prefix = "uq_" if unique else "ix_"
    ident = prefix + "_".join(bits)
    return ident[:63]


def _rest_literal(value: Any) -> str:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return fmt_dt(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    text = str(value)
    if any(ch in text for ch in ",() ") or text == "":
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _rest_field(field: str) -> str:
    if field in {"_id", "id"}:
        return "id"
    if field == "user_id":
        return "user_id"
    return f"doc->>{field}"


def _sql_field(field: str) -> str:
    if field in {"_id", "id"}:
        return "id"
    if field == "user_id":
        return "user_id"
    return f"(doc->>'{field}')"


def _ilike_sql(pattern: str) -> str:
    parts = str(pattern).split("*")
    escaped = [
        part.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") for part in parts
    ]
    return "%".join(escaped)


def _order_rest(sort: list[tuple[str, int]] | None) -> str | None:
    if not sort:
        return None
    bits: list[str] = []
    for field, direction in sort:
        if not field.replace("_", "").isalnum():
            return None
        suffix = "desc" if direction < 0 else "asc"
        if field in NUMERIC_SORT_FIELDS:
            bits.append(f"doc->{field}.{suffix}")
        elif field in {"_id", "id"}:
            bits.append(f"id.{suffix}")
        elif field == "user_id":
            bits.append(f"user_id.{suffix}")
        else:
            bits.append(f"doc->>{field}.{suffix}.nullslast")
    return ",".join(bits)


def _order_sql(sort: list[tuple[str, int]] | None) -> str | None:
    if not sort:
        return None
    bits: list[str] = []
    for field, direction in sort:
        if not field.replace("_", "").isalnum():
            return None
        suffix = "DESC" if direction < 0 else "ASC"
        if field in NUMERIC_SORT_FIELDS:
            bits.append(f"(doc->>'{field}')::numeric {suffix} NULLS LAST")
        else:
            bits.append(f"{_sql_field(field)} {suffix} NULLS LAST")
    return ", ".join(bits)


def _pred_sql(pred: Any) -> tuple[str, list[Any]]:
    col = _sql_field(pred.field)
    op = pred.op
    if op == "eq":
        if pred.value is None:
            return f" AND {col} IS NULL", []
        return f" AND {col} = %s", [str(pred.value) if not isinstance(pred.value, (datetime, bool)) else pred.value]
    if op == "neq":
        if pred.value is None:
            return f" AND {col} IS NOT NULL", []
        return f" AND ({col} IS NULL OR {col} <> %s)", [_rest_literal(pred.value).strip('"')]
    if op == "in":
        values = [str(v) for v in pred.value]
        return f" AND {col} = ANY(%s)", [values]
    if op == "ilike":
        return f" AND {col} ILIKE %s ESCAPE '\\'", [_ilike_sql(pred.value)]
    mapped = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
    raw = pred.value
    if isinstance(raw, datetime):
        raw = fmt_dt(raw)
    return f" AND {col} {mapped} %s", [str(raw)]


def _sql_predicates(compiled: Any) -> tuple[str, list[Any]]:
    sql = ""
    params: list[Any] = []
    for pred in compiled.predicates:
        chunk, chunk_params = _pred_sql(pred)
        sql += chunk
        params.extend(chunk_params)
    for group in compiled.or_groups:
        parts: list[str] = []
        for pred in group:
            chunk, chunk_params = _pred_sql(pred)
            parts.append(chunk.removeprefix(" AND "))
            params.extend(chunk_params)
        if parts:
            sql += " AND (" + " OR ".join(parts) + ")"
    return sql, params


def _rest_pred(pred: Any) -> tuple[str, str]:
    key = _rest_field(pred.field)
    op = pred.op
    if op == "eq":
        if pred.value is None:
            return key, "is.null"
        return key, f"eq.{_rest_literal(pred.value)}"
    if op == "neq":
        if pred.value is None:
            return key, "not.is.null"
        return key, f"neq.{_rest_literal(pred.value)}"
    if op == "in":
        joined = ",".join(_rest_literal(v) for v in pred.value)
        return key, f"in.({joined})"
    if op == "ilike":
        return key, f"ilike.{_rest_literal(pred.value)}"
    return key, f"{op}.{_rest_literal(pred.value)}"


def _rest_or_group(group: list[Any]) -> str:
    bits: list[str] = []
    for pred in group:
        key, expr = _rest_pred(pred)
        bits.append(f"{key}.{expr}")
    return "(" + ",".join(bits) + ")"


class Cursor:
    def __init__(
        self,
        collection: "Collection",
        query: dict[str, Any] | None,
        projection: dict[str, Any] | None,
    ) -> None:
        self._collection = collection
        self._query = query or {}
        self._projection = projection
        self._sort: list[tuple[str, int]] | None = None
        self._skip = 0
        self._limit = 0

    def sort(self, key_or_list: Any, direction: int | None = None) -> "Cursor":
        if direction is not None:
            self._sort = [(str(key_or_list), int(direction))]
        else:
            self._sort = _as_sort(key_or_list)
        return self

    def skip(self, n: int) -> "Cursor":
        self._skip = int(n or 0)
        return self

    def limit(self, n: int) -> "Cursor":
        self._limit = int(n or 0)
        return self

    def _rows(self) -> list[dict[str, Any]]:
        docs = self._collection._load(
            self._query,
            sort=self._sort,
            skip=self._skip,
            limit=self._limit,
        )
        if self._projection:
            docs = [project_doc(d, self._projection) for d in docs]
        return docs

    def __iter__(self) -> Iterator[dict[str, Any]]:
        return iter(self._rows())

    def __list__(self) -> list[dict[str, Any]]:  # pragma: no cover
        return self._rows()


class Collection:
    def __init__(self, client: "PostgresMongoClient", name: str) -> None:
        self._client = client
        self.name = name

    def _decode_row(self, raw: Any) -> dict[str, Any]:
        payload = raw if isinstance(raw, dict) else dict(raw)
        return from_jsonable(payload)

    def _load(
        self,
        query: dict[str, Any] | None,
        *,
        sort: list[tuple[str, int]] | None = None,
        skip: int = 0,
        limit: int = 0,
    ) -> list[dict[str, Any]]:
        query = query or {}
        compiled = compile_query(query)
        order_ok = (not sort) or (_order_rest(sort) is not None and _order_sql(sort) is not None)
        push_page = bool(compiled.complete and order_ok and (sort or skip or limit))
        if getattr(self._client, "backend", "sql") == "rest":
            rows = self._client._select(
                self.name,
                compiled,
                sort=sort if push_page else None,
                skip=skip if push_page else 0,
                limit=limit if push_page else 0,
            )
            docs = [self._decode_row(row) for row in rows]
        else:
            docs = self._sql_select(
                compiled,
                sort=sort if push_page else None,
                skip=skip if push_page else 0,
                limit=limit if push_page else 0,
            )
        if not compiled.complete:
            docs = [d for d in docs if match_doc(d, query)]
            docs = sort_docs(docs, sort)
            if skip:
                docs = docs[skip:]
            if limit and limit > 0:
                docs = docs[:limit]
            return docs
        return docs

    def _sql_select(
        self,
        compiled: Any,
        *,
        sort: list[tuple[str, int]] | None,
        skip: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        sql = f"SELECT doc FROM {DOCS_TABLE} WHERE collection = %s"
        params: list[Any] = [self.name]
        extra_sql, extra_params = _sql_predicates(compiled)
        sql += extra_sql
        params.extend(extra_params)
        order = _order_sql(sort)
        if order:
            sql += f" ORDER BY {order}"
        if limit and limit > 0:
            sql += " LIMIT %s"
            params.append(int(limit))
        if skip:
            sql += " OFFSET %s"
            params.append(int(skip))
        with self._client.pool.connection() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._decode_row(row[0]) for row in rows]

    def _encoded(self, doc: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        stored = dict(doc)
        ident = doc_id(stored)
        stored["_id"] = stored.get("_id", ident)
        encoded = to_jsonable(stored)
        encoded["_id"] = str(ident)
        return encoded["_id"], encoded

    def _insert_row(self, conn: Any, doc: dict[str, Any]) -> None:
        ident, encoded = self._encoded(doc)
        if conn is None:
            self._client._upsert(self.name, ident, encoded, merge=False)
            return
        conn.execute(
            """
            INSERT INTO public.docs (collection, id, doc)
            VALUES (%s, %s, %s)
            """,
            (self.name, ident, Jsonb(encoded)),
        )

    def _replace_row(self, conn: Any, doc: dict[str, Any]) -> None:
        ident, encoded = self._encoded(doc)
        if conn is None:
            self._client._upsert(self.name, ident, encoded, merge=True)
            return
        conn.execute(
            """
            INSERT INTO public.docs (collection, id, doc)
            VALUES (%s, %s, %s)
            ON CONFLICT (collection, id) DO UPDATE
            SET doc = EXCLUDED.doc
            """,
            (self.name, ident, Jsonb(encoded)),
        )

    def find(
        self,
        filter: dict[str, Any] | None = None,
        projection: dict[str, Any] | None = None,
        sort: Any = None,
        skip: int = 0,
        limit: int = 0,
    ) -> Cursor:
        cur = Cursor(self, filter, projection)
        if sort:
            cur.sort(sort)
        if skip:
            cur.skip(skip)
        if limit:
            cur.limit(limit)
        return cur

    def find_one(
        self,
        filter: dict[str, Any] | None = None,
        projection: dict[str, Any] | None = None,
        sort: Any = None,
    ) -> dict[str, Any] | None:
        cur = self.find(filter, projection=projection, sort=sort, limit=1)
        rows = cur._rows()
        return rows[0] if rows else None

    def _is_rest(self) -> bool:
        return getattr(self._client, "backend", "sql") == "rest"

    def insert_one(self, document: dict[str, Any]) -> InsertOneResult:
        doc = dict(document)
        if "_id" not in doc:
            doc["_id"] = ObjectId()
        try:
            if self._is_rest():
                self._insert_row(None, doc)
            else:
                with self._client.pool.connection() as conn:
                    self._insert_row(conn, doc)
        except UniqueViolation as exc:
            raise DuplicateKeyError(str(exc)) from exc
        document["_id"] = doc["_id"]
        return InsertOneResult(inserted_id=doc["_id"])

    def insert_many(self, documents: Iterable[dict[str, Any]], ordered: bool = True) -> InsertManyResult:
        ids: list[Any] = []
        try:
            if self._is_rest():
                for raw in documents:
                    doc = dict(raw)
                    if "_id" not in doc:
                        doc["_id"] = ObjectId()
                    self._insert_row(None, doc)
                    raw["_id"] = doc["_id"]
                    ids.append(doc["_id"])
            else:
                with self._client.pool.connection() as conn:
                    with conn.transaction():
                        for raw in documents:
                            doc = dict(raw)
                            if "_id" not in doc:
                                doc["_id"] = ObjectId()
                            self._insert_row(conn, doc)
                            raw["_id"] = doc["_id"]
                            ids.append(doc["_id"])
        except UniqueViolation as exc:
            raise DuplicateKeyError(str(exc)) from exc
        return InsertManyResult(inserted_ids=ids)

    def _update(
        self,
        query: dict[str, Any],
        update: dict[str, Any],
        *,
        upsert: bool,
        many: bool,
        return_document: Any = None,
    ) -> tuple[UpdateResult, dict[str, Any] | None]:
        matched = self._load(query)
        modified = 0
        returned: dict[str, Any] | None = None
        before: dict[str, Any] | None = None

        def persist(doc: dict[str, Any], conn: Any) -> None:
            self._replace_row(conn, doc)

        if matched:
            targets = matched if many else matched[:1]
            if self._is_rest():
                for doc in targets:
                    before = dict(doc)
                    nxt = apply_update(doc, update, is_insert=False)
                    if to_jsonable(nxt) != to_jsonable(doc):
                        modified += 1
                    persist(nxt, None)
                    returned = nxt
            else:
                with self._client.pool.connection() as conn:
                    with conn.transaction():
                        for doc in targets:
                            before = dict(doc)
                            nxt = apply_update(doc, update, is_insert=False)
                            if to_jsonable(nxt) != to_jsonable(doc):
                                modified += 1
                            persist(nxt, conn)
                            returned = nxt
            want_before = return_document in {ReturnDocument.BEFORE, False}
            return (
                UpdateResult(matched_count=len(targets), modified_count=modified),
                before if want_before else returned,
            )
        if not upsert:
            return UpdateResult(matched_count=0, modified_count=0), None
        base = {
            k: v
            for k, v in query.items()
            if not str(k).startswith("$") and not isinstance(v, dict)
        }
        inserted = apply_update(base, update, is_insert=True)
        if "_id" not in inserted:
            inserted["_id"] = ObjectId()
        if self._is_rest():
            persist(inserted, None)
        else:
            with self._client.pool.connection() as conn:
                persist(inserted, conn)
        return (
            UpdateResult(matched_count=0, modified_count=0, upserted_id=inserted["_id"]),
            inserted,
        )

    def update_one(
        self,
        filter: dict[str, Any],
        update: dict[str, Any],
        upsert: bool = False,
    ) -> UpdateResult:
        result, _ = self._update(filter, update, upsert=upsert, many=False)
        return result

    def update_many(
        self,
        filter: dict[str, Any],
        update: dict[str, Any],
        upsert: bool = False,
    ) -> UpdateResult:
        result, _ = self._update(filter, update, upsert=upsert, many=True)
        return result

    def find_one_and_update(
        self,
        filter: dict[str, Any],
        update: dict[str, Any],
        *,
        return_document: Any = None,
        upsert: bool = False,
    ) -> dict[str, Any] | None:
        _, doc = self._update(
            filter,
            update,
            upsert=upsert,
            many=False,
            return_document=return_document if return_document is not None else ReturnDocument.BEFORE,
        )
        return doc

    def delete_one(self, filter: dict[str, Any]) -> DeleteResult:
        matched = self._load(filter)
        if not matched:
            return DeleteResult(deleted_count=0)
        ident = str(matched[0]["_id"])
        if self._is_rest():
            self._client._delete(self.name, [ident])
        else:
            with self._client.pool.connection() as conn:
                conn.execute(
                    "DELETE FROM {table} WHERE collection = %s AND id = %s".format(table=DOCS_TABLE),
                    (self.name, ident),
                )
        return DeleteResult(deleted_count=1)

    def delete_many(self, filter: dict[str, Any]) -> DeleteResult:
        matched = self._load(filter)
        if not matched:
            return DeleteResult(deleted_count=0)
        ids = [str(d["_id"]) for d in matched]
        if self._is_rest():
            self._client._delete(self.name, ids)
        else:
            with self._client.pool.connection() as conn:
                conn.execute(
                    f"DELETE FROM {DOCS_TABLE} WHERE collection = %s AND id = ANY(%s)",
                    (self.name, ids),
                )
        return DeleteResult(deleted_count=len(ids))

    def count_documents(self, filter: dict[str, Any] | None = None) -> int:
        compiled = compile_query(filter or {})
        if compiled.complete:
            if self._is_rest():
                return self._client._count(self.name, compiled)
            extra_sql, extra_params = _sql_predicates(compiled)
            with self._client.pool.connection() as conn:
                row = conn.execute(
                    f"SELECT COUNT(*) FROM {DOCS_TABLE} WHERE collection = %s{extra_sql}",
                    [self.name, *extra_params],
                ).fetchone()
            return int(row[0] if row else 0)
        return len(self._load(filter))

    def estimated_document_count(self) -> int:
        if self._is_rest():
            return self._client._count(self.name)
        with self._client.pool.connection() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) FROM {DOCS_TABLE} WHERE collection = %s",
                (self.name,),
            ).fetchone()
        return int(row[0] if row else 0)

    def aggregate(self, pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
        match: dict[str, Any] | None = None
        rest = list(pipeline)
        if rest and "$match" in rest[0]:
            match = rest[0]["$match"]
            rest = rest[1:]
        docs = self._load(match)
        return run_aggregate(docs, rest)

    def create_index(
        self,
        keys: Any,
        unique: bool = False,
        sparse: bool = False,
        **kwargs: Any,
    ) -> str:
        if isinstance(keys, str):
            pairs = [(keys, 1)]
        else:
            pairs = [(str(k), int(d)) for k, d in keys]
        for field, _direction in pairs:
            if not field.replace("_", "").isalnum():
                raise ValueError(f"Invalid index field: {field}")
        name = _index_ident(self.name, pairs, unique)
        cols = ", ".join(f"(doc->>'{k}')" for k, _ in pairs)
        unique_sql = "UNIQUE " if unique else ""
        where = [f"collection = '{self.name}'"]
        if sparse:
            first = pairs[0][0]
            where.append(f"COALESCE(doc->>'{first}', '') <> ''")
        sql = (
            f"CREATE {unique_sql}INDEX IF NOT EXISTS {name} "
            f"ON {DOCS_TABLE} ({cols}) WHERE {' AND '.join(where)}"
        )
        if self._is_rest():
            return name
        try:
            with self._client.pool.connection() as conn:
                conn.execute(sql)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: create_index {name} skipped: {exc}")
        return name

    def drop_index(self, name: str) -> None:
        if self._is_rest():
            return
        ident = name.replace("-", "_")
        try:
            with self._client.pool.connection() as conn:
                conn.execute(f"DROP INDEX IF EXISTS public.{ident}")
        except Exception:
            return


class PostgresMongoClient:
    backend = "sql"

    def __init__(self, conninfo: str) -> None:
        self.pool = ConnectionPool(
            conninfo=conninfo,
            min_size=1,
            max_size=8,
            kwargs={"autocommit": True, "prepare_threshold": None},
            open=True,
        )
        self._dbs: dict[str, "PostgresDatabase"] = {}

    def __getitem__(self, name: str) -> "PostgresDatabase":
        if name not in self._dbs:
            self._dbs[name] = PostgresDatabase(self)
        return self._dbs[name]

    def close(self) -> None:
        self.pool.close()


class PostgresDatabase:
    def __init__(self, client: PostgresMongoClient | "SupabaseRestClient") -> None:
        self._client = client
        self._cols: dict[str, Collection] = {}

    def __getitem__(self, name: str) -> Collection:
        if name not in self._cols:
            self._cols[name] = Collection(self._client, name)
        return self._cols[name]


class SupabaseRestClient:
    """Mongo-compatible store over PostgREST using the project secret key."""

    backend = "rest"
    table = "docs"

    def __init__(self, url: str, secret_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.http = httpx.Client(
            timeout=60.0,
            limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
            headers={
                "apikey": secret_key,
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/json",
            },
        )
        self._dbs: dict[str, PostgresDatabase] = {}

    def __getitem__(self, name: str) -> PostgresDatabase:
        if name not in self._dbs:
            self._dbs[name] = PostgresDatabase(self)
        return self._dbs[name]

    def close(self) -> None:
        self.http.close()

    def _raise(self, resp: httpx.Response) -> None:
        if resp.status_code == 409:
            raise DuplicateKeyError(resp.text)
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase REST {resp.status_code}: {resp.text[:500]}")

    def _filter_params(self, collection: str, compiled: Any) -> list[tuple[str, str]]:
        params: list[tuple[str, str]] = [("collection", f"eq.{collection}")]
        for pred in compiled.predicates:
            params.append(_rest_pred(pred))
        for group in compiled.or_groups:
            params.append(("or", _rest_or_group(group)))
        return params

    def _select(
        self,
        collection: str,
        compiled: Any,
        *,
        sort: list[tuple[str, int]] | None = None,
        skip: int = 0,
        limit: int = 0,
    ) -> list[dict[str, Any]]:
        params: list[tuple[str, str]] = [("select", "doc"), *self._filter_params(collection, compiled)]
        order = _order_rest(sort)
        if order:
            params.append(("order", order))
        out: list[dict[str, Any]] = []
        start = max(int(skip), 0)
        page = int(limit) if limit and limit > 0 else 1000
        while True:
            resp = self.http.get(
                f"{self.base}/{self.table}",
                params=params,
                headers={"Range": f"{start}-{start + page - 1}"},
            )
            self._raise(resp)
            rows = resp.json()
            out.extend(r.get("doc") for r in rows if r.get("doc") is not None)
            if (limit and limit > 0) or len(rows) < page:
                break
            start += page
        return out

    def _count(self, collection: str, compiled: Any | None = None) -> int:
        compiled = compiled if compiled is not None else compile_query({})
        params: list[tuple[str, str]] = [("select", "id"), *self._filter_params(collection, compiled)]
        resp = self.http.get(
            f"{self.base}/{self.table}",
            params=params,
            headers={"Range": "0-0", "Prefer": "count=exact"},
        )
        self._raise(resp)
        cr = resp.headers.get("content-range") or ""
        if "/" in cr:
            total = cr.split("/")[-1]
            if total.isdigit():
                return int(total)
        return 0

    def _upsert(self, collection: str, ident: str, encoded: dict[str, Any], *, merge: bool) -> None:
        payload = {
            "collection": collection,
            "id": ident,
            "doc": encoded,
            "user_id": encoded.get("user_id"),
        }
        prefer = "return=minimal"
        url = f"{self.base}/{self.table}"
        if merge:
            prefer += ",resolution=merge-duplicates"
            resp = self.http.post(
                url,
                params={"on_conflict": "collection,id"},
                json=payload,
                headers={"Prefer": prefer},
            )
        else:
            resp = self.http.post(url, json=payload, headers={"Prefer": prefer})
        self._raise(resp)

    def _delete(self, collection: str, ids: list[str]) -> None:
        if not ids:
            return
        joined = ",".join(ids)
        resp = self.http.delete(
            f"{self.base}/{self.table}",
            params={"collection": f"eq.{collection}", "id": f"in.({joined})"},
        )
        self._raise(resp)

    def _upsert_batch(self, collection: str, docs: list[dict[str, Any]]) -> None:
        if not docs:
            return
        payload = []
        for encoded in docs:
            ident = str(encoded.get("_id"))
            payload.append(
                {
                    "collection": collection,
                    "id": ident,
                    "doc": encoded,
                    "user_id": encoded.get("user_id"),
                }
            )
        resp = self.http.post(
            f"{self.base}/{self.table}",
            params={"on_conflict": "collection,id"},
            json=payload,
            headers={"Prefer": "return=minimal,resolution=merge-duplicates"},
        )
        self._raise(resp)
