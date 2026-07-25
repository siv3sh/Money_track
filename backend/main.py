import os
import csv
import io
import json
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

import certifi
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from pymongo import DESCENDING, MongoClient

# Load .env before local modules that read os.getenv at import time (e.g. llm).
load_dotenv()

from parser import parse_sms
from statement_parser import parse_statement, parse_statement_file
from categorizer import CATEGORIES, apply_category
from analytics import build_analytics
from merchant_label import clean_merchant_label
from indmoney_import import (
    TARGET_FIELDS,
    apply_mapping,
    read_tabular_file,
    suggest_mapping,
    upsert_holdings,
)
from ai_insights import ask, categorize_batch, explain_anomalies, monthly_summary
from llm import LLMError, provider_status

app = FastAPI(title="SMS Money Tracker")

MONGO_URI = os.environ["MONGO_URI"]
client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=10000,
    tlsCAFile=certifi.where(),
)
db = client["money_tracker"]
transactions = db["transactions"]
webhook_events = db["webhook_events"]
category_memory = db["category_memory"]
portfolio = db["portfolio"]
networth_snapshots = db["networth_snapshots"]
liabilities_col = db["liabilities"]
budgets_col = db["budgets"]
import_events = db["import_events"]

API_KEY = os.getenv("API_KEY", "")
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Useful indexes for the dashboard queries below
try:
    transactions.create_index([("received_at", DESCENDING)])
    transactions.create_index("card_type")
    transactions.create_index("bank")
    transactions.create_index("type")
    transactions.create_index("category")
    category_memory.create_index("merchant_key", unique=True)
    portfolio.create_index("instrument_key")
    portfolio.create_index("source")
except Exception as exc:  # noqa: BLE001 — allow import/boot without Mongo during local checks
    print(f"Warning: could not create Mongo indexes yet: {exc}")


def _load_merchant_memory() -> dict[str, str]:
    memory: dict[str, str] = {}
    try:
        for row in category_memory.find({}, {"merchant_key": 1, "category": 1}):
            key = (row.get("merchant_key") or "").strip().lower()
            cat = row.get("category")
            if key and cat:
                memory[key] = str(cat)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load category memory: {exc}")
    return memory


def require_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")) -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API_KEY is not configured on the server",
        )
    if not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key",
        )


class SmsPayload(BaseModel):
    sender: str = Field(..., min_length=1, max_length=64)
    body: str = Field(..., min_length=1, max_length=2000)
    timestamp: int | None = None  # epoch millis from the phone, optional

    @field_validator("sender", "body")
    @classmethod
    def strip_nonempty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be blank")
        return cleaned


class StatementImportPayload(BaseModel):
    content: str = Field(..., min_length=1, max_length=2_000_000)
    bank: str | None = Field(default=None, max_length=64)
    format: str = Field(default="auto", pattern="^(auto|csv|text)$")


def _fingerprint(doc: dict[str, Any]) -> str:
    """Cheap dedupe key for re-imports."""
    ts = doc.get("received_at")
    if isinstance(ts, datetime):
        day = ts.strftime("%Y-%m-%d")
    else:
        day = str(ts)[:10]
    return f"{doc.get('type')}|{doc.get('amount')}|{day}|{(doc.get('raw_text') or '')[:80]}"


def _soft_fingerprint(doc: dict[str, Any]) -> str:
    """Cross-source soft match: amount + day + type + cleaned merchant prefix."""
    ts = doc.get("received_at")
    if isinstance(ts, datetime):
        day = ts.strftime("%Y-%m-%d")
    else:
        day = str(ts)[:10]
    label = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text")).lower()
    label = re.sub(r"[^a-z0-9]", "", label)[:18]
    try:
        amount = f"{float(doc.get('amount') or 0):.2f}"
    except (TypeError, ValueError):
        amount = str(doc.get("amount"))
    return f"{doc.get('type')}|{amount}|{day}|{label}"


