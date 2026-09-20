"""Copy MongoDB money_tracker collections into Supabase money_track.docs.

Usage (from backend/):

  # Dump Atlas → local JSON (no Postgres needed)
  python scripts/migrate_mongo_to_supabase.py --dump /tmp/money_track_dump.json

  # Load JSON into Supabase
  DATABASE_URL='postgresql://...' python scripts/migrate_mongo_to_supabase.py --load /tmp/money_track_dump.json

  # One-shot Atlas → Supabase
  DATABASE_URL='postgresql://...' python scripts/migrate_mongo_to_supabase.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pymongo import MongoClient
import certifi

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pg_query import to_jsonable  # noqa: E402
from pg_store import PostgresMongoClient, SupabaseRestClient  # noqa: E402

COLLECTIONS = [
    "users",
    "linked_accounts",
    "transactions",
    "webhook_events",
    "category_memory",
    "portfolio",
    "networth_snapshots",
    "liabilities",
    "credit_cards",
    "budgets",
    "import_events",
    "import_rag_examples",
    "sip_overrides",
    "app_settings",
    "transfer_suggestions",
    "monthly_reports",
    "news_cache",
    "user_learned_facts",
    "learn_question_events",
    "planning_goals",
    "advisor_memories",
    "advisor_chat_sessions",
    "document_formats",
    "merchant_knowledge",
    "otp_challenges",
    "learned_facts",
]


def _dump_mongo(mongo_uri: str) -> dict[str, list[dict]]:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=15000, tlsCAFile=certifi.where())
    db = client["money_tracker"]
    out: dict[str, list[dict]] = {}
    for name in COLLECTIONS:
        docs = [to_jsonable(d) for d in db[name].find()]
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        out[name] = docs
        print(f"dumped {name}: {len(docs)}")
    client.close()
    return out


def _open_store():
    database_url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
    secret = (os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if database_url:
        return PostgresMongoClient(database_url)
    if supabase_url and secret:
        return SupabaseRestClient(supabase_url, secret)
    raise SystemExit("Set SUPABASE_URL + SUPABASE_SECRET_KEY, or DATABASE_URL")


def _load_store(client: Any, payload: dict[str, list[dict]], *, replace: bool) -> None:
    db = client["money_tracker"]
    for name, docs in payload.items():
        col = db[name]
        if replace:
            col.delete_many({})
        if not docs:
            print(f"loaded {name}: 0")
            continue
        if getattr(client, "backend", "sql") == "rest":
            batch: list[dict] = []
            for doc in docs:
                encoded = dict(doc)
                encoded["_id"] = str(encoded["_id"])
                batch.append(encoded)
                if len(batch) == 100:
                    client._upsert_batch(name, batch)
                    batch = []
            if batch:
                client._upsert_batch(name, batch)
        else:
            with client.pool.connection() as conn:
                with conn.transaction():
                    for doc in docs:
                        col._replace_row(conn, doc)
        print(f"loaded {name}: {len(docs)}")
    client.close()


def main() -> int:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", help="Write Mongo dump JSON to this path")
    parser.add_argument("--load", help="Load this JSON dump into DATABASE_URL")
    parser.add_argument("--replace", action="store_true", help="Delete existing rows per collection before load")
    args = parser.parse_args()

    mongo_uri = (os.getenv("MONGO_URI") or "").strip()

    payload: dict[str, list[dict]] | None = None
    if args.load:
        payload = json.loads(Path(args.load).read_text())
    elif mongo_uri:
        payload = _dump_mongo(mongo_uri)
        if args.dump:
            Path(args.dump).write_text(json.dumps(payload))
            print(f"wrote {args.dump}")
    elif args.dump:
        raise SystemExit("MONGO_URI is required to dump")

    if args.dump and payload is not None and not mongo_uri:
        Path(args.dump).write_text(json.dumps(payload))

    should_load = bool(args.load) or (not args.dump and payload is not None)
    if should_load:
        assert payload is not None
        _load_store(_open_store(), payload, replace=args.replace)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
