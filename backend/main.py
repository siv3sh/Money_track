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
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from pymongo import DESCENDING, MongoClient

# Load .env before local modules that read os.getenv at import time (e.g. llm).
load_dotenv()

from parser import ALLOWED_BANKS, parse_sms
from import_agent import run_import_agent
from import_rag import ImportRAG, remember_import_examples
from agents.import_graph import (
    STAGE_ORDER,
    feedback_document_format,
    feedback_merchant_correction,
    run_import_pipeline,
)
from rag.vector_store import get_vector_store
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
from ai_insights import ask, categorize_batch, disambiguate_transfers, explain_anomalies, monthly_summary
from llm import LLMError, provider_status
from tally import compute_tally, run_ai_tally
from smart_insights import attach_smart_insights, find_ambiguous_transfers
from monthly_report import generate_monthly_report, get_report, list_reports
from email_report import email_configured, render_report_html, send_report_email
from advisor_persona import (
    default_persona_text,
    get_advisor_persona_settings,
    preview_samples,
    save_advisor_persona_settings,
)
from advisor_memory import list_memories as list_advisor_memories
from advisor_presence import (
    answer_lifecycle_nudge,
    chat as advisor_chat,
    decision_comment,
    get_or_create_session,
    goal_impact_for_spend,
    presence_bootstrap,
)
from planning import (
    BUCKETS,
    build_planning_summary,
    complete_goal_as_liability_txn,
    get_planning_settings,
    lookup_goal_price,
    record_contribution_month,
    save_planning_settings,
    serialize_goal,
)
from learned_facts import (
    ADVISOR_TRAINING_KEYS,
    FACT_TYPES,
    advisor_profile_from_facts,
    advisor_training_status,
    apply_answer,
    budget_targets_from_facts,
    delete_fact,
    facts_for_ai_context,
    generate_questions,
    list_facts,
    merchant_category_overrides,
    reconstruct_question_from_answer_payload,
    skip_question,
    update_fact,
    upsert_fact,
)

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
import_rag_examples = db["import_rag_examples"]
sip_overrides = db["sip_overrides"]
app_settings = db["app_settings"]
transfer_suggestions = db["transfer_suggestions"]
monthly_reports = db["monthly_reports"]
news_cache = db["news_cache"]
user_learned_facts = db["user_learned_facts"]
learn_question_events = db["learn_question_events"]
planning_goals = db["planning_goals"]
advisor_memories = db["advisor_memories"]
advisor_chat_sessions = db["advisor_chat_sessions"]

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
    sip_overrides.create_index([("instrument", 1), ("month", 1)], unique=True)
    transfer_suggestions.create_index("txn_id", unique=True)
    monthly_reports.create_index("month", unique=True)
    news_cache.create_index("expires_at")
    portfolio.create_index("instrument_key")
    portfolio.create_index("source")
    user_learned_facts.create_index([("fact_type", 1), ("key_norm", 1)], unique=True)
    learn_question_events.create_index([("at", -1)])
    learn_question_events.create_index("question_id")
    planning_goals.create_index([("status", 1), ("priority", 1)])
    advisor_memories.create_index([("occurred_at", -1)])
    advisor_memories.create_index("dedupe_key", unique=True, sparse=True)
    advisor_chat_sessions.create_index("session_key", unique=True)
    import_rag_examples.create_index([("created_at", DESCENDING)])
    import_rag_examples.create_index("kind")
except Exception as exc:  # noqa: BLE001 — allow import/boot without Mongo during local checks
    print(f"Warning: could not create Mongo indexes yet: {exc}")

# Seed MerchantKnowledge from existing category_memory (once, capped)
try:
    _vs = get_vector_store(db)
    existing = 0
    try:
        existing = _vs._mongo["merchant_knowledge"].estimated_document_count() if _vs._mongo is not None else 0
    except Exception:  # noqa: BLE001
        existing = 0
    if existing < 20:
        seeded = _vs.seed_from_category_memory(category_memory, limit=100)
        if seeded:
            print(f"Seeded MerchantKnowledge with {seeded} merchant corrections ({_vs.backend})")
except Exception as exc:  # noqa: BLE001
    print(f"Warning: MerchantKnowledge seed skipped: {exc}")


_import_rag_cache: ImportRAG | None = None


_import_rag_cache: ImportRAG | None = None