def _import_statement_docs(docs: list[dict[str, Any]]) -> dict[str, Any]:
    if not docs:
        return {
            "imported": 0,
            "skipped_duplicates": 0,
            "skipped_likely_duplicates": 0,
            "parsed": 0,
            "ids": [],
            "likely_duplicates": [],
        }

    exact: set[str] = set()
    soft: set[str] = set()
    soft_examples: dict[str, dict[str, Any]] = {}
    for doc in transactions.find(
        {},
        {"type": 1, "amount": 1, "received_at": 1, "raw_text": 1, "merchant": 1, "source": 1},
    ).limit(8000):
        exact.add(_fingerprint(doc))
        sk = _soft_fingerprint(doc)
        soft.add(sk)
        soft_examples.setdefault(
            sk,
            {
                "existing_source": doc.get("source") or "unknown",
                "merchant": clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text")),
                "amount": doc.get("amount"),
                "type": doc.get("type"),
            },
        )

    memory = _load_merchant_memory()
    to_insert: list[dict[str, Any]] = []
    skipped = 0
    skipped_likely = 0
    likely_duplicates: list[dict[str, Any]] = []
    for doc in docs:
        fp = _fingerprint(doc)
        sk = _soft_fingerprint(doc)
        if fp in exact:
            skipped += 1
            continue
        if sk in soft:
            skipped_likely += 1
            example = soft_examples.get(sk) or {}
            if len(likely_duplicates) < 25:
                likely_duplicates.append(
                    {
                        "incoming_merchant": clean_merchant_label(
                            doc.get("merchant"), fallback=doc.get("raw_text")
                        ),
                        "amount": doc.get("amount"),
                        "type": doc.get("type"),
                        "received_at": doc.get("received_at").isoformat()
                        if isinstance(doc.get("received_at"), datetime)
                        else doc.get("received_at"),
                        "matched_existing_source": example.get("existing_source"),
                        "matched_existing_merchant": example.get("merchant"),
                        "reason": "Same amount, date, type, and similar merchant across sources",
                    }
                )
            continue
        exact.add(fp)
        soft.add(sk)
        apply_category(doc, memory)
        to_insert.append(doc)

    ids: list[str] = []
    if to_insert:
        result = transactions.insert_many(to_insert)
        ids = [str(i) for i in result.inserted_ids]
        try:
            import_events.insert_one(
                {
                    "kind": "statement",
                    "imported": len(ids),
                    "skipped_duplicates": skipped,
                    "skipped_likely_duplicates": skipped_likely,
                    "parsed": len(docs),
                    "created_at": datetime.now(timezone.utc),
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not log import event: {exc}")

    return {
        "imported": len(ids),
        "skipped_duplicates": skipped,
        "skipped_likely_duplicates": skipped_likely,
        "parsed": len(docs),
        "ids": ids,
        "likely_duplicates": likely_duplicates,
    }


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    out = {**doc, "_id": str(doc["_id"])}
    received = out.get("received_at")
    if isinstance(received, datetime):
        out["received_at"] = received.isoformat()
    raw_merchant = out.get("merchant")
    if raw_merchant:
        out["merchant_raw"] = raw_merchant
        out["merchant"] = clean_merchant_label(raw_merchant, fallback=out.get("raw_text"))
    return out


def _month_keys(now: datetime | None = None) -> tuple[datetime, datetime, datetime]:
    """Return (this_month_start, last_month_start, next_month_start) as UTC datetimes."""
    now = now or datetime.now(timezone.utc)
    this_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if now.month == 1:
        last_start = datetime(now.year - 1, 12, 1, tzinfo=timezone.utc)
    else:
        last_start = datetime(now.year, now.month - 1, 1, tzinfo=timezone.utc)
    if now.month == 12:
        next_start = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        next_start = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    return this_start, last_start, next_start


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _log_webhook_event(event: dict[str, Any]) -> None:
    try:
        webhook_events.insert_one(
            {
                **event,
                "received_at": datetime.now(timezone.utc),
            }
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not log webhook event: {exc}")


async def _extract_sms_fields(request: Request) -> dict[str, Any]:
    """Accept JSON, form-urlencoded, multipart, or raw text JSON from iOS Shortcuts."""
    content_type = (request.headers.get("content-type") or "").lower()
    raw = await request.body()
    text = raw.decode("utf-8", errors="replace").strip() if raw else ""

    data: dict[str, Any] = {}
    if "application/json" in content_type or (text.startswith("{") and text.endswith("}")):
        try:
            parsed = await request.json()
            if isinstance(parsed, dict):
                data = parsed
        except Exception:
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    data = parsed
            except Exception:
                data = {}
    elif (
        "application/x-www-form-urlencoded" in content_type
        or "multipart/form-data" in content_type
    ):
        form = await request.form()
        data = {str(k): form.get(k) for k in form.keys()}
    elif text:
        # Last resort: try JSON, else treat entire body as SMS text
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                data = parsed
            else:
                data = {"body": text}
        except Exception:
            data = {"body": text}

    sender = (
        data.get("sender")
        or data.get("from")
        or data.get("Sender")
        or data.get("From")
        or ""
    )
    body = (
        data.get("body")
        or data.get("message")
        or data.get("text")
        or data.get("content")
        or data.get("Message")
        or data.get("Body")
        or ""
    )
    timestamp = data.get("timestamp") or data.get("time") or data.get("date")

    body_text = str(body or "").strip()
    # If structured parsing found nothing but the request had raw text,
    # treat the whole body as the SMS (Shortcuts "File" body sends plain text).
    if not body_text and text and not text.startswith("{"):
        body_text = text

    return {
        "sender": str(sender or "").strip(),
        "body": body_text,
        "timestamp": timestamp,
        "raw_preview": text[:240],
        "content_type": content_type or "unknown",
    }


@app.get("/sms-webhook")
def sms_webhook_get_hint():
    """iOS Shortcuts defaults to GET — tell the user exactly how to fix it."""
    return {
        "ok": False,
        "error": "Use POST, not GET",
        "fix": (
            "In Shortcuts → Get Contents of URL → expand the action → "
            "set Method to POST, add header X-API-Key, Request Body = JSON "
            "with sender=Sender and body=Message Contents."
        ),
    }


@app.post("/sms-webhook")
async def receive_sms(request: Request):
    # Check the API key inside the handler so failed auth attempts are logged too
    provided_key = request.headers.get("x-api-key") or ""
    if not API_KEY or not provided_key or not secrets.compare_digest(provided_key, API_KEY):
        _log_webhook_event(
            {
                "stored": False,
                "reason": "bad_api_key" if provided_key else "missing_api_key",
                "key_preview": (provided_key[:6] + "…") if provided_key else "",
                "content_type": request.headers.get("content-type") or "unknown",
            }
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key",
        )

    fields = await _extract_sms_fields(request)
    sender = fields["sender"]
    body = fields["body"]
    timestamp = fields["timestamp"]

    # Allow sender via query string or header (iOS Shortcuts often puts it there)
    if not sender:
        sender = (
            (request.query_params.get("sender") or "").strip()
            or (request.headers.get("sender") or "").strip()
            or (request.headers.get("x-sender") or "").strip()
        )
    # Body in a header is fragile (newlines), but accept as last resort
    if not body:
        body = (request.headers.get("body") or request.headers.get("x-body") or "").strip()
    if not sender and body:
        sender = "SHORTCUT"

    if not sender or not body:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "missing_sender_or_body",
                "content_type": fields["content_type"],
                "raw_preview": fields["raw_preview"],
                "sender": sender,
                "body": body,
            }
        )
        return {
            "stored": False,
            "reason": "missing sender or body",
            "hint": (
                "Your POST reached the server, but the body was empty. "
                "Do NOT use Request Body = File. Use Form instead: "
                "add one field named body = Shortcut Input (blue chip). "
                "Put sender in the URL: .../sms-webhook?sender=VM-HDFCBK. "
                "Pressing Play in the editor sends empty input — test with a real bank SMS."
            ),
            "received": {
                "sender": sender,
                "body": body,
                "content_type": fields["content_type"],
                "raw_preview": fields["raw_preview"],
            },
        }

    # Classic Shortcuts bug: literal placeholder text instead of Message Contents
    if body.lower() in {"shortcut input", "shortcut input.", "text", "message contents"}:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "placeholder_body",
                "sender": sender,
                "body": body,
                "content_type": fields["content_type"],
            }
        )
        return {
            "stored": False,
            "reason": "body is placeholder text, not the real SMS",
            "hint": (
                "Delete the body value and insert the Magic Variable "
                "'Message Contents' from the Message automation trigger."
            ),
            "received_body": body,
        }

    try:
        ts_int: int | None = None
        if timestamp is not None and str(timestamp).strip():
            ts_int = int(float(str(timestamp)))
        payload = SmsPayload(sender=sender, body=body, timestamp=ts_int)
    except Exception as exc:  # noqa: BLE001
        _log_webhook_event(
            {
                "stored": False,
                "reason": "invalid_payload",
                "error": str(exc),
                "sender": sender,
                "body": body[:200],
            }
        )
        raise HTTPException(status_code=422, detail=f"Invalid SMS payload: {exc}") from exc

    try:
        txn = parse_sms(payload.sender, payload.body)
    except Exception as exc:  # noqa: BLE001
        _log_webhook_event(
            {
                "stored": False,
                "reason": "parse_error",
                "error": str(exc),
                "sender": payload.sender,
                "body": payload.body[:200],
            }
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse SMS: {exc}",
        ) from exc

    if txn is None:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "not_a_transaction",
                "sender": payload.sender,
                "body": payload.body[:240],
            }
        )
        return {
            "stored": False,
            "reason": "not a transaction SMS (spam, OTP, or unparseable)",
            "received": {"sender": payload.sender, "body": payload.body[:240]},
        }

    doc = {
        **txn,
        "sender": payload.sender,
        "source": "sms",
        "received_at": (
            datetime.fromtimestamp(payload.timestamp / 1000, tz=timezone.utc)
            if payload.timestamp
            else datetime.now(timezone.utc)
        ),
    }
    apply_category(doc, _load_merchant_memory())

    result = transactions.insert_one(doc)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to store transaction")

    _log_webhook_event(
        {
            "stored": True,
            "id": str(result.inserted_id),
            "sender": payload.sender,
            "amount": txn.get("amount"),
            "type": txn.get("type"),
            "category": doc.get("category"),
            "body": payload.body[:240],
        }
    )

    return {
        "stored": True,
        "id": str(result.inserted_id),
        "transaction": {**txn, "category": doc.get("category"), "mcc": doc.get("mcc")},
    }


