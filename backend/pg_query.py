"""In-Python Mongo query + aggregation helpers used by the Postgres store."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId

_ISO_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
OID_KEYS = {"_id", "user_id", "linked_account_id", "txn_id", "primary_user_id"}
_MISSING = object()


def fmt_dt(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    ms = int(value.microsecond / 1000)
    return value.strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"


def parse_dt(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return fmt_dt(value)
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def from_jsonable(value: Any, *, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {k: from_jsonable(v, key=k) for k, v in value.items()}
    if isinstance(value, list):
        return [from_jsonable(v, key=key) for v in value]
    if isinstance(value, str):
        if key in OID_KEYS and ObjectId.is_valid(value) and len(value) == 24:
            return ObjectId(value)
        if _ISO_RE.match(value):
            return parse_dt(value)
    return value


def doc_id(doc: dict[str, Any] | None) -> str:
    if not doc or "_id" not in doc:
        return str(ObjectId())
    value = doc["_id"]
    if isinstance(value, ObjectId):
        return str(value)
    return str(value)


def _cmp_key(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return fmt_dt(value)
    return value


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _values_equal(left: Any, right: Any) -> bool:
    if left is None and right is None:
        return True
    ln = _as_number(left)
    rn = _as_number(right)
    if ln is not None and rn is not None:
        return ln == rn
    return _cmp_key(left) == _cmp_key(right)


def _values_ordered(left: Any, right: Any) -> tuple[Any, Any] | None:
    ln = _as_number(left)
    rn = _as_number(right)
    if ln is not None and rn is not None:
        return ln, rn
    if isinstance(left, datetime) or isinstance(right, datetime):
        try:
            ldt = left if isinstance(left, datetime) else parse_dt(str(left))
            rdt = right if isinstance(right, datetime) else parse_dt(str(right))
            return fmt_dt(ldt), fmt_dt(rdt)
        except (TypeError, ValueError):
            return None
    if isinstance(left, str) and isinstance(right, str):
        return left, right
    if isinstance(left, datetime) and isinstance(right, str):
        return fmt_dt(left), right
    if isinstance(left, str) and isinstance(right, datetime):
        return left, fmt_dt(right)
    return _cmp_key(left), _cmp_key(right)


def get_path(doc: dict[str, Any], path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _match_regex(value: Any, pattern: str, options: str) -> bool:
    if value is None:
        return False
    flags = 0
    if "i" in options:
        flags |= re.IGNORECASE
    if "m" in options:
        flags |= re.MULTILINE
    if "s" in options:
        flags |= re.DOTALL
    try:
        return re.search(pattern, str(value), flags) is not None
    except re.error:
        return False


def _match_op(value: Any, spec: dict[str, Any], *, field_missing: bool) -> bool:
    if "$exists" in spec:
        wanted = bool(spec["$exists"])
        if wanted and field_missing:
            return False
        if not wanted and not field_missing:
            return False
        rest = {k: v for k, v in spec.items() if k != "$exists"}
        if not rest:
            return True
        spec = rest
    if field_missing and "$eq" not in spec and "$in" not in spec and "$ne" not in spec and "$nin" not in spec:
        # Comparisons against a missing field fail, except $ne / $nin handled below.
        if any(k in spec for k in ("$gt", "$gte", "$lt", "$lte", "$regex")):
            return False
    for op, expected in spec.items():
        if op == "$eq":
            if not _values_equal(value, expected):
                return False
        elif op == "$ne":
            if _values_equal(value, expected):
                return False
        elif op == "$gt":
            pair = _values_ordered(value, expected)
            if pair is None or not (pair[0] > pair[1]):
                return False
        elif op == "$gte":
            pair = _values_ordered(value, expected)
            if pair is None or not (pair[0] >= pair[1]):
                return False
        elif op == "$lt":
            pair = _values_ordered(value, expected)
            if pair is None or not (pair[0] < pair[1]):
                return False
        elif op == "$lte":
            pair = _values_ordered(value, expected)
            if pair is None or not (pair[0] <= pair[1]):
                return False
        elif op == "$in":
            if not any(_values_equal(value, item) for item in expected):
                return False
        elif op == "$nin":
            if any(_values_equal(value, item) for item in expected):
                return False
        elif op == "$regex":
            options = str(spec.get("$options") or "")
            if not _match_regex(value, str(expected), options):
                return False
        elif op == "$options":
            continue
        elif op == "$exists":
            continue
        else:
            raise ValueError(f"Unsupported query operator: {op}")
    return True


def match_doc(doc: dict[str, Any], query: dict[str, Any] | None) -> bool:
    if not query:
        return True
    for key, spec in query.items():
        if key == "$and":
            if not all(match_doc(doc, part) for part in spec):
                return False
            continue
        if key == "$or":
            if not any(match_doc(doc, part) for part in spec):
                return False
            continue
        if key == "$nor":
            if any(match_doc(doc, part) for part in spec):
                return False
            continue
        missing = get_path(doc, key) is None and (
            key not in doc if "." not in key else True
        )
        if "." not in key:
            missing = key not in doc
        value = get_path(doc, key) if not missing else None
        if isinstance(spec, dict) and any(str(k).startswith("$") for k in spec):
            if not _match_op(value, spec, field_missing=missing):
                return False
            continue
        # Bare equality: Mongo `{field: null}` matches missing or null.
        if spec is None:
            if not missing and value is not None:
                return False
            continue
        if missing or not _values_equal(value, spec):
            return False
    return True


def project_doc(doc: dict[str, Any], projection: dict[str, Any] | None) -> dict[str, Any]:
    if not projection:
        return doc
    include = {k: v for k, v in projection.items() if k != "_id" and v}
    exclude = {k for k, v in projection.items() if k != "_id" and not v}
    keep_id = projection.get("_id", 1) not in {0, False}
    if include:
        out = {k: doc[k] for k in include if k in doc}
        if keep_id and "_id" in doc:
            out["_id"] = doc["_id"]
        return out
    out = {k: v for k, v in doc.items() if k not in exclude}
    if not keep_id:
        out.pop("_id", None)
    return out


def _sort_tuple(value: Any) -> tuple[int, Any]:
    if value is None:
        return (0, "")
    if isinstance(value, datetime):
        return (1, fmt_dt(value))
    if isinstance(value, ObjectId):
        return (1, str(value))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return (1, float(value))
    return (1, str(value))


def sort_docs(docs: list[dict[str, Any]], sort: list[tuple[str, int]] | None) -> list[dict[str, Any]]:
    if not sort:
        return docs
    out = list(docs)
    for field, direction in reversed(sort):
        out.sort(key=lambda d, f=field: _sort_tuple(get_path(d, f)), reverse=direction < 0)
    return out


def apply_update(doc: dict[str, Any], update: dict[str, Any], *, is_insert: bool) -> dict[str, Any]:
    out = dict(doc)
    if "$set" in update or "$unset" in update or "$inc" in update or "$push" in update or "$setOnInsert" in update:
        if "$setOnInsert" in update and is_insert:
            out.update(update["$setOnInsert"])
        if "$set" in update:
            out.update(update["$set"])
        if "$unset" in update:
            for key in update["$unset"]:
                out.pop(key, None)
        if "$inc" in update:
            for key, amount in update["$inc"].items():
                current = out.get(key) or 0
                out[key] = float(current) + float(amount)
        if "$push" in update:
            for key, value in update["$push"].items():
                arr = list(out.get(key) or [])
                arr.append(value)
                out[key] = arr
        return out
    # Replacement-style update (rare)
    kept_id = out.get("_id")
    out = dict(update)
    if kept_id is not None:
        out["_id"] = kept_id
    return out


def _resolve(expr: Any, doc: dict[str, Any]) -> Any:
    if isinstance(expr, str) and expr.startswith("$"):
        return get_path(doc, expr[1:])
    if not isinstance(expr, dict):
        return expr
    if "$dateToString" in expr:
        spec = expr["$dateToString"]
        raw = _resolve(spec.get("date"), doc)
        if not isinstance(raw, datetime):
            return None
        tz_name = spec.get("timezone") or "UTC"
        localized = raw.astimezone(ZoneInfo(tz_name))
        fmt = spec.get("format") or "%Y-%m-%d"
        mapping = {
            "%Y-%m": "%Y-%m",
            "%Y-%m-%d": "%Y-%m-%d",
            "%Y": "%Y",
        }
        return localized.strftime(mapping.get(fmt, fmt))
    if "$dayOfWeek" in expr:
        raw = _resolve(expr["$dayOfWeek"], doc)
        if not isinstance(raw, datetime):
            return None
        localized = raw.astimezone(ZoneInfo("Asia/Kolkata"))
        return (localized.weekday() + 1) % 7 + 1
    if "$dayOfMonth" in expr:
        raw = _resolve(expr["$dayOfMonth"], doc)
        if not isinstance(raw, datetime):
            return None
        localized = raw.astimezone(ZoneInfo("Asia/Kolkata"))
        return localized.day
    if "$ifNull" in expr:
        first, default = expr["$ifNull"]
        value = _resolve(first, doc)
        return default if value is None else value
    if "$eq" in expr:
        left, right = expr["$eq"]
        return _values_equal(_resolve(left, doc), _resolve(right, doc))
    if "$cond" in expr:
        cond, then, els = expr["$cond"]
        return _resolve(then, doc) if _resolve(cond, doc) else _resolve(els, doc)
    if len(expr) == 1 and next(iter(expr)).startswith("$"):
        raise ValueError(f"Unsupported aggregation expression: {expr}")
    return {k: _resolve(v, doc) for k, v in expr.items()}


def _accum(op: str, current: Any, incoming: Any) -> Any:
    if op == "$sum":
        add = incoming if incoming is not None else 0
        base = current if current is not _MISSING else 0
        return base + (add if isinstance(add, (int, float)) and not isinstance(add, bool) else 0)
    if op == "$avg":
        add = incoming if isinstance(incoming, (int, float)) and not isinstance(incoming, bool) else 0
        total, n = (0.0, 0) if current is _MISSING else current
        return (total + add, n + 1)
    if op == "$max":
        if current is _MISSING:
            return incoming
        pair = _values_ordered(incoming, current)
        return incoming if pair and pair[0] > pair[1] else current
    if op == "$min":
        if current is _MISSING:
            return incoming
        pair = _values_ordered(incoming, current)
        return incoming if pair and pair[0] < pair[1] else current
    if op == "$first":
        return incoming if current is _MISSING else current
    raise ValueError(f"Unsupported accumulator: {op}")


def _finalize_accum(op: str, value: Any) -> Any:
    if op == "$avg":
        total, n = value if value is not None else (0.0, 0)
        return (total / n) if n else None
    return value


def _run_group(docs: list[dict[str, Any]], spec: dict[str, Any]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    id_expr = spec.get("_id")
    accums = {k: v for k, v in spec.items() if k != "_id"}
    for doc in docs:
        gid = _resolve(id_expr, doc)
        key = repr(gid)
        if key not in buckets:
            buckets[key] = {
                "_id": gid,
                "_acc": {name: _MISSING for name in accums},
                "_ops": {},
            }
            order.append(key)
        bucket = buckets[key]
        for name, expr in accums.items():
            if not isinstance(expr, dict) or len(expr) != 1:
                raise ValueError(f"Unsupported group accumulator for {name}: {expr}")
            op, inner = next(iter(expr.items()))
            incoming = 1 if inner == 1 else _resolve(inner, doc)
            bucket["_acc"][name] = _accum(op, bucket["_acc"][name], incoming)
            bucket["_ops"][name] = op
    rows = []
    for key in order:
        bucket = buckets[key]
        row = {"_id": bucket["_id"]}
        ops = bucket.get("_ops") or {}
        for name, value in bucket["_acc"].items():
            if value is _MISSING:
                row[name] = None
            else:
                row[name] = _finalize_accum(ops.get(name, "$sum"), value)
        rows.append(row)
    return rows


def aggregate(docs: list[dict[str, Any]], pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    current = docs
    for stage in pipeline:
        if not stage:
            continue
        op, spec = next(iter(stage.items()))
        if op == "$match":
            current = [d for d in current if match_doc(d, spec)]
        elif op == "$sort":
            current = sort_docs(current, list(spec.items()))
        elif op == "$group":
            current = _run_group(current, spec)
        elif op == "$limit":
            current = current[: int(spec)]
        elif op == "$skip":
            current = current[int(spec) :]
        else:
            raise ValueError(f"Unsupported aggregation stage: {op}")
    return current