def _get_import_rag(*, force_reload: bool = False) -> ImportRAG:
    global _import_rag_cache
    if _import_rag_cache is not None and not force_reload and len(_import_rag_cache) > 0:
        return _import_rag_cache
    rag = ImportRAG()
    try:
        rag.load_from_mongo(
            category_memory=category_memory,
            transactions=transactions,
            rag_examples=import_rag_examples,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: import RAG load failed: {exc}")
        rag.seed_templates()
    _import_rag_cache = rag
    return rag


def _cross_source_fingerprints(limit: int = 8000) -> tuple[set[str], set[str]]:
    """Build exact/soft fingerprint sets across SMS + statement + all sources."""
    from agents.import_graph import _fingerprint, _soft_fingerprint

    exact: set[str] = set()
    soft: set[str] = set()
    for doc in transactions.find(
        {},
        {"type": 1, "amount": 1, "received_at": 1, "raw_text": 1, "merchant": 1},
    ).limit(limit):
        exact.add(_fingerprint(doc))
        soft.add(_soft_fingerprint(doc))
    return exact, soft


def _run_statement_langgraph(
    raw: bytes,
    filename: str,
    *,
    bank: str | None = None,
) -> dict[str, Any]:
    exact, soft = _cross_source_fingerprints()
    pipeline = run_import_pipeline(
        raw,
        filename,
        flow="statement",
        bank=bank,
        merchant_memory=_load_merchant_memory(),
        exact_fps=exact,
        soft_fps=soft,
        mongo_db=db,
    )
    # Auto-commit high-confidence rows through existing import path
    commit_docs = []
    for row in pipeline.get("commit_rows") or []:
        doc = {k: v for k, v in row.items() if not k.startswith("review_") and k != "dup_status"}
        doc.pop("anomaly_flags", None)
        doc.pop("category_confidence", None)
        # Keep category_source for apply_category preservation
        commit_docs.append(doc)

    agent_meta = {
        "protocol": pipeline.get("protocol"),
        "stage": pipeline.get("stage"),
        "stages": STAGE_ORDER,
        "steps": pipeline.get("steps") or [],
        "warnings": pipeline.get("warnings") or [],
        "vector_backend": pipeline.get("vector_backend"),
        "mapping_confidence": pipeline.get("mapping_confidence"),
        "needs_mapping_ui": pipeline.get("needs_mapping_ui"),
        "rag_hits": sum(
            1
            for s in (pipeline.get("steps") or [])
            if s.get("tool") == "categorization_agent"
        ),
        "rag_categorized": next(
            (
                (s.get("evidence") or {}).get("rag")
                for s in (pipeline.get("steps") or [])
                if s.get("tool") == "categorization_agent"
            ),
            0,
        ),
        "review_queue_count": len(pipeline.get("review_queue") or []),
        "review_questions": pipeline.get("review_questions") or [],
        "anomalies": pipeline.get("anomalies") or [],
    }

    # Persist DocumentFormat when mapping is confident
    if pipeline.get("header_signature") and not pipeline.get("needs_mapping_ui"):
        try:
            feedback_document_format(
                get_vector_store(db),
                flow="statement",
                header_signature=str(pipeline["header_signature"]),
                column_mapping=dict(pipeline.get("column_mapping") or {}),
                bank=(pipeline.get("profile") or {}).get("bank"),
                filename_hint=filename,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: DocumentFormat feedback failed: {exc}")

    result = _import_statement_docs(
        commit_docs,
        profile=pipeline.get("profile") or {},
        agent_meta=agent_meta,
        run_ai=True,
    )
    # Surface held rows for UI (not committed)
    result["review_queue"] = [
        {
            "merchant": clean_merchant_label(r.get("merchant"), fallback=r.get("raw_text")),
            "amount": r.get("amount"),
            "type": r.get("type"),
            "category": r.get("category"),
            "confidence": r.get("category_confidence"),
            "reason": r.get("review_reason"),
        }
        for r in (pipeline.get("review_queue") or [])[:40]
    ]
    result["pipeline_stage"] = pipeline.get("stage")
    result["pipeline_stages"] = STAGE_ORDER
    # Parsed = all candidates (commit + held), not only auto-committed
    result["parsed"] = len(commit_docs) + len(pipeline.get("review_queue") or [])
    return result


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
    try:
        # Learned merchant→category facts win over older memory on conflict
        memory.update(merchant_category_overrides(user_learned_facts))
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load learned merchant facts: {exc}")
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


def _import_statement_docs(
    docs: list[dict[str, Any]],
    *,
    profile: dict[str, Any] | None = None,
    run_ai: bool = True,
    agent_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not docs:
        return {
            "imported": 0,
            "skipped_duplicates": 0,
            "skipped_likely_duplicates": 0,
            "parsed": 0,
            "ids": [],
            "likely_duplicates": [],
            "detected": profile,
            "analysis": None,
            "agent": agent_meta,
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
    rag = _get_import_rag()
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
        # Second-pass RAG for remaining Other rows
        if (doc.get("category") or "Other") == "Other":
            suggestion = rag.suggest_category(
                f"{doc.get('merchant') or ''} {doc.get('raw_text') or ''}",
                bank=(profile or {}).get("bank") if profile else doc.get("bank"),
            )
            if suggestion:
                doc["category"] = suggestion["category"]
                doc["category_source"] = f"rag:{suggestion['source']}"
                doc["category_confidence"] = suggestion["confidence"]
        doc.pop("_investment_hint", None)
        to_insert.append(doc)

    ids: list[str] = []
    inserted_oids: list[Any] = []
    if to_insert:
        result = transactions.insert_many(to_insert)
        inserted_oids = list(result.inserted_ids)
        ids = [str(i) for i in inserted_oids]
        for doc, oid in zip(to_insert, inserted_oids):
            doc["_id"] = oid
        try:
            import_events.insert_one(
                {
                    "kind": "statement",
                    "imported": len(ids),
                    "skipped_duplicates": skipped,
                    "skipped_likely_duplicates": skipped_likely,
                    "parsed": len(docs),
                    "detected": profile,
                    "agent": agent_meta,
                    "created_at": datetime.now(timezone.utc),
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not log import event: {exc}")
        try:
            written = remember_import_examples(
                import_rag_examples,
                to_insert,
                bank=(profile or {}).get("bank") if profile else None,
            )
            if written:
                _get_import_rag(force_reload=True)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not index import RAG examples: {exc}")

    analysis = (
        _analyze_import_batch(to_insert, inserted_oids=inserted_oids, run_ai=run_ai)
        if to_insert
        else None
    )

    return {
        "imported": len(ids),
        "skipped_duplicates": skipped,
        "skipped_likely_duplicates": skipped_likely,
        "parsed": len(docs),
        "ids": ids,
        "likely_duplicates": likely_duplicates,
        "detected": profile,
        "analysis": analysis,
        "agent": agent_meta,
    }


def _analyze_import_batch(
    docs: list[dict[str, Any]],
    *,
    inserted_oids: list[Any] | None = None,
    run_ai: bool = True,
) -> dict[str, Any]:
    """Post-import breakdown + optional LLM categorization of remaining Other rows."""
    from collections import Counter

    by_category: Counter[str] = Counter()
    by_card: Counter[str] = Counter()
    debit = 0.0
    credit = 0.0
    invest = 0.0
    cc_spend = 0.0
    other_count = 0

    for d in docs:
        cat = str(d.get("category") or "Other")
        by_category[cat] += 1
        by_card[str(d.get("card_type") or "unknown")] += 1
        amt = float(d.get("amount") or 0)
        if d.get("type") == "credit":
            credit += amt
        else:
            debit += amt
            if cat == "Investments":
                invest += amt
            if d.get("card_type") == "credit_card":
                cc_spend += amt
            if cat == "Other":
                other_count += 1

    llm_note = None
    llm_updated = 0
    if run_ai and other_count > 0:
        try:
            result = categorize_batch(
                transactions,
                limit=min(50, max(other_count, 10)),
                use_llm=True,
                merchant_memory=_load_merchant_memory(),
            )
            llm_updated = int(result.get("updated") or 0)
            llm_note = f"AI reviewed unclear rows · updated {llm_updated}"
            if result.get("llm_error"):
                llm_note += f" · {result['llm_error']}"
            if inserted_oids:
                by_category = Counter()
                for d in transactions.find({"_id": {"$in": inserted_oids}}, {"category": 1}):
                    by_category[str(d.get("category") or "Other")] += 1
                other_count = by_category.get("Other", 0)
        except Exception as exc:  # noqa: BLE001
            llm_note = f"AI review skipped: {exc}"

    top_cats = [{"category": k, "count": v} for k, v in by_category.most_common(8)]
    highlights: list[str] = []
    if cc_spend:
        highlights.append(f"Credit card spend detected: ₹{cc_spend:,.0f}")
    if invest:
        highlights.append(f"Investments tagged: ₹{invest:,.0f}")
    if credit:
        highlights.append(f"Credits imported: ₹{credit:,.0f}")
    if debit:
        highlights.append(f"Debits imported: ₹{debit:,.0f}")
    if other_count:
        highlights.append(
            f"{other_count} still in Other — open AI Insights to teach merchants"
        )

    return {
        "debit_total": round(debit, 2),
        "credit_total": round(credit, 2),
        "investment_debit": round(invest, 2),
        "credit_card_spend": round(cc_spend, 2),
        "by_category": top_cats,
        "by_card_type": [{"card_type": k, "count": v} for k, v in by_card.most_common()],
        "highlights": highlights,
        "ai_note": llm_note,
        "ai_updated": llm_updated,
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

    advisor_nudge = None
    try:
        from advisor_presence import on_new_transaction

        advisor_nudge = on_new_transaction(
            txn={**doc, "_id": result.inserted_id},
            memories=advisor_memories,
            sessions=advisor_chat_sessions,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: advisor live nudge skipped: {exc}")

    return {
        "stored": True,
        "id": str(result.inserted_id),
        "transaction": {**txn, "category": doc.get("category"), "mcc": doc.get("mcc")},
        "advisor_nudge": advisor_nudge,
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
    """Paste CSV or line-based statement text — LangGraph multi-agent + RAG."""
    bank = (payload.bank or "").strip() or None
    if bank and bank not in ALLOWED_BANKS:
        raise HTTPException(
            status_code=400,
            detail=f"Only these banks are supported: {', '.join(sorted(ALLOWED_BANKS))}",
        )
    try:
        raw = (payload.content or "").encode("utf-8")
        return _run_statement_langgraph(
            raw,
            filename="paste.csv" if payload.format == "csv" else "paste.txt",
            bank=bank,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Failed to parse statement: {exc}") from exc


@app.post("/statements/upload")
async def upload_statement(
    file: UploadFile = File(...),
    bank: str | None = Form(default=None),
    format: str = Form(default="auto"),
):
    """Upload statement via LangGraph: extract → map → categorize → validate → review."""
    bank_s = (bank or "").strip() or None
    if bank_s and bank_s not in ALLOWED_BANKS:
        raise HTTPException(
            status_code=400,
            detail=f"Only these banks are supported: {', '.join(sorted(ALLOWED_BANKS))}",
        )
    name = (file.filename or "").lower()
    allowed = (".csv", ".txt", ".tsv", ".xlsx", ".xls", ".pdf")
    if not name.endswith(allowed):
        raise HTTPException(
            status_code=400,
            detail="Upload a .csv, .tsv, .txt, .xlsx, .xls, or .pdf file",
        )

    raw = await file.read()
    max_bytes = 8_000_000 if name.endswith(".pdf") else 5_000_000
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail="File too large (max 5–8MB)")

    try:
        return _run_statement_langgraph(raw, file.filename or name, bank=bank_s)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse statement: {exc}",
        ) from exc


@app.get("/import/pipeline/status")
def import_pipeline_status():
    store = get_vector_store(db)
    return {
        "protocol": "langgraph-import/v1",
        "stages": STAGE_ORDER,
        "vector_backend": store.backend,
    }


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
        now = datetime.now(timezone.utc)
        keys = {merchant.lower()}
        cleaned = clean_merchant_label(merchant, fallback=doc.get("raw_text")).strip().lower()
        if cleaned:
            keys.add(cleaned)
        for key in keys:
            category_memory.update_one(
                {"merchant_key": key},
                {
                    "$set": {
                        "merchant_key": key,
                        "merchant": merchant,
                        "category": payload.category,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
        try:
            feedback_merchant_correction(
                get_vector_store(db),
                description=f"{merchant} {doc.get('raw_text') or ''}",
                category=payload.category,
                merchant_key=cleaned or merchant.lower(),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: MerchantKnowledge feedback failed: {exc}")

    updated = transactions.find_one({"_id": oid})
    out_txn = _serialize(updated or doc)
    comment = decision_comment(
        action="category_change",
        payload={
            "amount": out_txn.get("amount"),
            "merchant": out_txn.get("merchant"),
            "category": payload.category,
            "wealth_class": out_txn.get("wealth_class"),
        },
        memories=advisor_memories,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    impact = goal_impact_for_spend(
        amount=float(out_txn.get("amount") or 0),
        category=payload.category,
        goals_col=planning_goals,
        learned_facts=user_learned_facts,
        settings=app_settings,
    )
    return {
        "ok": True,
        "transaction": out_txn,
        "advisor_comment": comment,
        "goal_impact": impact,
    }


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
    payload = build_analytics(
        transactions,
        date_from=start,
        date_to=end,
        banks=banks,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities_col,
        budgets=budgets_col,
        learned_facts=user_learned_facts,
    )
    return attach_smart_insights(
        payload,
        transactions,
        sip_overrides=sip_overrides,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
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
    """Parse export via LangGraph extraction + schema-mapping RAG; keep manual map UI as fallback."""
    name = (file.filename or "").lower()
    if not name.endswith((".csv", ".tsv", ".txt", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Upload a CSV or Excel file")
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    try:
        pipeline = run_import_pipeline(
            raw,
            file.filename or name,
            flow="indmoney",
            mongo_db=db,
        )
        headers = list(pipeline.get("headers") or [])
        raw_rows = []
        # Prefer classic tabular parse for sample accuracy
        try:
            headers2, rows = read_tabular_file(raw, file.filename or name)
            if headers2:
                headers = headers2
                raw_rows = rows
        except Exception:  # noqa: BLE001
            rows = []
        if not headers:
            raise HTTPException(status_code=422, detail="No header row found")
        mapping = dict(pipeline.get("column_mapping") or suggest_mapping(headers))
        return {
            "filename": file.filename,
            "headers": headers,
            "row_count": len(raw_rows) or pipeline.get("raw_row_count") or 0,
            "sample_rows": (raw_rows or [])[:8],
            "suggested_mapping": mapping,
            "fields": TARGET_FIELDS,
            "mapping_confidence": pipeline.get("mapping_confidence") or 0,
            "needs_mapping_ui": bool(pipeline.get("needs_mapping_ui")),
            "pipeline_stage": pipeline.get("stage"),
            "pipeline_stages": STAGE_ORDER,
            "agent": {
                "protocol": pipeline.get("protocol"),
                "steps": pipeline.get("steps") or [],
                "warnings": pipeline.get("warnings") or [],
                "vector_backend": pipeline.get("vector_backend"),
                "sheets": pipeline.get("sheets") or [],
            },
            "header_signature": pipeline.get("header_signature"),
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}") from exc


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
        headers, rows = read_tabular_file(raw, file.filename or "export.csv")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}") from exc
    result = apply_mapping(rows, mapping)
    # Feedback loop: store confirmed mapping in DocumentFormat
    try:
        sig = "|".join(h.strip().lower() for h in headers)
        feedback_document_format(
            get_vector_store(db),
            flow="indmoney",
            header_signature=sig,
            column_mapping=mapping if isinstance(mapping, dict) else {},
            sheet_purpose="holdings",
            filename_hint=file.filename,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: INDmoney DocumentFormat feedback failed: {exc}")
    return result


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
        headers, rows = read_tabular_file(raw, file.filename or "export.csv")
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
    try:
        sig = "|".join(h.strip().lower() for h in headers)
        feedback_document_format(
            get_vector_store(db),
            flow="indmoney",
            header_signature=sig,
            column_mapping=mapping,
            sheet_purpose="holdings",
            filename_hint=file.filename,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: INDmoney DocumentFormat feedback failed: {exc}")
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


# ── Learn About Me ────────────────────────────────────────────────────────────

class LearnedFactCreate(BaseModel):
    fact_type: str = Field(..., min_length=3, max_length=40)
    key: str = Field(..., min_length=1, max_length=120)
    value: str | float | int = Field(...)
    plain_language: str | None = Field(default=None, max_length=400)
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("fact_type")
    @classmethod
    def valid_fact_type(cls, value: str) -> str:
        if value not in FACT_TYPES:
            raise ValueError(f"fact_type must be one of: {', '.join(FACT_TYPES)}")
        return value


class LearnedFactUpdate(BaseModel):
    value: str | float | int | None = None
    plain_language: str | None = Field(default=None, max_length=400)


class LearnAnswerPayload(BaseModel):
    question_id: str = Field(..., min_length=4, max_length=40)
    fact_type: str
    key: str = Field(..., min_length=1, max_length=120)
    choice_id: str | None = None
    free_text: str | None = Field(default=None, max_length=200)
    choices: list[dict[str, Any]] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("fact_type")
    @classmethod
    def valid_fact_type(cls, value: str) -> str:
        if value not in FACT_TYPES:
            raise ValueError(f"fact_type must be one of: {', '.join(FACT_TYPES)}")
        return value


class LearnSkipPayload(BaseModel):
    question_id: str = Field(..., min_length=4, max_length=40)
    fact_type: str | None = None
    key: str | None = None


def _with_learned_context(analytics_data: dict[str, Any]) -> dict[str, Any]:
    try:
        analytics_data["learned_about_you"] = facts_for_ai_context(user_learned_facts)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load learned facts for AI: {exc}")
        analytics_data["learned_about_you"] = []
    return analytics_data


@app.get("/learn/facts")
def learn_facts_list():
    return {"facts": list_facts(user_learned_facts)}


@app.post("/learn/facts")
def learn_facts_create(payload: LearnedFactCreate):
    try:
        fact = upsert_fact(
            user_learned_facts,
            fact_type=payload.fact_type,
            key=payload.key,
            value=payload.value,
            source="user_answered",
            plain_language=payload.plain_language,
            meta=payload.meta,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Side effects for budget / merchant
    if payload.fact_type == "budget_target":
        try:
            amt = float(payload.value)
            if amt > 0:
                budgets_col.update_one(
                    {"category": payload.key},
                    {
                        "$set": {
                            "category": payload.key,
                            "amount": amt,
                            "updated_at": datetime.now(timezone.utc),
                            "source": "learned",
                        }
                    },
                    upsert=True,
                )
        except (TypeError, ValueError):
            pass
    if payload.fact_type in {"category_intent", "merchant_correction"}:
        cat = str(payload.value)
        if cat in CATEGORIES:
            mk = payload.key.lower()
            category_memory.update_one(
                {"merchant_key": mk},
                {
                    "$set": {
                        "merchant_key": mk,
                        "merchant": payload.key,
                        "category": cat,
                        "updated_at": datetime.now(timezone.utc),
                        "source": "learned",
                    }
                },
                upsert=True,
            )
    return {"fact": fact}


@app.patch("/learn/facts/{fact_id}")
def learn_facts_patch(fact_id: str, payload: LearnedFactUpdate):
    updated = update_fact(
        user_learned_facts,
        fact_id,
        value=payload.value,
        plain_language=payload.plain_language,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"fact": updated}


@app.delete("/learn/facts/{fact_id}")
def learn_facts_delete(fact_id: str):
    if not delete_fact(user_learned_facts, fact_id):
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"ok": True}


@app.get("/learn/questions")
def learn_questions(
    date_from: str | None = None,
    date_to: str | None = None,
):
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    analytics_data = attach_smart_insights(
        build_analytics(
            transactions,
            date_from=start,
            date_to=end,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            learned_facts=user_learned_facts,
        ),
        transactions,
        sip_overrides=sip_overrides,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    questions = generate_questions(
        facts=user_learned_facts,
        events=learn_question_events,
        transactions=transactions,
        analytics=analytics_data,
        category_memory=category_memory,
    )
    return {"questions": questions, "weekly_limit": 2}


@app.post("/learn/questions/answer")
def learn_questions_answer(payload: LearnAnswerPayload):
    question = reconstruct_question_from_answer_payload(payload.model_dump())
    try:
        fact = apply_answer(
            facts=user_learned_facts,
            events=learn_question_events,
            category_memory=category_memory,
            budgets_col=budgets_col,
            question=question,
            choice_id=payload.choice_id,
            free_text=payload.free_text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Feedback loop → MerchantKnowledge vector store
    try:
        if fact and fact.get("fact_type") in {"merchant_correction", "category_intent"}:
            feedback_merchant_correction(
                get_vector_store(db),
                description=str(fact.get("key") or ""),
                category=str(fact.get("value") or payload.choice_id or ""),
                merchant_key=str(fact.get("key") or "").lower(),
            )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: learn→MerchantKnowledge feedback failed: {exc}")
    return {"fact": fact, "ok": True}


@app.post("/learn/questions/skip")
def learn_questions_skip(payload: LearnSkipPayload):
    skip_question(
        learn_question_events,
        {
            "id": payload.question_id,
            "fact_type": payload.fact_type,
            "key": payload.key,
        },
    )
    return {"ok": True}


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
    analytics_data = _with_learned_context(
        attach_smart_insights(
            build_analytics(
                transactions,
                date_from=start,
                date_to=end,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    )
    try:
        return ask(
            payload.question,
            analytics_data,
            provider_name=payload.provider,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
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
    analytics_data = _with_learned_context(
        attach_smart_insights(
            build_analytics(
                transactions,
                date_from=start,
                date_to=end,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    )
    try:
        return monthly_summary(
            analytics_data,
            provider_name=provider,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
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
    analytics_data = _with_learned_context(
        attach_smart_insights(
            build_analytics(
                transactions,
                date_from=start,
                date_to=end,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    )
    try:
        return explain_anomalies(
            analytics_data,
            provider_name=provider,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/ai/tally")
def ai_tally(
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
    use_llm: bool = Query(default=True),
):
    """Sense-check: does income, spend, investments, and transfers tell a coherent story?"""
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    pack = compute_tally(transactions, date_from=start, date_to=end)
    analytics_data = _with_learned_context(
        attach_smart_insights(
            build_analytics(
                transactions,
                date_from=start,
                date_to=end,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
    )
    explanation: dict[str, Any] | None = None
    if use_llm:
        try:
            explanation = run_ai_tally(
                pack,
                analytics=analytics_data,
                provider_name=provider,
                settings=app_settings,
                learned_facts=user_learned_facts,
                goals_col=planning_goals,
            )
        except LLMError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "tally": pack,
        "ai": explanation,
        "provider": (explanation or {}).get("provider"),
    }


@app.post("/ai/categorize")
def ai_categorize(
    limit: int = Query(default=40, ge=1, le=100),
    use_llm: bool = Query(default=True),
    provider: str | None = None,
):
    return categorize_batch(
        transactions,
        limit=limit,
        use_llm=use_llm,
        provider_name=provider,
        merchant_memory=_load_merchant_memory(),
        settings=app_settings,
        learned_facts=user_learned_facts,
    )


class SipMarkPayload(BaseModel):
    instrument: str = Field(..., min_length=1, max_length=120)
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


@app.post("/smart/sip/mark-invested")
def mark_sip_invested(payload: SipMarkPayload):
    month = payload.month or datetime.now(timezone.utc).strftime("%Y-%m")
    name = payload.instrument.strip()
    sip_overrides.update_one(
        {"instrument": name, "month": month},
        {
            "$set": {
                "instrument": name,
                "month": month,
                "marked_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    comment = decision_comment(
        action="sip_mark_invested",
        payload={"instrument": name, "month": month},
        memories=advisor_memories,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    return {"ok": True, "instrument": name, "month": month, "advisor_comment": comment}


@app.delete("/smart/sip/mark-invested")
def unmark_sip_invested(instrument: str = Query(...), month: str | None = None):
    ym = month or datetime.now(timezone.utc).strftime("%Y-%m")
    sip_overrides.delete_one({"instrument": instrument.strip(), "month": ym})
    return {"ok": True}


class DriftSettingsPayload(BaseModel):
    targets: dict[str, float] | None = None
    threshold_pp: float = Field(default=10.0, ge=1, le=50)
    use_current_as_baseline: bool = False


@app.get("/smart/drift-settings")
def get_drift_settings():
    doc = app_settings.find_one({"_id": "allocation"}) or {}
    return {
        "targets": doc.get("targets") or {},
        "baseline": doc.get("baseline") or {},
        "threshold_pp": float(doc.get("threshold_pp") or 10),
        "baseline_saved_at": doc.get("baseline_saved_at").isoformat()
        if isinstance(doc.get("baseline_saved_at"), datetime)
        else None,
    }


@app.put("/smart/drift-settings")
def put_drift_settings(payload: DriftSettingsPayload):
    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {"threshold_pp": payload.threshold_pp, "updated_at": now}
    if payload.targets is not None:
        update["targets"] = {str(k): float(v) for k, v in payload.targets.items() if float(v) > 0}
    if payload.use_current_as_baseline:
        analytics_data = build_analytics(
            transactions, portfolio=portfolio, networth_snapshots=networth_snapshots
        )
        holdings = (analytics_data.get("investments") or {}).get("holdings") or []
        total = sum(float(h.get("current_value") or 0) for h in holdings) or 1.0
        baseline: dict[str, float] = {}
        for h in holdings:
            cls = str(h.get("asset_class") or "Other")
            baseline[cls] = baseline.get(cls, 0) + float(h.get("current_value") or 0)
        update["baseline"] = {k: round(v / total * 100, 1) for k, v in baseline.items()}
        update["baseline_saved_at"] = now
    app_settings.update_one(
        {"_id": "allocation"},
        {"$set": update, "$setOnInsert": {"_id": "allocation"}},
        upsert=True,
    )
    return get_drift_settings()


@app.get("/ai/transfer-suggestions")
def list_transfer_suggestions():
    rows = list(transfer_suggestions.find({"status": "pending"}).sort("created_at", DESCENDING).limit(50))
    out = []
    for row in rows:
        out.append(
            {
                "id": str(row.get("txn_id")),
                "amount": row.get("amount"),
                "merchant": row.get("merchant"),
                "bank": row.get("bank"),
                "received_at": row.get("received_at"),
                "label": row.get("label"),
                "confidence": row.get("confidence"),
                "suggested_category": row.get("suggested_category"),
                "reason": row.get("reason"),
                "provider": row.get("provider"),
            }
        )
    return {"suggestions": out}


@app.post("/ai/disambiguate-transfers")
def ai_disambiguate_transfers(
    limit: int = Query(default=25, ge=1, le=40),
    provider: str | None = None,
):
    banks = sorted(
        {
            str(doc.get("bank") or "")
            for doc in transactions.find({}, {"bank": 1})
            if doc.get("bank")
        }
    )
    candidates = find_ambiguous_transfers(transactions, known_banks=banks, limit=limit)
    # Skip ones already pending
    pending_ids = {
        str(r["txn_id"])
        for r in transfer_suggestions.find({"status": "pending"}, {"txn_id": 1})
    }
    candidates = [c for c in candidates if c["id"] not in pending_ids]
    try:
        result = disambiguate_transfers(
            candidates,
            known_accounts=banks,
            provider_name=provider,
            settings=app_settings,
            learned_facts=user_learned_facts,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    stored = 0
    for s in result.get("suggestions") or []:
        transfer_suggestions.update_one(
            {"txn_id": s["id"]},
            {
                "$set": {
                    "txn_id": s["id"],
                    "amount": s.get("amount"),
                    "merchant": s.get("merchant"),
                    "bank": s.get("bank"),
                    "received_at": s.get("received_at"),
                    "label": s.get("label"),
                    "confidence": s.get("confidence"),
                    "suggested_category": s.get("suggested_category"),
                    "reason": s.get("reason"),
                    "provider": s.get("provider"),
                    "status": "pending",
                    "created_at": now,
                }
            },
            upsert=True,
        )
        stored += 1
    return {
        "scanned": len(candidates),
        "stored": stored,
        "provider": result.get("provider"),
        "suggestions": result.get("suggestions") or [],
    }


class TransferReviewPayload(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")


@app.post("/ai/transfer-suggestions/{txn_id}/review")
def review_transfer_suggestion(txn_id: str, payload: TransferReviewPayload):
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    suggestion = transfer_suggestions.find_one({"txn_id": txn_id, "status": "pending"})
    if not suggestion:
        raise HTTPException(status_code=404, detail="No pending suggestion")

    doc = transactions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaction not found")

    now = datetime.now(timezone.utc)
    if payload.action == "reject":
        transfer_suggestions.update_one(
            {"txn_id": txn_id},
            {"$set": {"status": "rejected", "reviewed_at": now}},
        )
        transactions.update_one(
            {"_id": oid},
            {"$set": {"transfer_review": "rejected"}},
        )
        return {"ok": True, "action": "reject"}

    # approve
    label = suggestion.get("label")
    if label == "self_transfer":
        category = "Transfers"
        review_flag = "approved_transfer"
    else:
        category = suggestion.get("suggested_category") or "Other"
        if category not in CATEGORIES:
            category = "Other"
        review_flag = "approved_spend"

    transactions.update_one(
        {"_id": oid},
        {
            "$set": {
                "category": category,
                "category_source": "disambiguation",
                "transfer_review": review_flag,
            }
        },
    )
    # Remember merchant → Transfers for self-transfers
    merchant = (doc.get("merchant") or "").strip()
    if label == "self_transfer" and merchant:
        for key in {
            merchant.lower(),
            clean_merchant_label(merchant, fallback=doc.get("raw_text")).strip().lower(),
        }:
            if not key:
                continue
            category_memory.update_one(
                {"merchant_key": key},
                {
                    "$set": {
                        "merchant_key": key,
                        "merchant": merchant,
                        "category": "Transfers",
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

    transfer_suggestions.update_one(
        {"txn_id": txn_id},
        {"$set": {"status": "approved", "reviewed_at": now, "applied_category": category}},
    )
    return {"ok": True, "action": "approve", "category": category}


# ── Monthly AI reports + email ───────────────────────────────────────────────


def _report_settings() -> dict[str, Any]:
    doc = app_settings.find_one({"_id": "monthly_report"}) or {}
    return {
        "email_enabled": bool(doc.get("email_enabled", True)),
        "recipient_email": str(doc.get("recipient_email") or "").strip(),
        "email_configured": email_configured(),
    }


class MonthlyReportSettingsPayload(BaseModel):
    email_enabled: bool = True
    recipient_email: str = Field(default="", max_length=200)


class GenerateReportPayload(BaseModel):
    year: int | None = Field(default=None, ge=2020, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)
    force: bool = False
    provider: str | None = None
    send_email: bool = False


@app.get("/reports/monthly")
def reports_monthly_list(limit: int = Query(default=24, ge=1, le=60)):
    return {"reports": list_reports(monthly_reports, limit=limit), "settings": _report_settings()}


@app.get("/reports/monthly/{month}")
def reports_monthly_get(month: str):
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    doc = get_report(monthly_reports, month)
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc


@app.get("/reports/monthly-settings")
def get_monthly_report_settings():
    return _report_settings()


@app.put("/reports/monthly-settings")
def put_monthly_report_settings(payload: MonthlyReportSettingsPayload):
    email = payload.recipient_email.strip()
    if email and "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    app_settings.update_one(
        {"_id": "monthly_report"},
        {
            "$set": {
                "email_enabled": payload.email_enabled,
                "recipient_email": email,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"_id": "monthly_report"},
        },
        upsert=True,
    )
    return _report_settings()


@app.post("/reports/monthly/generate")
def reports_monthly_generate(payload: GenerateReportPayload):
    try:
        report = generate_monthly_report(
            transactions,
            monthly_reports,
            year=payload.year,
            month=payload.month,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            sip_overrides=sip_overrides,
            settings=app_settings,
            news_cache=news_cache,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            provider_name=payload.provider,
            force=payload.force,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}") from exc

    email_result = None
    if payload.send_email:
        settings = _report_settings()
        to = settings.get("recipient_email") or ""
        if not settings.get("email_enabled"):
            email_result = {"ok": False, "reason": "email disabled in settings"}
        elif not to:
            email_result = {"ok": False, "reason": "recipient_email not set"}
        else:
            try:
                email_result = send_report_email(
                    report,
                    to_email=to,
                    advisor_profile=__import__('learned_facts', fromlist=['advisor_profile_from_facts']).advisor_profile_from_facts(user_learned_facts),
                )
                monthly_reports.update_one(
                    {"month": report["month"]},
                    {"$set": {"emailed_at": datetime.now(timezone.utc)}},
                )
                report["emailed_at"] = email_result.get("sent_at")
            except Exception as exc:  # noqa: BLE001
                email_result = {"ok": False, "reason": str(exc)}

    return {"report": report, "email": email_result}


@app.post("/jobs/monthly-report")
def job_monthly_report(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    force: bool = Query(default=False),
    send_email: bool = Query(default=True),
):
    """Cron entrypoint — protected by API_KEY. Generates prior-month report + optional email."""
    if not API_KEY or not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")

    try:
        report = generate_monthly_report(
            transactions,
            monthly_reports,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            sip_overrides=sip_overrides,
            settings=app_settings,
            news_cache=news_cache,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            force=force,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    email_result = None
    settings = _report_settings()
    if send_email and settings.get("email_enabled"):
        to = settings.get("recipient_email") or ""
        if to and email_configured():
            try:
                email_result = send_report_email(
                    report,
                    to_email=to,
                    advisor_profile=__import__('learned_facts', fromlist=['advisor_profile_from_facts']).advisor_profile_from_facts(user_learned_facts),
                )
                monthly_reports.update_one(
                    {"month": report["month"]},
                    {"$set": {"emailed_at": datetime.now(timezone.utc)}},
                )
            except Exception as exc:  # noqa: BLE001
                email_result = {"ok": False, "reason": str(exc)}
        else:
            email_result = {
                "ok": False,
                "reason": "missing recipient_email or RESEND_API_KEY",
            }

    return {
        "ok": True,
        "month": report.get("month"),
        "report_id": report.get("id"),
        "email": email_result,
    }


@app.get("/reports/monthly/{month}/preview-html")
def reports_monthly_preview_html(month: str):
    """Debug/preview the email HTML body."""
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    doc = get_report(monthly_reports, month)
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return HTMLResponse(
        render_report_html(
            doc,
            advisor_profile=__import__('learned_facts', fromlist=['advisor_profile_from_facts']).advisor_profile_from_facts(user_learned_facts),
        )
    )


# ── Money Planning ───────────────────────────────────────────────────────────


class PlanningSettingsPayload(BaseModel):
    bucket_pcts: dict[str, float] | None = None
    category_buckets: dict[str, str] | None = None
    emi_annual_rate: float | None = Field(default=None, ge=0, le=1)
    emi_tenure_months: int | None = Field(default=None, ge=1, le=60)
    liquid_buffer_override: float | None = Field(default=None, ge=0)


class GoalCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    target_date: str | None = None
    manual_price: float | None = Field(default=None, ge=0)
    monthly_contribution: float | None = Field(default=None, ge=0)
    lookup_price: bool = True
    provider: str | None = None


class GoalUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_date: str | None = None
    manual_price: float | None = Field(default=None, ge=0)
    target_price: float | None = Field(default=None, ge=0)
    saved_amount: float | None = Field(default=None, ge=0)
    monthly_contribution: float | None = Field(default=None, ge=0)
    priority: int | None = Field(default=None, ge=0, le=10_000)
    status: str | None = None
    confirm_price: bool | None = None
    timing_note: str | None = None


class GoalContributePayload(BaseModel):
    amount: float = Field(..., gt=0)


class GoalReorderPayload(BaseModel):
    ordered_ids: list[str] = Field(..., min_length=1)


class GoalPriceLookupPayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider: str | None = None


class GoalCompletePayload(BaseModel):
    amount: float | None = Field(default=None, ge=0)


def _planning_month_args(month: str | None) -> tuple[int | None, int | None]:
    if not month:
        return None, None
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    y, m = month.split("-")
    return int(y), int(m)


def _get_goal_or_404(goal_id: str) -> dict[str, Any]:
    try:
        oid = ObjectId(goal_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid goal id") from exc
    doc = planning_goals.find_one({"_id": oid, "status": {"$ne": "deleted"}})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal not found")
    return doc


@app.get("/planning/summary")
def planning_summary(month: str | None = Query(default=None)):
    year, month_num = _planning_month_args(month)
    try:
        return build_planning_summary(
            transactions=transactions,
            goals_col=planning_goals,
            settings_col=app_settings,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            learned_facts=user_learned_facts,
            persona_settings=app_settings,
            year=year,
            month=month_num,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Planning summary failed: {exc}") from exc


@app.get("/planning/settings")
def planning_get_settings():
    return get_planning_settings(app_settings)


class AdvisorPersonaPayload(BaseModel):
    persona_text: str | None = Field(default=None, max_length=12000)
    strictness_sensitivity: int | None = Field(default=None, ge=0, le=100)
    reset_persona_to_default: bool = False


@app.get("/advisor/persona")
def advisor_persona_get():
    cfg = get_advisor_persona_settings(app_settings)
    return {
        **cfg,
        "default_persona_text": default_persona_text(),
        "preview": preview_samples(app_settings, user_learned_facts),
    }


@app.put("/advisor/persona")
def advisor_persona_put(payload: AdvisorPersonaPayload):
    return save_advisor_persona_settings(
        app_settings,
        persona_text=payload.persona_text,
        strictness_sensitivity=payload.strictness_sensitivity,
        reset_persona_to_default=payload.reset_persona_to_default,
    )


@app.get("/advisor/persona/preview")
def advisor_persona_preview():
    return preview_samples(app_settings, user_learned_facts)


class AdvisorChatPayload(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    provider: str | None = None


class AdvisorNudgeAnswerPayload(BaseModel):
    kind: str = Field(..., min_length=3, max_length=40)
    nudge_id: str = Field(..., min_length=3, max_length=200)
    answer: str = Field(..., min_length=1, max_length=400)
    free_text: str | None = Field(default=None, max_length=400)


class AdvisorDecisionPayload(BaseModel):
    action: str = Field(..., min_length=3, max_length=40)
    amount: float | None = None
    merchant: str | None = None
    category: str | None = None
    instrument: str | None = None
    goal_name: str | None = None
    wealth_class: str | None = None
    progress_pct: float | None = None


@app.get("/advisor/presence")
def advisor_presence_get():
    """Bootstrap floating chat: session, nudges, memories, briefing."""
    try:
        analytics_stub = attach_smart_insights(
            build_analytics(
                transactions,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
        )
        questions = generate_questions(
            facts=user_learned_facts,
            events=learn_question_events,
            transactions=transactions,
            analytics=analytics_stub,
            category_memory=category_memory,
        )
    except Exception:  # noqa: BLE001
        questions = []
    try:
        return presence_bootstrap(
            sessions=advisor_chat_sessions,
            memories=advisor_memories,
            transactions=transactions,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            learn_questions=questions,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Advisor presence failed: {exc}") from exc


@app.get("/advisor/chat/session")
def advisor_chat_session_get():
    return get_or_create_session(advisor_chat_sessions, period="week")


@app.post("/advisor/chat")
def advisor_chat_post(payload: AdvisorChatPayload):
    try:
        return advisor_chat(
            sessions=advisor_chat_sessions,
            memories=advisor_memories,
            question=payload.message,
            transactions=transactions,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities_col,
            budgets=budgets_col,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            provider_name=payload.provider,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Advisor chat failed: {exc}") from exc


@app.post("/advisor/nudge/answer")
def advisor_nudge_answer(payload: AdvisorNudgeAnswerPayload):
    """Remember credit/spend explanations for future chats."""
    kind = payload.kind.strip().lower()
    if kind not in {"credit_source", "spend_probe"}:
        raise HTTPException(status_code=400, detail="kind must be credit_source or spend_probe")
    try:
        return answer_lifecycle_nudge(
            memories=advisor_memories,
            learned_facts=user_learned_facts,
            kind=kind,
            nudge_id=payload.nudge_id.strip(),
            answer=payload.answer,
            free_text=payload.free_text,
            sessions=advisor_chat_sessions,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not save answer: {exc}") from exc


@app.post("/advisor/decision-comment")
def advisor_decision_comment(payload: AdvisorDecisionPayload):
    action = payload.action.strip()
    allowed = {
        "liability_txn",
        "category_change",
        "sip_mark_invested",
        "goal_contribute",
        "goal_complete",
        "drift_dismiss",
        "learn_question",
    }
    if action not in allowed:
        raise HTTPException(status_code=400, detail=f"action must be one of {sorted(allowed)}")
    comment = decision_comment(
        action=action,  # type: ignore[arg-type]
        payload=payload.model_dump(),
        memories=advisor_memories,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    impact = None
    if action in {"liability_txn", "category_change"} and payload.amount:
        impact = goal_impact_for_spend(
            amount=float(payload.amount),
            category=payload.category,
            goals_col=planning_goals,
            learned_facts=user_learned_facts,
            settings=app_settings,
        )
    return {**comment, "goal_impact": impact}


@app.get("/advisor/memories")
def advisor_memories_list(limit: int = Query(default=40, ge=1, le=100)):
    return {"memories": list_advisor_memories(advisor_memories, limit=limit)}


class AdvisorTrainAnswer(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    value: str = Field(..., min_length=1, max_length=400)


class AdvisorTrainPayload(BaseModel):
    answers: list[AdvisorTrainAnswer] = Field(default_factory=list)


@app.get("/planning/advisor/training")
def planning_advisor_training():
    return advisor_training_status(user_learned_facts)


@app.put("/planning/advisor/training")
def planning_advisor_train(payload: AdvisorTrainPayload):
    saved = []
    for ans in payload.answers:
        key = ans.key.strip().lower()
        if key not in ADVISOR_TRAINING_KEYS:
            raise HTTPException(status_code=400, detail=f"Unknown training key: {key}")
        fact = upsert_fact(
            user_learned_facts,
            fact_type="advisor_profile",
            key=key,
            value=ans.value.strip(),
            source="user_answered",
        )
        saved.append(fact)
    return {
        "saved": len(saved),
        "training": advisor_training_status(user_learned_facts),
    }


@app.put("/planning/settings")
def planning_put_settings(payload: PlanningSettingsPayload):
    if payload.bucket_pcts:
        unknown = set(payload.bucket_pcts) - set(BUCKETS)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown buckets: {', '.join(sorted(unknown))}")
    if payload.category_buckets:
        for cat, bucket in payload.category_buckets.items():
            if cat not in CATEGORIES:
                raise HTTPException(status_code=400, detail=f"Unknown category: {cat}")
            if bucket not in BUCKETS:
                raise HTTPException(status_code=400, detail=f"Unknown bucket: {bucket}")
    result = save_planning_settings(
        app_settings,
        bucket_pcts=payload.bucket_pcts,
        category_buckets=payload.category_buckets,
        emi_annual_rate=payload.emi_annual_rate,
        emi_tenure_months=payload.emi_tenure_months,
        liquid_buffer_override=payload.liquid_buffer_override,
    )
    if payload.bucket_pcts is not None:
        app_settings.update_one(
            {"_id": "planning"},
            {"$set": {"personal_plan_locked": True}},
        )
    return get_planning_settings(app_settings)


@app.get("/planning/goals")
def planning_list_goals(month: str | None = Query(default=None)):
    return planning_summary(month=month)


@app.post("/planning/goals")
def planning_create_goal(payload: GoalCreatePayload):
    now = datetime.now(timezone.utc)
    max_pri = planning_goals.find_one(
        {"status": "active"},
        sort=[("priority", DESCENDING)],
    )
    next_pri = int((max_pri or {}).get("priority") or 0) + 1

    price_lookup = None
    timing_note = None
    target_price = float(payload.manual_price or 0)
    if payload.lookup_price and not payload.manual_price:
        try:
            price_lookup = lookup_goal_price(payload.name, provider_name=payload.provider)
            target_price = float(price_lookup.get("approx_price_inr") or 0)
            timing_note = price_lookup.get("timing_note")
        except LLMError as exc:
            price_lookup = {
                "approx_price_inr": 0,
                "error": str(exc),
                "looked_up_at": now.isoformat(),
                "sources": [],
                "confidence": "low",
            }

    doc = {
        "name": payload.name.strip(),
        "target_price": target_price,
        "manual_price": float(payload.manual_price) if payload.manual_price is not None else None,
        "saved_amount": 0.0,
        "monthly_contribution": float(payload.monthly_contribution or 0),
        "target_date": payload.target_date,
        "priority": next_pri,
        "status": "active",
        "price_lookup": price_lookup,
        "timing_note": timing_note,
        "contribution_months": [],
        "streak_months": 0,
        "created_at": now,
        "updated_at": now,
    }
    res = planning_goals.insert_one(doc)
    doc["_id"] = res.inserted_id
    return {"goal": serialize_goal(doc), "needs_price_confirm": bool(price_lookup and not payload.manual_price)}


@app.put("/planning/goals/reorder")
def planning_goals_reorder(payload: GoalReorderPayload):
    now = datetime.now(timezone.utc)
    for idx, gid in enumerate(payload.ordered_ids, start=1):
        try:
            oid = ObjectId(gid)
        except InvalidId:
            continue
        planning_goals.update_one(
            {"_id": oid, "status": {"$ne": "deleted"}},
            {"$set": {"priority": idx, "updated_at": now}},
        )
    return planning_summary()


@app.patch("/planning/goals/{goal_id}")
def planning_update_goal(goal_id: str, payload: GoalUpdatePayload):
    doc = _get_goal_or_404(goal_id)
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if payload.name is not None:
        patch["name"] = payload.name.strip()
    if payload.target_date is not None:
        patch["target_date"] = payload.target_date or None
    if payload.manual_price is not None:
        patch["manual_price"] = float(payload.manual_price)
        patch["target_price"] = float(payload.manual_price)
    if payload.target_price is not None and payload.manual_price is None:
        patch["target_price"] = float(payload.target_price)
    if payload.saved_amount is not None:
        patch["saved_amount"] = float(payload.saved_amount)
    if payload.monthly_contribution is not None:
        patch["monthly_contribution"] = float(payload.monthly_contribution)
    if payload.priority is not None:
        patch["priority"] = int(payload.priority)
    if payload.status is not None:
        status = payload.status.strip().lower()
        if status not in {"active", "paused", "completed", "deleted"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        patch["status"] = status
    if payload.timing_note is not None:
        patch["timing_note"] = payload.timing_note or None
    if payload.confirm_price and doc.get("price_lookup"):
        approx = float((doc.get("price_lookup") or {}).get("approx_price_inr") or doc.get("target_price") or 0)
        patch["target_price"] = approx
        patch["manual_price"] = approx

    planning_goals.update_one({"_id": doc["_id"]}, {"$set": patch})
    updated = planning_goals.find_one({"_id": doc["_id"]}) or {**doc, **patch}
    return {"goal": serialize_goal(updated)}


@app.post("/planning/goals/{goal_id}/lookup-price")
def planning_goal_lookup_price(goal_id: str, payload: GoalPriceLookupPayload | None = None):
    doc = _get_goal_or_404(goal_id)
    name = (payload.name if payload and payload.name else None) or doc.get("name") or ""
    provider = payload.provider if payload else None
    try:
        lookup = lookup_goal_price(str(name), provider_name=provider)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    patch = {
        "price_lookup": lookup,
        "timing_note": lookup.get("timing_note"),
        "target_price": float(lookup.get("approx_price_inr") or doc.get("target_price") or 0),
        "updated_at": datetime.now(timezone.utc),
    }
    # Don't overwrite an explicit manual_price unless user cleared it
    if doc.get("manual_price") is None:
        planning_goals.update_one({"_id": doc["_id"]}, {"$set": patch})
    else:
        planning_goals.update_one(
            {"_id": doc["_id"]},
            {"$set": {"price_lookup": lookup, "timing_note": lookup.get("timing_note"), "updated_at": patch["updated_at"]}},
        )
    updated = planning_goals.find_one({"_id": doc["_id"]})
    return {"goal": serialize_goal(updated or doc), "lookup": lookup}


@app.post("/planning/goals/{goal_id}/contribute")
def planning_goal_contribute(goal_id: str, payload: GoalContributePayload):
    doc = _get_goal_or_404(goal_id)
    patch = record_contribution_month(doc, payload.amount)
    planning_goals.update_one({"_id": doc["_id"]}, {"$set": patch})
    updated = planning_goals.find_one({"_id": doc["_id"]})
    goal = serialize_goal(updated or {**doc, **patch})
    target = float(goal.get("manual_price") or goal.get("target_price") or 0)
    saved = float(goal.get("saved_amount") or 0)
    progress = round(min(100.0, saved / target * 100), 1) if target else 0
    comment = decision_comment(
        action="goal_contribute",
        payload={
            "amount": payload.amount,
            "goal_name": goal.get("name"),
            "progress_pct": progress,
        },
        memories=advisor_memories,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    return {"goal": goal, "advisor_comment": comment}


@app.post("/planning/goals/{goal_id}/complete")
def planning_goal_complete(goal_id: str, payload: GoalCompletePayload | None = None):
    doc = _get_goal_or_404(goal_id)
    amount = payload.amount if payload else None
    txn = complete_goal_as_liability_txn(transactions=transactions, goal=doc, amount=amount)
    now = datetime.now(timezone.utc)
    planning_goals.update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "status": "completed",
                "completed_at": now,
                "completion_txn_id": txn["transaction_id"],
                "updated_at": now,
                "saved_amount": float(txn["amount"]),
            }
        },
    )
    updated = planning_goals.find_one({"_id": doc["_id"]})
    comment = decision_comment(
        action="goal_complete",
        payload={"goal_name": doc.get("name"), "amount": txn.get("amount")},
        memories=advisor_memories,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
    )
    return {
        "goal": serialize_goal(updated or doc),
        "transaction": txn,
        "note": "Logged as liability-classified Shopping spend in your ledger.",
        "advisor_comment": comment,
    }


@app.delete("/planning/goals/{goal_id}")
def planning_goal_delete(goal_id: str):
    doc = _get_goal_or_404(goal_id)
    planning_goals.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "deleted", "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}