@app.get("/sms-webhook/debug")
def sms_webhook_debug(limit: int = Query(default=20, ge=1, le=100)):
    """Recent webhook attempts — use this to see why phone automations failed."""
    rows = list(webhook_events.find().sort("received_at", DESCENDING).limit(limit))
    out = []
    for row in rows:
        item = {k: v for k, v in row.items() if k != "_id"}
        item["id"] = str(row["_id"])
        received = item.get("received_at")
        if isinstance(received, datetime):
            item["received_at"] = received.isoformat()
        out.append(item)
    return {"count": len(out), "events": out}


@app.post("/statements/import")
def import_statement(payload: StatementImportPayload):
    """Paste CSV or line-based statement text (for July history, etc.)."""
    try:
        docs = parse_statement(payload.content, bank=payload.bank, fmt=payload.format)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Failed to parse statement: {exc}") from exc

    return _import_statement_docs(docs)


@app.post("/statements/upload")
async def upload_statement(
    file: UploadFile = File(...),
    bank: str | None = Form(default=None),
    format: str = Form(default="auto"),
):
    """Upload a bank statement: CSV, TXT, Excel (.xlsx/.xls), or PDF."""
    name = (file.filename or "").lower()
    allowed = (".csv", ".txt", ".tsv", ".xlsx", ".xls", ".pdf")
    if not name.endswith(allowed):
        raise HTTPException(
            status_code=400,
            detail="Upload a .csv, .tsv, .txt, .xlsx, .xls, or .pdf file",
        )

    raw = await file.read()
    # PDFs/Excel can be larger than plain CSV
    max_bytes = 8_000_000 if name.endswith(".pdf") else 5_000_000
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail="File too large (max 5–8MB)")

    try:
        docs = parse_statement_file(raw, file.filename or name, bank=bank, fmt=format)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse statement: {exc}",
        ) from exc

    return _import_statement_docs(docs)


