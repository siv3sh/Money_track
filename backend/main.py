import os
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

import certifi
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from pymongo import DESCENDING, MongoClient

from parser import parse_sms
from statement_parser import parse_statement, parse_statement_file

load_dotenv()

app = FastAPI(title="SMS Money Tracker")

MONGO_URI = os.environ["MONGO_URI"]
client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=10000,
    tlsCAFile=certifi.where(),
)
db = client["money_tracker"]
transactions = db["transactions"]

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
except Exception as exc:  # noqa: BLE001 — allow import/boot without Mongo during local checks
    print(f"Warning: could not create Mongo indexes yet: {exc}")


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


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    out = {**doc, "_id": str(doc["_id"])}
    received = out.get("received_at")
    if isinstance(received, datetime):
        out["received_at"] = received.isoformat()
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


@app.post("/sms-webhook", dependencies=[Depends(require_api_key)])
def receive_sms(payload: SmsPayload):
    try:
        txn = parse_sms(payload.sender, payload.body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse SMS: {exc}",
        ) from exc

    if txn is None:
        return {"stored": False, "reason": "not a transaction SMS (spam, OTP, or unparseable)"}

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

    result = transactions.insert_one(doc)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to store transaction")

    return {"stored": True, "id": str(result.inserted_id), "transaction": txn}


def _import_statement_docs(docs: list[dict[str, Any]]) -> dict[str, Any]:
    if not docs:
        return {"imported": 0, "skipped_duplicates": 0, "parsed": 0, "ids": []}

    # Load recent fingerprints to skip obvious duplicates
    existing: set[str] = set()
    for doc in transactions.find({}, {"type": 1, "amount": 1, "received_at": 1, "raw_text": 1}).limit(5000):
        existing.add(_fingerprint(doc))

    to_insert: list[dict[str, Any]] = []
    skipped = 0
    for doc in docs:
        fp = _fingerprint(doc)
        if fp in existing:
            skipped += 1
            continue
        existing.add(fp)
        to_insert.append(doc)

    ids: list[str] = []
    if to_insert:
        result = transactions.insert_many(to_insert)
        ids = [str(i) for i in result.inserted_ids]

    return {
        "imported": len(ids),
        "skipped_duplicates": skipped,
        "parsed": len(docs),
        "ids": ids,
    }


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
    type: str | None = Query(default=None, pattern="^(debit|credit)$"),
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = Query(default="received_at", pattern="^(received_at|amount)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
):
    query: dict[str, Any] = {}
    if card_type:
        query["card_type"] = card_type
    if bank:
        query["bank"] = {"$regex": f"^{bank}$", "$options": "i"}
    if type:
        query["type"] = type

    received_filter: dict[str, Any] = {}
    if date_from:
        try:
            received_filter["$gte"] = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_from") from exc
    if date_to:
        try:
            received_filter["$lte"] = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_to") from exc
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
    pipeline = [
        {"$match": {"type": "debit", "merchant": {"$nin": [None, ""]}}},
        {
            "$group": {
                "_id": "$merchant",
                "amount": {"$sum": "$amount"},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"amount": -1}},
        {"$limit": limit},
    ]
    return [
        {
            "merchant": str(row["_id"]),
            "amount": float(row.get("amount") or 0),
            "count": int(row.get("count") or 0),
        }
        for row in transactions.aggregate(pipeline)
    ]