@app.get("/transactions")
def list_transactions(
    limit: int = Query(default=50, ge=1, le=500),
    skip: int = Query(default=0, ge=0),
    card_type: str | None = None,
    bank: str | None = None,
    category: str | None = None,
    type: str | None = Query(default=None, pattern="^(debit|credit)$"),
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = Query(default="received_at", pattern="^(received_at|amount)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    q: str | None = Query(default=None, max_length=120),
):
    query: dict[str, Any] = {}
    if card_type:
        query["card_type"] = card_type
    if bank:
        query["bank"] = {"$regex": f"^{re.escape(bank)}$", "$options": "i"}
    if category:
        query["category"] = category
    if type:
        query["type"] = type
    if q and q.strip():
        needle = re.escape(q.strip())
        query["$or"] = [
            {"merchant": {"$regex": needle, "$options": "i"}},
            {"raw_text": {"$regex": needle, "$options": "i"}},
            {"merchant_raw": {"$regex": needle, "$options": "i"}},
        ]

    received_filter: dict[str, Any] = {}
    if date_from:
        start = _parse_optional_date(date_from)
        if start is None:
            raise HTTPException(status_code=400, detail="Invalid date_from")
        received_filter["$gte"] = start
    if date_to:
        end = _parse_optional_date(date_to, end_of_day=True)
        if end is None:
            raise HTTPException(status_code=400, detail="Invalid date_to")
        received_filter["$lte"] = end
    if received_filter:
        query["received_at"] = received_filter

    direction = DESCENDING if order == "desc" else 1
    cursor = (
        transactions.find(query)
        .sort(sort, direction)
        .skip(skip)
        .limit(limit)
    )
    return [_serialize(doc) for doc in cursor]


class CategoryUpdate(BaseModel):
    category: str = Field(..., min_length=1, max_length=64)
    remember_merchant: bool = True

    @field_validator("category")
    @classmethod
    def valid_category(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in CATEGORIES:
            raise ValueError(f"category must be one of: {', '.join(CATEGORIES)}")
        return cleaned


@app.get("/categories")
def list_categories():
    return {"categories": CATEGORIES}


@app.patch("/transactions/{txn_id}/category")
def update_transaction_category(txn_id: str, payload: CategoryUpdate):
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    doc = transactions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaction not found")

    transactions.update_one(
        {"_id": oid},
        {
            "$set": {
                "category": payload.category,
                "category_source": "manual",
            }
        },
    )

    merchant = (doc.get("merchant") or "").strip()
    if payload.remember_merchant and merchant:
        key = merchant.lower()
        category_memory.update_one(
            {"merchant_key": key},
            {
                "$set": {
                    "merchant_key": key,
                    "merchant": merchant,
                    "category": payload.category,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )

    updated = transactions.find_one({"_id": oid})
    return {"ok": True, "transaction": _serialize(updated or doc)}


@app.post("/categories/backfill")
def backfill_categories(force: bool = Query(default=False)):
    """Categorize existing transactions missing a category (or all if force=true)."""
    memory = _load_merchant_memory()
    query: dict[str, Any] = {} if force else {"$or": [{"category": {"$exists": False}}, {"category": None}, {"category": ""}]}
    updated = 0
    scanned = 0
    by_cat: dict[str, int] = {}
    for doc in transactions.find(query):
        scanned += 1
        # Preserve manual overrides unless force
        if not force and doc.get("category_source") == "manual" and doc.get("category"):
            continue
        apply_category(doc, memory)
        transactions.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "category": doc.get("category"),
                    "mcc": doc.get("mcc"),
                    "category_source": doc.get("category_source"),
                }
            },
        )
        updated += 1
        cat = str(doc.get("category") or "Other")
        by_cat[cat] = by_cat.get(cat, 0) + 1
    return {"scanned": scanned, "updated": updated, "by_category": by_cat}


@app.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: str):
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    result = transactions.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True, "id": txn_id}


@app.get("/summary")
def summary():
    pipeline = [
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]
    results = {r["_id"]: r for r in transactions.aggregate(pipeline)}
    total_debit = float(results.get("debit", {}).get("total", 0) or 0)
    total_credit = float(results.get("credit", {}).get("total", 0) or 0)
    count = int(
        (results.get("debit", {}).get("count", 0) or 0)
        + (results.get("credit", {}).get("count", 0) or 0)
    )

    this_start, last_start, next_start = _month_keys()

    def month_totals(start: datetime, end: datetime) -> tuple[float, float]:
        month_pipeline = [
            {"$match": {"received_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}},
        ]
        rows = {r["_id"]: float(r["total"] or 0) for r in transactions.aggregate(month_pipeline)}
        return rows.get("debit", 0.0), rows.get("credit", 0.0)

    this_debit, this_credit = month_totals(this_start, next_start)
    last_debit, last_credit = month_totals(last_start, this_start)

    return {
        "total_debit": total_debit,
        "total_credit": total_credit,
        "net": total_credit - total_debit,
        "count": count,
        "this_month_debit": this_debit,
        "this_month_credit": this_credit,
        "this_month_net": this_credit - this_debit,
        "last_month_debit": last_debit,
        "last_month_credit": last_credit,
        "last_month_net": last_credit - last_debit,
    }


@app.get("/summary/monthly")
def summary_monthly(months: int = Query(default=12, ge=1, le=36)):
    pipeline = [
        {
            "$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m", "date": "$received_at"}
                },
                "debit": {
                    "$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}
                },
                "credit": {
                    "$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    rows = list(transactions.aggregate(pipeline))
    buckets = [
        {
            "month": row["_id"] or "unknown",
            "debit": float(row.get("debit") or 0),
            "credit": float(row.get("credit") or 0),
            "net": float(row.get("credit") or 0) - float(row.get("debit") or 0),
            "count": int(row.get("count") or 0),
        }
        for row in rows
        if row.get("_id")
    ]
    return buckets[-months:]


@app.get("/summary/merchants")
def summary_merchants(limit: int = Query(default=10, ge=1, le=50)):
    totals: dict[str, dict[str, float]] = {}
    for doc in transactions.find(
        {"type": "debit", "merchant": {"$nin": [None, ""]}},
        {"merchant": 1, "raw_text": 1, "amount": 1},
    ):
        label = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text"))
        bucket = totals.setdefault(label, {"amount": 0.0, "count": 0.0})
        bucket["amount"] += float(doc.get("amount") or 0)
        bucket["count"] += 1
    ranked = sorted(totals.items(), key=lambda kv: -kv[1]["amount"])[:limit]
    return [
        {
            "merchant": name,
            "amount": vals["amount"],
            "count": int(vals["count"]),
        }
        for name, vals in ranked
    ]


def _parse_optional_date(value: str | None, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.strptime(value.strip()[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc
    if end_of_day and dt.hour == 0 and dt.minute == 0 and dt.second == 0:
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999000)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@app.get("/reports/detailed")
def reports_detailed(
    date_from: str | None = None,
    date_to: str | None = None,
    merchant_limit: int = Query(default=15, ge=1, le=50),
):
    """Rich report payload for the Reports page."""
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)

    match: dict[str, Any] = {}
    if start or end:
        received: dict[str, Any] = {}
        if start:
            received["$gte"] = start
        if end:
            received["$lte"] = end
        match["received_at"] = received

    base = [{"$match": match}] if match else []

    totals_rows = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": "$type",
                        "total": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                        "avg": {"$avg": "$amount"},
                        "max": {"$max": "$amount"},
                        "min": {"$min": "$amount"},
                    }
                }
            ]
        )
    )
    by_type = {r["_id"]: r for r in totals_rows}
    debit = by_type.get("debit", {})
    credit = by_type.get("credit", {})
    total_debit = float(debit.get("total") or 0)
    total_credit = float(credit.get("total") or 0)
    debit_count = int(debit.get("count") or 0)
    credit_count = int(credit.get("count") or 0)
    count = debit_count + credit_count

    def group_breakdown(field: str) -> list[dict[str, Any]]:
        rows = list(
            transactions.aggregate(
                base
                + [
                    {
                        "$group": {
                            "_id": f"${field}",
                            "debit": {
                                "$sum": {
                                    "$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]
                                }
                            },
                            "credit": {
                                "$sum": {
                                    "$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]
                                }
                            },
                            "count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"debit": -1}},
                ]
            )
        )
        return [
            {
                "name": str(r["_id"] or "Unknown"),
                "debit": float(r.get("debit") or 0),
                "credit": float(r.get("credit") or 0),
                "net": float(r.get("credit") or 0) - float(r.get("debit") or 0),
                "count": int(r.get("count") or 0),
                "debit_share": (
                    round(float(r.get("debit") or 0) / total_debit * 100, 1)
                    if total_debit
                    else 0.0
                ),
            }
            for r in rows
        ]

    merchant_q = {**match, "type": "debit", "merchant": {"$nin": [None, ""]}}
    merchant_totals: dict[str, dict[str, float]] = {}
    for doc in transactions.find(merchant_q, {"merchant": 1, "raw_text": 1, "amount": 1}):
        label = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text"))
        bucket = merchant_totals.setdefault(label, {"amount": 0.0, "count": 0.0})
        bucket["amount"] += float(doc.get("amount") or 0)
        bucket["count"] += 1
    merchant_rows = [
        {
            "merchant": name,
            "amount": vals["amount"],
            "count": int(vals["count"]),
            "avg": round(vals["amount"] / max(vals["count"], 1), 2),
            "share": (
                round(vals["amount"] / total_debit * 100, 1) if total_debit else 0.0
            ),
        }
        for name, vals in sorted(merchant_totals.items(), key=lambda kv: -kv[1]["amount"])[
            :merchant_limit
        ]
    ]

    daily = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {"format": "%Y-%m-%d", "date": "$received_at"}
                        },
                        "debit": {
                            "$sum": {
                                "$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]
                            }
                        },
                        "credit": {
                            "$sum": {
                                "$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]
                            }
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    daily_rows = [
        {
            "date": r["_id"],
            "debit": float(r.get("debit") or 0),
            "credit": float(r.get("credit") or 0),
            "net": float(r.get("credit") or 0) - float(r.get("debit") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in daily
        if r.get("_id")
    ]

    weekday = list(
        transactions.aggregate(
            base
            + [
                {"$match": {"type": "debit"}},
                {
                    "$group": {
                        "_id": {"$dayOfWeek": "$received_at"},
                        "amount": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    weekday_names = {1: "Sun", 2: "Mon", 3: "Tue", 4: "Wed", 5: "Thu", 6: "Fri", 7: "Sat"}
    weekday_rows = [
        {
            "day": weekday_names.get(int(r["_id"]), str(r["_id"])),
            "amount": float(r.get("amount") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in weekday
    ]

    monthly = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {"format": "%Y-%m", "date": "$received_at"}
                        },
                        "debit": {
                            "$sum": {
                                "$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]
                            }
                        },
                        "credit": {
                            "$sum": {
                                "$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]
                            }
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    monthly_rows = [
        {
            "month": r["_id"],
            "debit": float(r.get("debit") or 0),
            "credit": float(r.get("credit") or 0),
            "net": float(r.get("credit") or 0) - float(r.get("debit") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in monthly
        if r.get("_id")
    ]

    largest = list(transactions.find(match).sort("amount", DESCENDING).limit(10))
    active_days = len(daily_rows)
    avg_daily_debit = round(total_debit / active_days, 2) if active_days else 0.0

    return {
        "range": {"date_from": date_from, "date_to": date_to},
        "overview": {
            "total_debit": total_debit,
            "total_credit": total_credit,
            "net": total_credit - total_debit,
            "count": count,
            "debit_count": debit_count,
            "credit_count": credit_count,
            "avg_debit": round(float(debit.get("avg") or 0), 2),
            "avg_credit": round(float(credit.get("avg") or 0), 2),
            "max_debit": float(debit.get("max") or 0),
            "max_credit": float(credit.get("max") or 0),
            "active_days": active_days,
            "avg_daily_debit": avg_daily_debit,
        },
        "by_bank": group_breakdown("bank"),
        "by_card_type": group_breakdown("card_type"),
        "by_source": group_breakdown("source"),
        "by_category": group_breakdown("category"),
        "merchants": merchant_rows,
        "daily": daily_rows,
        "weekday": weekday_rows,
        "monthly": monthly_rows,
        "largest": [_serialize(doc) for doc in largest],
        "categories": CATEGORIES,
    }


@app.get("/analytics")
def analytics(
    date_from: str | None = None,
    date_to: str | None = None,
    bank: str | None = Query(default=None, description="Comma-separated bank names"),
):
    """Unified analytics payload for Net Worth, Cash Flow, Spending, Sources, Investments, Alerts."""
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    banks = [b.strip() for b in bank.split(",") if b.strip()] if bank else None
    return build_analytics(
        transactions,
        date_from=start,
        date_to=end,
        banks=banks,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities_col,
        budgets=budgets_col,
    )


class PortfolioHolding(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    asset_class: str = Field(default="Other Investments", max_length=60)
    invested: float = Field(..., ge=0)
    current_value: float = Field(..., ge=0)


class PortfolioPayload(BaseModel):
    holdings: list[PortfolioHolding]


def _serialize_holding(doc: dict[str, Any]) -> dict[str, Any]:
    invested = float(doc.get("invested") or 0)
    current = float(doc.get("current_value") or 0)
    pnl = current - invested
    updated = doc.get("updated_at")
    imported = doc.get("import_date")
    return {
        "name": str(doc.get("name") or ""),
        "asset_class": str(doc.get("asset_class") or "Other Investments"),
        "invested": invested,
        "current_value": current,
        "units": doc.get("units"),
        "as_of_date": doc.get("as_of_date"),
        "instrument_key": doc.get("instrument_key"),
        "source": doc.get("source") or "manual",
        "provider": doc.get("provider"),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl / invested * 100, 2) if invested else 0.0,
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else None,
        "import_date": imported.isoformat() if isinstance(imported, datetime) else None,
    }


@app.get("/portfolio")
def get_portfolio():
    rows = [_serialize_holding(doc) for doc in portfolio.find().sort("current_value", DESCENDING)]
    return {
        "holdings": rows,
        "total_invested": round(sum(r["invested"] for r in rows), 2),
        "total_current": round(sum(r["current_value"] for r in rows), 2),
    }


@app.put("/portfolio")
def put_portfolio(payload: PortfolioPayload):
    """Replace all manually tracked holdings (market values from your broker apps)."""
    now = datetime.now(timezone.utc)
    portfolio.delete_many({})
    if payload.holdings:
        docs = []
        for h in payload.holdings:
            name = h.name.strip()
            key = f"{name.strip().lower()}|latest"
            docs.append(
                {
                    "name": name,
                    "asset_class": h.asset_class.strip() or "Other Investments",
                    "invested": h.invested,
                    "current_value": h.current_value,
                    "instrument_key": key,
                    "source": "manual",
                    "provider": "manual",
                    "updated_at": now,
                    "import_date": now,
                }
            )
        portfolio.insert_many(docs)
    return get_portfolio()


# ── INDmoney CSV / Excel import ──────────────────────────────────────────────

@app.get("/indmoney/fields")
def indmoney_fields():
    return {"fields": TARGET_FIELDS}


@app.post("/indmoney/preview")
async def indmoney_preview(file: UploadFile = File(...)):
    """Parse export + return headers, sample rows, and suggested column mapping."""
    name = (file.filename or "").lower()
    if not name.endswith((".csv", ".tsv", ".txt", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Upload a CSV or Excel file")
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    try:
        headers, rows = read_tabular_file(raw, file.filename or name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}") from exc
    if not headers:
        raise HTTPException(status_code=422, detail="No header row found")
    mapping = suggest_mapping(headers)
    return {
        "filename": file.filename,
        "headers": headers,
        "row_count": len(rows),
        "sample_rows": rows[:8],
        "suggested_mapping": mapping,
        "fields": TARGET_FIELDS,
    }


@app.post("/indmoney/validate")
async def indmoney_validate(
    file: UploadFile = File(...),
    mapping_json: str = Form(...),
):
    """Validate mapped rows and return preview before commit."""
    try:
        mapping = json.loads(mapping_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid mapping JSON") from exc
    raw = await file.read()
    try:
        _headers, rows = read_tabular_file(raw, file.filename or "export.csv")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}") from exc
    return apply_mapping(rows, mapping)


@app.post("/indmoney/commit")
async def indmoney_commit(
    file: UploadFile = File(...),
    mapping_json: str = Form(...),
):
    """Parse file with user mapping and upsert holdings (source=csv_import)."""
    try:
        mapping = json.loads(mapping_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid mapping JSON") from exc
    if not isinstance(mapping, dict):
        raise HTTPException(status_code=400, detail="mapping must be an object")

    raw = await file.read()
    try:
        _headers, rows = read_tabular_file(raw, file.filename or "export.csv")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}") from exc

    preview = apply_mapping(rows, mapping)
    if not preview.get("ok"):
        raise HTTPException(status_code=422, detail=preview.get("error") or "Validation failed")
    if not preview["valid"]:
        raise HTTPException(
            status_code=422,
            detail=f"No valid rows to import ({preview['summary']['errors']} errors)",
        )

    result = upsert_holdings(portfolio, preview["valid"], source="csv_import")
    return {
        "ok": True,
        "import": result,
        "summary": preview["summary"],
        "errors": preview["errors"][:20],
        "holdings": get_portfolio(),
    }


# ── Liabilities ──────────────────────────────────────────────────────────────

LIABILITY_TYPES = ("credit_card", "loan", "emi", "bnpl", "other")


class LiabilityItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    type: str = Field(default="other", max_length=32)
    outstanding: float = Field(..., ge=0)
    last_updated: str | None = None

    @field_validator("type")
    @classmethod
    def valid_type(cls, value: str) -> str:
        cleaned = value.strip().lower().replace(" ", "_")
        if cleaned not in LIABILITY_TYPES:
            raise ValueError(f"type must be one of: {', '.join(LIABILITY_TYPES)}")
        return cleaned


class LiabilitiesPayload(BaseModel):
    items: list[LiabilityItem] = Field(default_factory=list)


def _serialize_liability(doc: dict[str, Any]) -> dict[str, Any]:
    updated = doc.get("updated_at") or doc.get("last_updated")
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name"),
        "type": doc.get("type") or "other",
        "outstanding": float(doc.get("outstanding") or 0),
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
    }


@app.get("/liabilities")
def get_liabilities():
    rows = [_serialize_liability(d) for d in liabilities_col.find().sort("outstanding", DESCENDING)]
    return {
        "items": rows,
        "total": round(sum(r["outstanding"] for r in rows), 2),
    }


@app.put("/liabilities")
def put_liabilities(payload: LiabilitiesPayload):
    now = datetime.now(timezone.utc)
    liabilities_col.delete_many({})
    docs = []
    for item in payload.items:
        updated = now
        if item.last_updated:
            parsed = _parse_optional_date(item.last_updated)
            if parsed:
                updated = parsed
        docs.append(
            {
                "name": item.name.strip(),
                "type": item.type,
                "outstanding": float(item.outstanding),
                "updated_at": updated,
            }
        )
    if docs:
        liabilities_col.insert_many(docs)
    return get_liabilities()


# ── Budgets ──────────────────────────────────────────────────────────────────

class BudgetItem(BaseModel):
    category: str = Field(..., min_length=1, max_length=64)
    amount: float = Field(..., ge=0)

    @field_validator("category")
    @classmethod
    def valid_category(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in CATEGORIES:
            raise ValueError(f"category must be one of: {', '.join(CATEGORIES)}")
        return cleaned


class BudgetsPayload(BaseModel):
    budgets: list[BudgetItem] = Field(default_factory=list)


@app.get("/budgets")
def get_budgets():
    rows = []
    for doc in budgets_col.find():
        rows.append(
            {
                "category": doc.get("category"),
                "amount": float(doc.get("amount") or 0),
            }
        )
    rows.sort(key=lambda r: r["category"] or "")
    return {"budgets": rows}


@app.put("/budgets")
def put_budgets(payload: BudgetsPayload):
    budgets_col.delete_many({})
    docs = [
        {"category": b.category, "amount": float(b.amount), "updated_at": datetime.now(timezone.utc)}
        for b in payload.budgets
        if b.amount > 0
    ]
    if docs:
        budgets_col.insert_many(docs)
    return get_budgets()


# ── Export ───────────────────────────────────────────────────────────────────

@app.get("/export")
def export_data(format: str = Query(default="json", pattern="^(json|csv)$")):
    """Download transactions, investments, and liabilities."""
    txns = [_serialize(d) for d in transactions.find().sort("received_at", DESCENDING).limit(20000)]
    holdings = [_serialize_holding(d) for d in portfolio.find()]
    liabs = [_serialize_liability(d) for d in liabilities_col.find()]
    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "transactions": txns,
        "investments": holdings,
        "liabilities": liabs,
    }
    if format == "json":
        return JSONResponse(
            content=payload,
            headers={"Content-Disposition": "attachment; filename=money-track-export.json"},
        )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section", "field1", "field2", "field3", "field4", "field5", "field6"])
    for t in txns:
        writer.writerow(
            [
                "transaction",
                t.get("received_at"),
                t.get("type"),
                t.get("amount"),
                t.get("merchant"),
                t.get("category"),
                t.get("bank"),
            ]
        )
    for h in holdings:
        writer.writerow(
            [
                "investment",
                h.get("name"),
                h.get("asset_class"),
                h.get("invested"),
                h.get("current_value"),
                h.get("pnl"),
                h.get("source"),
            ]
        )
    for li in liabs:
        writer.writerow(
            [
                "liability",
                li.get("name"),
                li.get("type"),
                li.get("outstanding"),
                li.get("updated_at"),
                "",
                "",
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=money-track-export.csv"},
    )


# ── AI Insights ──────────────────────────────────────────────────────────────

class AiAskPayload(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)
    date_from: str | None = None
    date_to: str | None = None
    provider: str | None = None


@app.get("/ai/status")
def ai_status():
    return provider_status()


@app.post("/ai/ask")
def ai_ask(payload: AiAskPayload):
    start = _parse_optional_date(payload.date_from)
    end = _parse_optional_date(payload.date_to, end_of_day=True)
    analytics_data = build_analytics(
        transactions, date_from=start, date_to=end, portfolio=portfolio, networth_snapshots=networth_snapshots, liabilities=liabilities_col, budgets=budgets_col
    )
    try:
        return ask(payload.question, analytics_data, provider_name=payload.provider)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/ai/monthly-summary")
def ai_monthly_summary(
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
):
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    analytics_data = build_analytics(
        transactions, date_from=start, date_to=end, portfolio=portfolio, networth_snapshots=networth_snapshots, liabilities=liabilities_col, budgets=budgets_col
    )
    try:
        return monthly_summary(analytics_data, provider_name=provider)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/ai/anomalies")
def ai_anomalies(
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
):
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    analytics_data = build_analytics(
        transactions, date_from=start, date_to=end, portfolio=portfolio, networth_snapshots=networth_snapshots, liabilities=liabilities_col, budgets=budgets_col
    )
    try:
        return explain_anomalies(analytics_data, provider_name=provider)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/ai/categorize")
def ai_categorize(
    limit: int = Query(default=40, ge=1, le=100),
    use_llm: bool = Query(default=True),
    provider: str | None = None,
):
    return categorize_batch(
        transactions, limit=limit, use_llm=use_llm, provider_name=provider
    )
