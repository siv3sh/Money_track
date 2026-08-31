import os
import csv
import io
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import certifi
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from pymongo import DESCENDING, MongoClient, ReturnDocument

# Load .env before local modules that read os.getenv at import time (e.g. llm).
load_dotenv()

from parser import (
    ALLOWED_BANKS,
    coerce_amount,
    is_bank_ref_narration,
    is_credit_card_non_purchase_sms,
    is_phantom_bank_ref_amount,
    parse_sms,
)
from credit_cards import (
    backfill_credit_cards_from_transactions,
    get_credit_card_by_last4,
    list_credit_cards,
    sync_credit_cards_to_liabilities,
    upsert_credit_card_from_sms,
)
from import_rag import ImportRAG, remember_import_examples
from agents.import_graph import (
    STAGE_ORDER,
    feedback_document_format,
    feedback_merchant_correction,
    run_import_pipeline,
)
from statement_parser import PdfPasswordRequired
from rag.vector_store import get_vector_store
from categorizer import CATEGORIES, apply_category
from cc_payment_pairing import apply_cc_payoff_tags, scan_and_tag_payoffs
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
from report_pdf import render_report_pdf
from rate_limit import enforce_rate_limit
from sms_send import sms_configured
from otp_auth import (
    create_otp,
    deliver_otp,
    ensure_otp_indexes,
    find_user_by_destination,
    mask_destination,
    normalize_phone,
    resolve_destination,
    verify_otp,
)
from auth_users import (
    authenticate_user,
    create_access_token,
    create_password_reset_token,
    ensure_auth_indexes,
    ensure_default_linked_account,
    find_linked_by_token,
    get_current_user,
    get_primary_user,
    hash_password,
    is_admin_user,
    migrate_assign_user_id,
    normalize_email,
    purge_user_owned_data,
    register_user,
    reset_password_with_token,
    seed_user_from_env,
    serialize_linked_account,
    serialize_user,
    user_match,
    verify_password,
)
from advisor_persona import (
    default_persona_text,
    get_advisor_persona_settings,
    preview_samples,
    save_advisor_persona_settings,
)
from advisor_presence import (
    answer_lifecycle_nudge,
    chat as advisor_chat,
    decision_comment,
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

app = FastAPI(
    title="SMS Money Tracker",
    docs_url="/docs" if (os.getenv("ENV") or os.getenv("APP_ENV") or "").strip().lower() in {"development", "dev", "local", "test"} else None,
    redoc_url=None,
    openapi_url="/openapi.json" if (os.getenv("ENV") or os.getenv("APP_ENV") or "").strip().lower() in {"development", "dev", "local", "test"} else None,
)

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
credit_cards_col = db["credit_cards"]
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
users_col = db["users"]
linked_accounts_col = db["linked_accounts"]
otp_col = db["otp_challenges"]

API_KEY = os.getenv("API_KEY", "")
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:5173").strip().rstrip("/")
# Where phones POST SMS (API host). Do not use the Vercel frontend URL here.
WEBHOOK_PUBLIC_BASE = (
    os.getenv("WEBHOOK_PUBLIC_BASE", "").strip().rstrip("/")
    or os.getenv("API_PUBLIC_URL", "").strip().rstrip("/")
    or "http://localhost:8000"
)
_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "https://fin.sivesh-pb.com,https://money-track-rho-six.vercel.app"
)
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", _DEFAULT_CORS).split(",")
    if o.strip()
]
if not CORS_ORIGINS:
    raise RuntimeError("CORS_ORIGINS must list at least one origin (do not use *)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.users = users_col
app.state.linked_accounts = linked_accounts_col


def _is_public_path(path: str) -> bool:
    """Explicit public allowlist — never expose /sms-webhook/debug or docs-by-prefix alone."""
    if path == "/health" or path == "/auth/login" or path == "/auth/register":
        return True
    if path in {
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/otp/send",
        "/auth/otp/verify",
    }:
        return True
    if path.startswith("/jobs/"):
        return True
    # Legacy key webhook + token webhooks only (not /sms-webhook/debug)
    if path == "/sms-webhook" or path == "/email-webhook":
        return True
    parts = [p for p in path.split("/") if p]
    # /sms-webhook/{token} or /email-webhook/{token}
    if len(parts) == 2 and parts[0] in {"sms-webhook", "email-webhook"}:
        return parts[1] != "debug"
    # Optional OpenAPI only outside production
    env = (os.getenv("ENV") or os.getenv("APP_ENV") or "production").strip().lower()
    if env in {"development", "dev", "local", "test"}:
        if path.startswith("/docs") or path.startswith("/openapi") or path.startswith("/redoc"):
            return True
    return False


@app.middleware("http")
async def require_login_middleware(request: Request, call_next):
    """Gate app APIs behind login; SMS/email ingest + login + health stay public."""
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if _is_public_path(path):
        return await call_next(request)
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return JSONResponse({"detail": "Please log in"}, status_code=401)
    token = auth.split(" ", 1)[1].strip()
    try:
        from auth_users import decode_token

        payload = decode_token(token)
        uid = ObjectId(str(payload.get("sub")))
        user = users_col.find_one({"_id": uid})
        if not user:
            return JSONResponse({"detail": "Please log in"}, status_code=401)
        if user.get("disabled"):
            return JSONResponse(
                {"detail": "This account has been disabled"},
                status_code=403,
            )
        request.state.user = user
        request.state.user_id = uid
    except HTTPException as exc:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    except Exception:
        return JSONResponse({"detail": "Please log in"}, status_code=401)
    return await call_next(request)


# Useful indexes for the dashboard queries below (per-user where multi-tenant)
try:
    transactions.create_index([("received_at", DESCENDING)])
    transactions.create_index([("user_id", 1), ("received_at", DESCENDING)])
    transactions.create_index([("user_id", 1), ("type", 1), ("received_at", DESCENDING)])
    transactions.create_index("card_type")
    transactions.create_index("bank")
    transactions.create_index("type")
    transactions.create_index("category")
    transactions.create_index("user_id")
    transactions.create_index("linked_account_id")

    # Drop legacy global uniques that break open signup, then create per-user uniques.
    for col, name in (
        (credit_cards_col, "bank_1_last4_1"),
        (category_memory, "merchant_key_1"),
        (sip_overrides, "instrument_1_month_1"),
        (monthly_reports, "month_1"),
        (user_learned_facts, "fact_type_1_key_norm_1"),
        (advisor_chat_sessions, "session_key_1"),
        (portfolio, "instrument_key_1"),
    ):
        try:
            col.drop_index(name)
        except Exception:  # noqa: BLE001
            pass

    credit_cards_col.create_index([("user_id", 1), ("bank", 1), ("last4", 1)], unique=True)
    credit_cards_col.create_index([("user_id", 1), ("last4", 1)])
    liabilities_col.create_index(
        [("user_id", 1), ("source", 1), ("bank", 1), ("last4", 1)],
        unique=True,
        partialFilterExpression={"source": "credit_cards"},
    )
    try:
        liabilities_col.drop_index("source_1_bank_1_last4_1")
    except Exception:  # noqa: BLE001
        pass
    category_memory.create_index([("user_id", 1), ("merchant_key", 1)], unique=True)
    sip_overrides.create_index([("user_id", 1), ("instrument", 1), ("month", 1)], unique=True)
    transfer_suggestions.create_index([("user_id", 1), ("txn_id", 1)], unique=True)
    try:
        transfer_suggestions.drop_index("txn_id_1")
    except Exception:  # noqa: BLE001
        pass
    monthly_reports.create_index([("user_id", 1), ("month", 1)], unique=True)
    news_cache.create_index("expires_at")
    portfolio.create_index([("user_id", 1), ("instrument_key", 1)], unique=True, sparse=True)
    portfolio.create_index([("user_id", 1), ("source", 1)])
    user_learned_facts.create_index([("user_id", 1), ("fact_type", 1), ("key_norm", 1)], unique=True)
    budgets_col.create_index([("user_id", 1), ("category", 1)], unique=True)
    learn_question_events.create_index([("user_id", 1), ("at", -1)])
    learn_question_events.create_index("question_id")
    planning_goals.create_index([("user_id", 1), ("status", 1), ("priority", 1)])
    advisor_memories.create_index([("user_id", 1), ("occurred_at", -1)])
    advisor_memories.create_index([("user_id", 1), ("dedupe_key", 1)], unique=True, sparse=True)
    try:
        advisor_memories.drop_index("dedupe_key_1")
    except Exception:  # noqa: BLE001
        pass
    advisor_chat_sessions.create_index([("user_id", 1), ("session_key", 1)], unique=True)
    import_rag_examples.create_index([("created_at", DESCENDING)])
    import_rag_examples.create_index("kind")
    webhook_events.create_index([("user_id", 1), ("received_at", DESCENDING)])
    users_col.create_index("disabled")
    ensure_auth_indexes(users_col, linked_accounts_col)
    ensure_otp_indexes(otp_col)
except Exception as exc:  # noqa: BLE001 — allow import/boot without Mongo during local checks
    print(f"Warning: could not create Mongo indexes yet: {exc}")

# Seed login user + one-shot legacy orphan backfill + default linked phone
try:
    seeded = seed_user_from_env(users_col)
    primary = seeded or get_primary_user(users_col)
    if primary:
        ensure_default_linked_account(linked_accounts_col, user_id=primary["_id"])
        # NEVER re-assign orphans to the seed user on every boot after open signup —
        # that steals new users' unscoped docs. One-shot legacy migrate only.
        force = (os.getenv("FORCE_LEGACY_USER_MIGRATE") or "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        migrated_flag = app_settings.find_one({"_id": "legacy_user_id_migrated"})
        if force or not migrated_flag:
            counts = migrate_assign_user_id(db, primary["_id"])
            app_settings.update_one(
                {"_id": "legacy_user_id_migrated"},
                {
                    "$set": {
                        "at": datetime.now(timezone.utc),
                        "primary_user_id": primary["_id"],
                        "counts": counts,
                        "forced": force,
                    }
                },
                upsert=True,
            )
            print(f"Legacy user_id migrate applied for {primary.get('email')}: {counts}")
except Exception as exc:  # noqa: BLE001
    print(f"Warning: auth seed/migrate skipped: {exc}")

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


def _cross_source_fingerprints(
    limit: int = 8000,
    *,
    user_id: ObjectId | None = None,
) -> tuple[set[str], set[str]]:
    """Build exact/soft fingerprint sets across SMS + statement + all sources."""
    from agents.import_graph import _fingerprint, _soft_fingerprint

    exact: set[str] = set()
    soft: set[str] = set()
    q: dict[str, Any] = {}
    if user_id is not None:
        q["user_id"] = user_id
    for doc in transactions.find(
        q,
        {"type": 1, "amount": 1, "received_at": 1, "raw_text": 1, "merchant": 1},
    ).limit(limit):
        exact.add(_fingerprint(doc))
        soft.add(_soft_fingerprint(doc))
    return exact, soft


def _exc_detail(exc: BaseException) -> str:
    msg = str(exc).strip()
    return msg or exc.__class__.__name__


def _run_statement_langgraph(
    raw: bytes,
    filename: str,
    *,
    bank: str | None = None,
    pdf_password: str | None = None,
    user_id: ObjectId | None = None,
) -> dict[str, Any]:
    exact, soft = _cross_source_fingerprints(user_id=user_id)
    pipeline = run_import_pipeline(
        raw,
        filename,
        flow="statement",
        bank=bank,
        pdf_password=pdf_password,
        merchant_memory=_load_merchant_memory(user_id=user_id),
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
        user_id=user_id,
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


def _load_merchant_memory(*, user_id: ObjectId | None = None) -> dict[str, str]:
    memory: dict[str, str] = {}
    if user_id is None:
        return memory
    q: dict[str, Any] = {"user_id": user_id}
    try:
        for row in category_memory.find(q, {"merchant_key": 1, "category": 1}):
            key = (row.get("merchant_key") or "").strip().lower()
            cat = row.get("category")
            if key and cat:
                memory[key] = str(cat)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load category memory: {exc}")
    try:
        # Learned merchant→category facts win over older memory on conflict
        memory.update(merchant_category_overrides(user_learned_facts, user_id=user_id))
    except TypeError:
        try:
            memory.update(merchant_category_overrides(user_learned_facts))
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load learned merchant facts: {exc}")
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load learned merchant facts: {exc}")
    return memory


def _load_salary_needles(*, user_id: ObjectId | None = None) -> list[str]:
    try:
        from learned_facts import salary_needles_from_facts

        try:
            return salary_needles_from_facts(user_learned_facts, user_id=user_id)
        except TypeError:
            return salary_needles_from_facts(user_learned_facts)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load salary keywords: {exc}")
        return []


def _load_people_patterns(*, user_id: ObjectId | None = None) -> list[tuple[str, str]]:
    try:
        from learned_facts import people_patterns_from_facts

        try:
            return people_patterns_from_facts(user_learned_facts, user_id=user_id)
        except TypeError:
            return people_patterns_from_facts(user_learned_facts)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load people patterns: {exc}")
        return []


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
        amount = f"{coerce_amount(doc.get('amount'), 0.0) or 0.0:.2f}"
    except (TypeError, ValueError):
        amount = str(doc.get("amount"))
    return f"{doc.get('type')}|{amount}|{day}|{label}"


def _find_duplicate_transaction(doc: dict[str, Any]) -> dict[str, Any] | None:
    """Soft dedupe across SMS/email/statement so the same alert is not stored twice."""
    if doc.get("amount") is None or not doc.get("type"):
        return None
    ts = doc.get("received_at")
    if not isinstance(ts, datetime):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    day_start = ts.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    q: dict[str, Any] = {
        "type": doc["type"],
        "amount": doc["amount"],
        "received_at": {"$gte": day_start, "$lt": day_end},
    }
    if doc.get("user_id") is None:
        return None  # never cross-tenant dedupe without owner
    q["user_id"] = doc["user_id"]
    if doc.get("account_last4"):
        q["account_last4"] = doc["account_last4"]
    soft = _soft_fingerprint(doc)
    for existing in transactions.find(q).sort("received_at", DESCENDING).limit(25):
        if _soft_fingerprint(existing) == soft:
            return existing
        # Exact raw_text prefix match (same channel retry)
        if (existing.get("raw_text") or "")[:80] == (doc.get("raw_text") or "")[:80]:
            return existing
    return None


def _require_user_id(request: Request) -> ObjectId:
    uid = getattr(request.state, "user_id", None)
    if uid is None:
        raise HTTPException(status_code=401, detail="Please log in")
    return uid


def _settings_id(kind: str, user_id: ObjectId) -> str:
    """Per-tenant app_settings document id (allocation, monthly_report, …)."""
    return f"{kind}:{user_id}"


def _import_statement_docs(
    docs: list[dict[str, Any]],
    *,
    profile: dict[str, Any] | None = None,
    run_ai: bool = True,
    agent_meta: dict[str, Any] | None = None,
    user_id: ObjectId | None = None,
) -> dict[str, Any]:
    if user_id is None:
        raise HTTPException(status_code=401, detail="Please log in")
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
    existing_q: dict[str, Any] = {"user_id": user_id}
    for doc in transactions.find(
        existing_q,
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

    memory = _load_merchant_memory(user_id=user_id)
    rag = _get_import_rag()
    to_insert: list[dict[str, Any]] = []
    skipped = 0
    skipped_likely = 0
    likely_duplicates: list[dict[str, Any]] = []
    for doc in docs:
        raw = f"{doc.get('raw_text') or ''} {doc.get('merchant') or ''}"
        amt = coerce_amount(doc.get("amount"))
        if amt is None or amt <= 0:
            skipped += 1
            continue
        # Bank-ref gate (design parity with parser.py) + phantom UTR/NEOSIE filter
        if is_bank_ref_narration(raw):
            if is_phantom_bank_ref_amount(amt, raw, doc.get("type")):
                skipped += 1
                continue
        elif is_phantom_bank_ref_amount(amt, raw, doc.get("type")):
            skipped += 1
            continue
        doc["amount"] = amt
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
        apply_category(
            doc,
            memory,
            credit_card_accounts=list_credit_cards(credit_cards_col, user_id=user_id),
            salary_needles=_load_salary_needles(user_id=user_id),
            people_patterns=_load_people_patterns(user_id=user_id),
        )
        # Second-pass RAG for remaining Other rows
        if (doc.get("category") or "Other") == "Other":
            suggestion = rag.suggest_category(
                f"{doc.get('merchant') or ''} {doc.get('raw_text') or ''}",
                bank=(profile or {}).get("bank") if profile else doc.get("bank"),
            )
            if suggestion:
                doc["category"] = suggestion["category"]
                doc["category_source"] = f"rag:{suggestion['source']}"
                apply_cc_payoff_tags(
                    doc, list_credit_cards(credit_cards_col, user_id=user_id)
                )
                doc["category_confidence"] = suggestion["confidence"]
        doc.pop("_investment_hint", None)
        if user_id is not None:
            doc["user_id"] = user_id
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
                    "user_id": user_id,
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
        amt = coerce_amount(d.get("amount"), 0.0) or 0.0
        if d.get("type") == "credit":
            credit += amt
        else:
            debit += amt
            if cat == "Investments":
                invest += amt
            if d.get("card_type") == "credit_card" and not is_credit_card_non_purchase_sms(
                str(d.get("raw_text") or "")
            ):
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
                use_llm=False,
                merchant_memory=_load_merchant_memory(),
            )
            llm_updated = int(result.get("updated") or 0)
            llm_note = (
                f"Reviewed against category rules and merchant memory · updated {llm_updated}"
            )
            if result.get("llm_error"):
                llm_note += f" · {result['llm_error']}"
            if inserted_oids:
                by_category = Counter()
                for d in transactions.find({"_id": {"$in": inserted_oids}}, {"category": 1}):
                    by_category[str(d.get("category") or "Other")] += 1
                other_count = by_category.get("Other", 0)
        except Exception as exc:  # noqa: BLE001
            llm_note = f"Category review skipped: {exc}"

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


def _jsonable(value: Any) -> Any:
    """Recursively convert Mongo/BSON types so FastAPI jsonable_encoder succeeds."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    return value


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    out = _jsonable(doc)
    raw_merchant = out.get("merchant")
    if raw_merchant:
        out["merchant_raw"] = raw_merchant
        out["merchant"] = clean_merchant_label(raw_merchant, fallback=out.get("raw_text"))
    return out


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class LoginPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)


class RegisterPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=8, max_length=200)
    phone: str = Field(..., min_length=8, max_length=20)
    signup_code: str | None = Field(default=None, max_length=120)


class SetupPayload(BaseModel):
    platform: str = Field(..., pattern="^(ios|android)$")
    setup_completed: bool = True


class OnboardingPayload(BaseModel):
    onboarding_completed: bool = True


class ForgotPasswordPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)


class ResetPasswordPayload(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    password: str = Field(..., min_length=8, max_length=200)


class DeleteAccountPayload(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class OtpSendPayload(BaseModel):
    channel: str = Field(..., pattern="^(email|phone)$")
    destination: str = Field(..., min_length=3, max_length=200)
    purpose: str = Field(..., pattern="^(login|verify|reset)$")


class OtpVerifyPayload(BaseModel):
    channel: str = Field(..., pattern="^(email|phone)$")
    destination: str = Field(..., min_length=3, max_length=200)
    purpose: str = Field(..., pattern="^(login|verify|reset)$")
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str | None = Field(default=None, min_length=8, max_length=200)


class LinkedAccountCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    kind: str = Field(default="phone", pattern="^(phone|bank_source|email)$")
    identifier: str = Field(..., min_length=1, max_length=64)
    platform: str | None = Field(default=None, pattern="^(ios|android|email)$")


def _auth_token_response(user: dict[str, Any]) -> dict[str, Any]:
    token = create_access_token(user_id=str(user["_id"]), email=str(user.get("email") or ""))
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.post("/auth/login")
def auth_login(request: Request, payload: LoginPayload):
    enforce_rate_limit(request, bucket="auth_login", limit=20, window_sec=60)
    user = authenticate_user(users_col, payload.email, payload.password)
    return _auth_token_response(user)


@app.post("/auth/register")
def auth_register(request: Request, payload: RegisterPayload):
    enforce_rate_limit(request, bucket="auth_register", limit=10, window_sec=60)
    required_code = (os.getenv("SIGNUP_CODE") or "").strip()
    if required_code:
        given = (payload.signup_code or "").strip()
        if not given or given != required_code:
            raise HTTPException(status_code=403, detail="Invite code required or incorrect")
    phone = normalize_phone(payload.phone)
    user = register_user(users_col, payload.email, payload.password, phone=phone)
    ensure_default_linked_account(linked_accounts_col, user_id=user["_id"])
    # Kick off email (and phone when SMS is configured) verification OTPs.
    sent: dict[str, bool] = {"email": False, "phone": False}
    try:
        code = create_otp(otp_col, channel="email", destination=user["email"], purpose="verify")
        deliver_otp(channel="email", destination=user["email"], code=code, purpose="verify")
        sent["email"] = True
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: register email OTP failed: {exc}")
    if sms_configured():
        try:
            code = create_otp(otp_col, channel="phone", destination=phone, purpose="verify")
            deliver_otp(channel="phone", destination=phone, code=code, purpose="verify")
            sent["phone"] = True
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: register phone OTP failed: {exc}")
    out = _auth_token_response(user)
    out["otp_sent"] = sent
    out["sms_otp_available"] = sms_configured()
    return out


@app.post("/auth/otp/send")
def auth_otp_send(request: Request, payload: OtpSendPayload):
    enforce_rate_limit(request, bucket="auth_otp_send", limit=8, window_sec=60)
    channel = payload.channel  # type: ignore[assignment]
    purpose = payload.purpose  # type: ignore[assignment]
    destination = resolve_destination(channel, payload.destination)
    generic = {
        "ok": True,
        "detail": "If that account exists, a code was sent.",
        "channel": channel,
        "destination_masked": mask_destination(channel, destination),
        "sms_otp_available": sms_configured(),
    }

    if channel == "phone" and not sms_configured():
        raise HTTPException(
            status_code=503,
            detail="Phone OTP is not configured yet. Use email OTP or password.",
        )

    user = find_user_by_destination(users_col, channel=channel, destination=destination)

    if purpose == "login":
        if not user or user.get("disabled"):
            return generic
        # Phone login requires a stored phone (always true here); email always ok.
        code = create_otp(otp_col, channel=channel, destination=destination, purpose="login")
        deliver_otp(channel=channel, destination=destination, code=code, purpose="login")
        return generic

    if purpose == "reset":
        if not user or user.get("disabled"):
            return generic
        code = create_otp(otp_col, channel=channel, destination=destination, purpose="reset")
        deliver_otp(channel=channel, destination=destination, code=code, purpose="reset")
        return generic

    # purpose == verify — prefer authenticated user; else destination must match an account
    authed = getattr(request.state, "user", None)
    if authed:
        if channel == "email" and normalize_email(str(authed.get("email") or "")) != destination:
            raise HTTPException(status_code=400, detail="Email does not match this account")
        if channel == "phone" and (authed.get("phone") or "") != destination:
            raise HTTPException(status_code=400, detail="Phone does not match this account")
        user = authed
    if not user or user.get("disabled"):
        raise HTTPException(status_code=400, detail="Account not found for verification")
    code = create_otp(otp_col, channel=channel, destination=destination, purpose="verify")
    deliver_otp(channel=channel, destination=destination, code=code, purpose="verify")
    return {
        "ok": True,
        "detail": "Verification code sent.",
        "channel": channel,
        "destination_masked": mask_destination(channel, destination),
        "sms_otp_available": sms_configured(),
    }


@app.post("/auth/otp/verify")
def auth_otp_verify(request: Request, payload: OtpVerifyPayload):
    enforce_rate_limit(request, bucket="auth_otp_verify", limit=20, window_sec=60)
    channel = payload.channel  # type: ignore[assignment]
    purpose = payload.purpose  # type: ignore[assignment]
    destination = resolve_destination(channel, payload.destination)
    verify_otp(
        otp_col,
        channel=channel,
        destination=destination,
        purpose=purpose,
        code=payload.code,
    )
    user = find_user_by_destination(users_col, channel=channel, destination=destination)
    if not user or user.get("disabled"):
        raise HTTPException(status_code=400, detail="Account not found")

    now = datetime.now(timezone.utc)
    if purpose == "login":
        flag = "email_verified" if channel == "email" else "phone_verified"
        users_col.update_one({"_id": user["_id"]}, {"$set": {flag: True, "updated_at": now}})
        refreshed = users_col.find_one({"_id": user["_id"]}) or user
        return _auth_token_response(refreshed)

    if purpose == "verify":
        flag = "email_verified" if channel == "email" else "phone_verified"
        users_col.update_one({"_id": user["_id"]}, {"$set": {flag: True, "updated_at": now}})
        refreshed = users_col.find_one({"_id": user["_id"]}) or user
        return _auth_token_response(refreshed)

    # reset — require new password, then sign in
    new_password = (payload.new_password or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    flag = "email_verified" if channel == "email" else "phone_verified"
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                flag: True,
                "updated_at": now,
            },
            "$unset": {
                "password_reset_token_hash": "",
                "password_reset_expires": "",
            },
        },
    )
    refreshed = users_col.find_one({"_id": user["_id"]}) or user
    return _auth_token_response(refreshed)


@app.post("/auth/forgot-password")
def auth_forgot_password(request: Request, payload: ForgotPasswordPayload):
    """Always return ok so emails cannot be enumerated. Sends reset mail when Resend is configured."""
    enforce_rate_limit(request, bucket="auth_forgot", limit=8, window_sec=60)
    generic = {
        "ok": True,
        "detail": "If that email is registered, you will receive a reset link shortly.",
    }
    created = create_password_reset_token(users_col, payload.email)
    if not created:
        return generic
    user, raw_token = created
    try:
        from email_report import email_configured, send_transactional_email

        if not email_configured():
            print("Warning: password reset requested but RESEND_API_KEY is not set")
            return generic
        link = f"{APP_BASE_URL}/reset-password?token={raw_token}"
        email = str(user.get("email") or "")
        send_transactional_email(
            to_email=email,
            subject="Reset your Money Track password",
            html=(
                "<p>We received a request to reset your Money Track password.</p>"
                f'<p><a href="{link}">Reset password</a></p>'
                "<p>This link expires in 1 hour. If you did not ask for this, you can ignore this email.</p>"
            ),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: password reset email failed: {exc}")
    return generic


@app.post("/auth/reset-password")
def auth_reset_password(request: Request, payload: ResetPasswordPayload):
    enforce_rate_limit(request, bucket="auth_reset", limit=10, window_sec=60)
    user = reset_password_with_token(users_col, payload.token, payload.password)
    token = create_access_token(user_id=str(user["_id"]), email=str(user.get("email") or ""))
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.delete("/auth/me")
def auth_delete_me(payload: DeleteAccountPayload, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    if not verify_password(str(user.get("password_hash") or ""), payload.password):
        raise HTTPException(status_code=401, detail="Wrong password")
    oid = user["_id"]
    deleted = purge_user_owned_data(db, oid)
    users_col.delete_one({"_id": oid})
    return {"ok": True, "deleted": deleted}


@app.get("/auth/me")
def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    return serialize_user(user)


@app.patch("/auth/setup")
def auth_setup(payload: SetupPayload, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "setup_platform": payload.platform,
                "setup_completed": payload.setup_completed,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    refreshed = users_col.find_one({"_id": user["_id"]})
    return serialize_user(refreshed or user)


@app.patch("/auth/onboarding")
def auth_onboarding(payload: OnboardingPayload, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "onboarding_completed": payload.onboarding_completed,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    refreshed = users_col.find_one({"_id": user["_id"]})
    return serialize_user(refreshed or user)


def _require_admin(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user or not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


class AdminUserPatch(BaseModel):
    disabled: bool | None = None


@app.get("/admin/users")
def admin_list_users(request: Request):
    """List accounts with collection counts — admin (ADMIN_EMAIL / SEED_USER_EMAIL) only."""
    _require_admin(request)
    rows = []
    for doc in users_col.find().sort("created_at", 1):
        uid = doc["_id"]
        rows.append(
            {
                **serialize_user(doc),
                "counts": {
                    "transactions": transactions.count_documents({"user_id": uid}),
                    "linked_accounts": linked_accounts_col.count_documents({"user_id": uid}),
                    "portfolio": portfolio.count_documents({"user_id": uid}),
                    "liabilities": liabilities_col.count_documents({"user_id": uid}),
                    "learned_facts": user_learned_facts.count_documents({"user_id": uid}),
                    "goals": planning_goals.count_documents({"user_id": uid}),
                },
            }
        )
    return {
        "items": rows,
        "total_users": len(rows),
        "signup_code_required": bool((os.getenv("SIGNUP_CODE") or "").strip()),
    }


@app.patch("/admin/users/{user_id}")
def admin_patch_user(user_id: str, payload: AdminUserPatch, request: Request):
    admin = _require_admin(request)
    try:
        oid = ObjectId(user_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid user id") from exc
    target = users_col.find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["_id"] == admin["_id"] and payload.disabled:
        raise HTTPException(status_code=400, detail="You cannot disable your own admin account")
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if payload.disabled is not None:
        patch["disabled"] = payload.disabled
    users_col.update_one({"_id": oid}, {"$set": patch})
    refreshed = users_col.find_one({"_id": oid})
    return serialize_user(refreshed or target)


@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: str, request: Request):
    """Cascade-delete a user and their scoped data. Cannot delete yourself."""
    admin = _require_admin(request)
    try:
        oid = ObjectId(user_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid user id") from exc
    if oid == admin["_id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account")
    target = users_col.find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    deleted = purge_user_owned_data(db, oid)
    users_col.delete_one({"_id": oid})
    return {"ok": True, "email": target.get("email"), "deleted": deleted}


@app.get("/linked-accounts")
def list_linked_accounts(
    request: Request,
    reveal: bool = Query(default=False, description="Include private webhook URLs"),
):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    rows = list(linked_accounts_col.find({"user_id": user["_id"]}).sort("linked_at", 1))
    return {
        "items": [
            serialize_linked_account(
                r,
                include_token=reveal,
                webhook_base=WEBHOOK_PUBLIC_BASE,
            )
            for r in rows
        ],
        "webhook_base": WEBHOOK_PUBLIC_BASE,
    }


@app.post("/linked-accounts")
def create_linked_account(payload: LinkedAccountCreate, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    now = datetime.now(timezone.utc)
    ident = payload.identifier.strip()
    doc = {
        "user_id": user["_id"],
        "kind": payload.kind,
        "identifier": ident,
        "label": payload.label.strip(),
        "webhook_token": secrets.token_urlsafe(24),
        "linked_at": now,
        "last_seen_at": None,
        "active": True,
        "platform": payload.platform,
    }
    try:
        res = linked_accounts_col.insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=409,
            detail="That phone/bank source is already linked. Use a different label or number.",
        ) from exc
    doc["_id"] = res.inserted_id
    return serialize_linked_account(doc, include_token=True, webhook_base=WEBHOOK_PUBLIC_BASE)


class LinkedAccountUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    identifier: str | None = Field(default=None, min_length=1, max_length=64)
    platform: str | None = Field(default=None, pattern="^(ios|android)$")


@app.patch("/linked-accounts/{account_id}")
def update_linked_account(account_id: str, payload: LinkedAccountUpdate, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    try:
        oid = ObjectId(account_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid account id") from exc
    updates: dict[str, Any] = {}
    if payload.label is not None:
        updates["label"] = payload.label.strip()
    if payload.identifier is not None:
        updates["identifier"] = payload.identifier.strip()
    if payload.platform is not None:
        updates["platform"] = payload.platform
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = linked_accounts_col.find_one_and_update(
        {"_id": oid, "user_id": user["_id"], "active": {"$ne": False}},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Linked account not found")
    return serialize_linked_account(result, include_token=True, webhook_base=WEBHOOK_PUBLIC_BASE)


@app.post("/linked-accounts/{account_id}/rotate-token")
def rotate_linked_token(account_id: str, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    try:
        oid = ObjectId(account_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid account id") from exc
    token = secrets.token_urlsafe(24)
    result = linked_accounts_col.find_one_and_update(
        {"_id": oid, "user_id": user["_id"]},
        {"$set": {"webhook_token": token}},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Linked account not found")
    return serialize_linked_account(result, include_token=True, webhook_base=WEBHOOK_PUBLIC_BASE)


@app.delete("/linked-accounts/{account_id}")
def delete_linked_account(account_id: str, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    try:
        oid = ObjectId(account_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid account id") from exc
    count = linked_accounts_col.count_documents({"user_id": user["_id"], "active": {"$ne": False}})
    if count <= 1:
        raise HTTPException(
            status_code=400,
            detail="Keep at least one linked phone/account so SMS can still arrive.",
        )
    linked_accounts_col.update_one(
        {"_id": oid, "user_id": user["_id"]},
        {"$set": {"active": False}},
    )
    return {"ok": True}


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
    """Phones sometimes open the URL in a browser (GET). SMS must be POST."""
    return {
        "ok": False,
        "error": "Use POST, not GET",
        "ios": (
            "iPhone Shortcuts → Get Contents of URL → Method POST. "
            "Use your private webhook link from Money Track → Accounts. "
            "JSON body: sender + Message Contents."
        ),
        "android": (
            "MacroDroid or Tasker → HTTP Request POST to your private webhook link "
            "from Money Track → Accounts. JSON: sender + full SMS text."
        ),
    }


async def _ingest_sms_request(
    request: Request,
    *,
    linked_account: dict | None = None,
) -> dict:
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
            detail=f"Failed to parse SMS: {_exc_detail(exc)}",
        ) from exc

    if txn is None:
        card_snapshot = None
        try:
            card_snapshot = upsert_credit_card_from_sms(
                credit_cards_col,
                sender=payload.sender,
                body=payload.body,
                received_at=datetime.now(timezone.utc),
                user_id=linked_account.get("user_id"),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: credit card upsert skipped: {exc}")
        if card_snapshot:
            try:
                sync_credit_cards_to_liabilities(
                    credit_cards_col,
                    liabilities_col,
                    user_id=linked_account.get("user_id"),
                )
            except Exception as exc:  # noqa: BLE001
                print(f"Warning: credit card→liability sync skipped: {exc}")
        _log_webhook_event(
            {
                "stored": False,
                "reason": "not_a_transaction",
                "sender": payload.sender,
                "body": payload.body[:240],
                "credit_card_updated": bool(card_snapshot),
                "user_id": linked_account.get("user_id"),
            }
        )
        return {
            "stored": False,
            "reason": "not a transaction SMS (spam, OTP, unparseable, or CC non-spend alert)",
            "received": {"sender": payload.sender, "body": payload.body[:240]},
            "credit_card": card_snapshot,
        }

    received_at = (
        datetime.fromtimestamp(payload.timestamp / 1000, tz=timezone.utc)
        if payload.timestamp
        else datetime.now(timezone.utc)
    )
    doc = {
        **txn,
        "sender": payload.sender,
        "source": "sms",
        "received_at": received_at,
    }
    if linked_account:
        doc["user_id"] = linked_account.get("user_id")
        doc["linked_account_id"] = linked_account.get("_id")
        try:
            linked_accounts_col.update_one(
                {"_id": linked_account["_id"]},
                {"$set": {"last_seen_at": received_at}},
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: linked account last_seen update skipped: {exc}")
    _sms_uid = linked_account.get("user_id") if linked_account else doc.get("user_id")
    apply_category(
        doc,
        _load_merchant_memory(user_id=_sms_uid),
        credit_card_accounts=list_credit_cards(credit_cards_col, user_id=_sms_uid),
        salary_needles=_load_salary_needles(user_id=_sms_uid),
        people_patterns=_load_people_patterns(user_id=_sms_uid),
    )

    dup = _find_duplicate_transaction(doc)
    if dup:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "duplicate",
                "existing_id": str(dup["_id"]),
                "sender": payload.sender,
                "amount": txn.get("amount"),
                "type": txn.get("type"),
                "body": payload.body[:240],
            }
        )
        return {
            "stored": False,
            "reason": "duplicate — already tracked",
            "existing_id": str(dup["_id"]),
            "transaction": {**txn, "category": doc.get("category")},
        }

    result = transactions.insert_one(doc)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to store transaction")

    card_snapshot = None
    try:
        card_snapshot = upsert_credit_card_from_sms(
            credit_cards_col,
            sender=payload.sender,
            body=payload.body,
            received_at=received_at,
            user_id=linked_account.get("user_id"),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: credit card upsert skipped: {exc}")
    if card_snapshot:
        try:
            sync_credit_cards_to_liabilities(
                credit_cards_col,
                liabilities_col,
                user_id=linked_account.get("user_id"),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: credit card→liability sync skipped: {exc}")

    _log_webhook_event(
        {
            "stored": True,
            "id": str(result.inserted_id),
            "sender": payload.sender,
            "amount": txn.get("amount"),
            "type": txn.get("type"),
            "category": doc.get("category"),
            "body": payload.body[:240],
            "credit_card_updated": bool(card_snapshot),
            "user_id": linked_account.get("user_id"),
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
            transactions=transactions,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: advisor live nudge skipped: {exc}")

    return {
        "stored": True,
        "id": str(result.inserted_id),
        "transaction": {**txn, "category": doc.get("category"), "mcc": doc.get("mcc")},
        "credit_card": card_snapshot,
        "advisor_nudge": advisor_nudge,
    }




@app.post("/sms-webhook")
async def receive_sms(request: Request):
    """Legacy: API key auth — routes into the owner's primary linked account."""
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
    linked = None
    primary = get_primary_user(users_col)
    if primary:
        linked = linked_accounts_col.find_one(
            {"user_id": primary["_id"], "active": {"$ne": False}},
            sort=[("linked_at", 1)],
        )
    return await _ingest_sms_request(request, linked_account=linked)


@app.post("/sms-webhook/{token}")
async def receive_sms_with_token(token: str, request: Request):
    """Preferred: each phone/account has a private link (no shared API key)."""
    linked = find_linked_by_token(linked_accounts_col, token)
    if not linked:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "bad_webhook_token",
                "token_preview": (token[:6] + "…") if token else "",
            }
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "This SMS link is unknown or turned off. "
                "Open Money Track → Accounts and copy a fresh link for this phone."
            ),
        )
    return await _ingest_sms_request(request, linked_account=linked)


@app.get("/sms-webhook/debug")
def sms_webhook_debug(request: Request, limit: int = Query(default=20, ge=1, le=100)):
    """Recent webhook attempts for the logged-in user (bodies truncated, no token secrets)."""
    uid = _require_user_id(request)
    rows = list(
        webhook_events.find({"user_id": uid}).sort("received_at", DESCENDING).limit(limit)
    )
    out = []
    for row in rows:
        item = {k: v for k, v in row.items() if k not in {"_id", "body", "token_preview", "key_preview"}}
        item["id"] = str(row["_id"])
        item["body_preview"] = (str(row.get("body") or ""))[:80]
        received = item.get("received_at")
        if isinstance(received, datetime):
            item["received_at"] = received.isoformat()
        out.append(item)
    return {"count": len(out), "events": out}


@app.get("/email-webhook")
def email_webhook_get_hint():
    return {
        "ok": False,
        "error": "Use POST, not GET",
        "hint": (
            "Forward bank alert emails to an inbound service that POSTs JSON here, "
            "or paste an email on Money Track → Phones. "
            "JSON fields: from, subject, text (or html)."
        ),
    }


async def _ingest_email_request(
    request: Request,
    *,
    linked_account: dict | None = None,
    forced: dict[str, str] | None = None,
) -> dict:
    from email_ingest import normalize_email_payload, parse_bank_email
    from agents.import_graph import _fingerprint

    if forced:
        fields = {
            "from": forced.get("from", ""),
            "subject": forced.get("subject", ""),
            "text": forced.get("text", ""),
            "html": forced.get("html", ""),
        }
    else:
        content_type = (request.headers.get("content-type") or "").lower()
        data: dict[str, Any] = {}
        try:
            if "application/json" in content_type:
                raw = await request.json()
                data = raw if isinstance(raw, dict) else {}
            elif (
                "application/x-www-form-urlencoded" in content_type
                or "multipart/form-data" in content_type
            ):
                form = await request.form()
                data = {str(k): str(v) for k, v in form.items()}
            else:
                text = (await request.body()).decode("utf-8", errors="replace").strip()
                if text.startswith("{"):
                    try:
                        data = json.loads(text)
                    except Exception:
                        data = {"text": text}
                else:
                    data = {"text": text}
        except Exception as exc:  # noqa: BLE001
            _log_webhook_event(
                {"stored": False, "reason": "email_body_read_error", "error": str(exc), "channel": "email"}
            )
            raise HTTPException(status_code=400, detail=f"Could not read email body: {exc}") from exc
        fields = normalize_email_payload(data)

    sender = fields["from"]
    subject = fields["subject"]
    text = fields["text"]
    html = fields["html"]
    if not text and not html and not subject:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "missing_email_body",
                "channel": "email",
                "from": sender,
                "subject": subject,
            }
        )
        return {
            "stored": False,
            "reason": "missing email body",
            "hint": "Send JSON with from, subject, and text (or html) of the bank alert.",
        }

    try:
        txn = parse_bank_email(sender=sender, subject=subject, text=text, html=html)
    except Exception as exc:  # noqa: BLE001
        _log_webhook_event(
            {
                "stored": False,
                "reason": "email_parse_error",
                "channel": "email",
                "error": str(exc),
                "from": sender,
                "subject": subject[:120],
            }
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse email: {_exc_detail(exc)}",
        ) from exc

    if txn is None:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "not_a_transaction_email",
                "channel": "email",
                "from": sender,
                "subject": subject[:120],
            }
        )
        return {
            "stored": False,
            "reason": "not a bank transaction email (OTP, promo, or unparseable)",
            "received": {"from": sender, "subject": subject[:120]},
        }

    received_at = datetime.now(timezone.utc)
    doc = {
        **txn,
        "sender": sender or "EMAIL",
        "source": "email",
        "email_subject": subject or None,
        "received_at": received_at,
    }
    if linked_account:
        doc["user_id"] = linked_account.get("user_id")
        doc["linked_account_id"] = linked_account.get("_id")
        try:
            linked_accounts_col.update_one(
                {"_id": linked_account["_id"]},
                {"$set": {"last_seen_at": received_at}},
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: linked account last_seen update skipped: {exc}")

    _sms_uid = linked_account.get("user_id") if linked_account else doc.get("user_id")
    apply_category(
        doc,
        _load_merchant_memory(user_id=_sms_uid),
        credit_card_accounts=list_credit_cards(credit_cards_col, user_id=_sms_uid),
        salary_needles=_load_salary_needles(user_id=_sms_uid),
        people_patterns=_load_people_patterns(user_id=_sms_uid),
    )

    # Soft dedupe across SMS/statement/email (subject no longer poisons raw_text)
    dup = _find_duplicate_transaction(doc)
    if dup:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "duplicate_email",
                "channel": "email",
                "existing_id": str(dup["_id"]),
                "from": sender,
                "subject": subject[:120],
            }
        )
        return {
            "stored": False,
            "reason": "duplicate — already tracked (likely via SMS)",
            "existing_id": str(dup["_id"]),
        }

    result = transactions.insert_one(doc)
    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to store email transaction")

    _log_webhook_event(
        {
            "stored": True,
            "channel": "email",
            "id": str(result.inserted_id),
            "from": sender,
            "subject": subject[:120],
            "amount": txn.get("amount"),
            "type": txn.get("type"),
            "category": doc.get("category"),
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
            transactions=transactions,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: advisor live nudge skipped: {exc}")

    return {
        "stored": True,
        "id": str(result.inserted_id),
        "transaction": {**txn, "category": doc.get("category"), "mcc": doc.get("mcc")},
        "advisor_nudge": advisor_nudge,
    }


@app.post("/email-webhook/{token}")
async def receive_email_with_token(token: str, request: Request):
    """Private link for bank alert emails (Resend inbound / forwarder / Zapier)."""
    linked = find_linked_by_token(linked_accounts_col, token)
    if not linked:
        _log_webhook_event(
            {
                "stored": False,
                "reason": "bad_email_webhook_token",
                "channel": "email",
                "token_preview": (token[:6] + "…") if token else "",
            }
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "This email link is unknown or turned off. "
                "Open Money Track → Phones and copy a fresh email link."
            ),
        )
    return await _ingest_email_request(request, linked_account=linked)


class EmailPastePayload(BaseModel):
    from_address: str = Field(default="", max_length=200, alias="from")
    subject: str = Field(default="", max_length=300)
    text: str = Field(default="", max_length=20000)
    html: str = Field(default="", max_length=50000)

    model_config = {"populate_by_name": True}


@app.post("/email-ingest/paste")
async def paste_bank_email(payload: EmailPastePayload, request: Request):
    """Logged-in paste of a bank email — useful before wiring auto-forward."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please log in")
    linked = linked_accounts_col.find_one(
        {"user_id": user["_id"], "active": {"$ne": False}},
        sort=[("linked_at", 1)],
    )
    forced = {
        "from": payload.from_address,
        "subject": payload.subject,
        "text": payload.text,
        "html": payload.html,
    }
    return await _ingest_email_request(request, linked_account=linked, forced=forced)


@app.post("/statements/upload")
async def upload_statement(
    request: Request,
    file: UploadFile = File(...),
    bank: str | None = Form(default=None),
    format: str = Form(default="auto"),
    password: str | None = Form(default=None),
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

    pdf_password = (password or "").strip() or None
    try:
        return _run_statement_langgraph(
            raw,
            file.filename or name,
            bank=bank_s,
            pdf_password=pdf_password,
            user_id=_require_user_id(request),
        )
    except PdfPasswordRequired as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse statement: {_exc_detail(exc)}",
        ) from exc


@app.get("/transactions")
def list_transactions(
    request: Request,
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
    amount_min: float | None = Query(default=None, ge=0),
    amount_max: float | None = Query(default=None, ge=0),
):
    query: dict[str, Any] = {"user_id": _require_user_id(request)}
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

    amount_filter: dict[str, Any] = {}
    if amount_min is not None:
        amount_filter["$gte"] = float(amount_min)
    if amount_max is not None:
        amount_filter["$lte"] = float(amount_max)
    if amount_filter:
        query["amount"] = amount_filter

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
def update_transaction_category(request: Request, txn_id: str, payload: CategoryUpdate):
    uid = _require_user_id(request)
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    doc = transactions.find_one({"_id": oid, "user_id": uid})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaction not found")

    transactions.update_one(
        {"_id": oid, "user_id": uid},
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
                {"user_id": uid, "merchant_key": key},
                {
                    "$set": {
                        "merchant_key": key,
                        "merchant": merchant,
                        "category": payload.category,
                        "user_id": uid,
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

    updated = transactions.find_one({"_id": oid, "user_id": uid})
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
        user_id=uid,
    )
    impact = goal_impact_for_spend(
        amount=float(out_txn.get("amount") or 0),
        category=payload.category,
        goals_col=planning_goals,
        learned_facts=user_learned_facts,
        settings=app_settings,
        user_id=uid,
    )
    return {
        "ok": True,
        "transaction": out_txn,
        "advisor_comment": comment,
        "goal_impact": impact,
    }


@app.delete("/transactions/{txn_id}")
def delete_transaction(request: Request, txn_id: str):
    uid = _require_user_id(request)
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    result = transactions.delete_one({"_id": oid, "user_id": uid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True, "id": txn_id}


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


_ANALYTICS_CACHE: dict[str, tuple[float, Any]] = {}
_ANALYTICS_CACHE_TTL_SEC = 60.0
_ANALYTICS_CACHE_MAX = 64


def _analytics_cache_get(key: str) -> Any | None:
    hit = _ANALYTICS_CACHE.get(key)
    if not hit:
        return None
    ts, payload = hit
    if time.time() - ts > _ANALYTICS_CACHE_TTL_SEC:
        _ANALYTICS_CACHE.pop(key, None)
        return None
    return payload


def _analytics_cache_set(key: str, payload: Any) -> None:
    if len(_ANALYTICS_CACHE) >= _ANALYTICS_CACHE_MAX:
        oldest = min(_ANALYTICS_CACHE.items(), key=lambda kv: kv[1][0])[0]
        _ANALYTICS_CACHE.pop(oldest, None)
    _ANALYTICS_CACHE[key] = (time.time(), payload)


@app.get("/analytics")
def analytics(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    bank: str | None = Query(default=None, description="Comma-separated bank names"),
    lite: bool = Query(
        default=False,
        description="Skip SIP/drift/smart insights (faster charts)",
    ),
):
    """Unified analytics payload for Net Worth, Cash Flow, Spending, Sources, Investments, Alerts."""
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    banks = [b.strip() for b in bank.split(",") if b.strip()] if bank else None
    uid = _require_user_id(request)
    cache_key = f"{uid}|{date_from}|{date_to}|{bank}|{int(lite)}"
    cached = _analytics_cache_get(cache_key)
    if cached is not None:
        return cached
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
        user_id=uid,
        lite=lite,
    )
    if not lite:
        payload = attach_smart_insights(
            payload,
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        )
    _analytics_cache_set(cache_key, payload)
    return payload



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
def get_portfolio(request: Request):
    uid = _require_user_id(request)
    rows = [
        _serialize_holding(doc)
        for doc in portfolio.find({"user_id": uid}).sort("current_value", DESCENDING)
    ]
    return {
        "holdings": rows,
        "total_invested": round(sum(r["invested"] for r in rows), 2),
        "total_current": round(sum(r["current_value"] for r in rows), 2),
    }


@app.put("/portfolio")
def put_portfolio(request: Request, payload: PortfolioPayload):
    """Replace this user's manually tracked holdings (market values from broker apps)."""
    uid = _require_user_id(request)
    now = datetime.now(timezone.utc)
    portfolio.delete_many({"user_id": uid})
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
                    "user_id": uid,
                    "updated_at": now,
                    "import_date": now,
                }
            )
        portfolio.insert_many(docs)
    return get_portfolio(request)


# ── INDmoney CSV / Excel import ──────────────────────────────────────────────

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
    request: Request,
    file: UploadFile = File(...),
    mapping_json: str = Form(...),
):
    """Parse file with user mapping and upsert holdings (source=csv_import)."""
    uid = _require_user_id(request)
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

    result = upsert_holdings(
        portfolio, preview["valid"], source="csv_import", user_id=uid
    )
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
        "holdings": get_portfolio(request),
    }


# ── Credit cards (SMS-derived, read-focused) ─────────────────────────────────

@app.get("/credit-cards")
def api_list_credit_cards(request: Request):
    uid = _require_user_id(request)
    return {"items": list_credit_cards(credit_cards_col, user_id=uid)}


@app.get("/credit-cards/{last4}")
def api_get_credit_card(
    request: Request,
    last4: str,
    bank: str | None = Query(default=None),
):
    uid = _require_user_id(request)
    row = get_credit_card_by_last4(credit_cards_col, last4, bank=bank, user_id=uid)
    if not row:
        raise HTTPException(status_code=404, detail="Credit card not found")
    return row


@app.post("/credit-cards/backfill-from-transactions")
def api_backfill_credit_cards(request: Request):
    """Rebuild credit_cards snapshots from existing SMS transactions (idempotent)."""
    uid = _require_user_id(request)
    result = backfill_credit_cards_from_transactions(credit_cards_col, transactions, user_id=uid)
    sync = sync_credit_cards_to_liabilities(credit_cards_col, liabilities_col, user_id=uid)
    return {**result, "liabilities_sync": sync}


@app.post("/credit-cards/scan-payoffs")
def api_scan_cc_payoffs(
    request: Request,
    execute: bool = Query(
        default=False,
        description="If true, write cc_payoff tags. Default dry-run.",
    ),
    limit: int = Query(default=5000, ge=1, le=20000),
):
    """
    Pair bank-side CC bill payments to known cards.
    Paired → Transfers + cc_payoff=True (excluded from lifestyle).
    Ambiguous → flagged only; category unchanged.
    """
    uid = _require_user_id(request)
    return scan_and_tag_payoffs(
        transactions,
        credit_cards_col,
        execute=execute,
        limit=limit,
        user_id=uid,
    )


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
        "due_date": doc.get("due_date"),
        "available_limit": float(doc["available_limit"])
        if doc.get("available_limit") is not None
        else None,
        "source": doc.get("source") or "manual",
        "bank": doc.get("bank"),
        "last4": doc.get("last4"),
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
    }


@app.get("/liabilities")
def get_liabilities(request: Request):
    uid = _require_user_id(request)
    sync_credit_cards_to_liabilities(credit_cards_col, liabilities_col, user_id=uid)
    rows = [
        _serialize_liability(d)
        for d in liabilities_col.find({"user_id": uid}).sort("outstanding", DESCENDING)
    ]
    return {
        "items": rows,
        "total": round(sum(r["outstanding"] for r in rows), 2),
    }


@app.put("/liabilities")
def put_liabilities(request: Request, payload: LiabilitiesPayload):
    """Replace manual liabilities only; auto credit-card rows stay synced from credit_cards."""
    uid = _require_user_id(request)
    now = datetime.now(timezone.utc)
    liabilities_col.delete_many({"user_id": uid, "source": {"$ne": "credit_cards"}})
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
                "source": "manual",
                "user_id": uid,
            }
        )
    if docs:
        liabilities_col.insert_many(docs)
    sync_credit_cards_to_liabilities(credit_cards_col, liabilities_col, user_id=uid)
    return get_liabilities(request)


# ── Export ───────────────────────────────────────────────────────────────────

@app.get("/export")
def export_data(
    request: Request,
    format: str = Query(default="json", pattern="^(json|csv)$"),
):
    """Download this user's transactions, investments, and liabilities."""
    uid = _require_user_id(request)
    txns = [
        _serialize(d)
        for d in transactions.find({"user_id": uid}).sort("received_at", DESCENDING).limit(20000)
    ]
    holdings = [_serialize_holding(d) for d in portfolio.find({"user_id": uid})]
    liabs = [_serialize_liability(d) for d in liabilities_col.find({"user_id": uid})]
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


def _with_learned_context(analytics_data: dict[str, Any], *, user_id: ObjectId) -> dict[str, Any]:
    try:
        analytics_data["learned_about_you"] = facts_for_ai_context(user_learned_facts, user_id=user_id)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not load learned facts for AI: {exc}")
        analytics_data["learned_about_you"] = []
    return analytics_data


@app.get("/learn/facts")
def learn_facts_list(request: Request):
    uid = _require_user_id(request)
    return {"facts": list_facts(user_learned_facts, user_id=uid)}


@app.post("/learn/facts")
def learn_facts_create(request: Request, payload: LearnedFactCreate):
    uid = _require_user_id(request)
    try:
        fact = upsert_fact(
            user_learned_facts,
            fact_type=payload.fact_type,
            key=payload.key,
            value=payload.value,
            source="user_answered",
            plain_language=payload.plain_language,
            meta=payload.meta,
            user_id=uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Side effects for budget / merchant
    if payload.fact_type == "budget_target":
        try:
            amt = float(payload.value)
            if amt > 0:
                budgets_col.update_one(
                    {"user_id": uid, "category": payload.key},
                    {
                        "$set": {
                            "category": payload.key,
                            "amount": amt,
                            "user_id": uid,
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
                {"user_id": uid, "merchant_key": mk},
                {
                    "$set": {
                        "merchant_key": mk,
                        "merchant": payload.key,
                        "category": cat,
                        "user_id": uid,
                        "updated_at": datetime.now(timezone.utc),
                        "source": "learned",
                    }
                },
                upsert=True,
            )
    return {"fact": fact}


@app.patch("/learn/facts/{fact_id}")
def learn_facts_patch(request: Request, fact_id: str, payload: LearnedFactUpdate):
    uid = _require_user_id(request)
    updated = update_fact(
        user_learned_facts,
        fact_id,
        value=payload.value,
        plain_language=payload.plain_language,
        user_id=uid,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"fact": updated}


@app.delete("/learn/facts/{fact_id}")
def learn_facts_delete(request: Request, fact_id: str):
    uid = _require_user_id(request)
    if not delete_fact(user_learned_facts, fact_id, user_id=uid):
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"ok": True}


@app.get("/learn/questions")
def learn_questions(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
):
    uid = _require_user_id(request)
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
            user_id=uid,
        ),
        transactions,
        sip_overrides=sip_overrides,
        settings=app_settings,
        learned_facts=user_learned_facts,
        goals_col=planning_goals,
        user_id=uid,
    )
    questions = generate_questions(
        facts=user_learned_facts,
        events=learn_question_events,
        transactions=transactions,
        analytics=analytics_data,
        category_memory=category_memory,
        user_id=uid,
    )
    return {"questions": questions, "weekly_limit": 2}


@app.post("/learn/questions/answer")
def learn_questions_answer(request: Request, payload: LearnAnswerPayload):
    uid = _require_user_id(request)
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
            user_id=uid,
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
def learn_questions_skip(request: Request, payload: LearnSkipPayload):
    uid = _require_user_id(request)
    skip_question(
        learn_question_events,
        {
            "id": payload.question_id,
            "fact_type": payload.fact_type,
            "key": payload.key,
        },
        user_id=uid,
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
def ai_ask(request: Request, payload: AiAskPayload):
    uid = _require_user_id(request)
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
                user_id=uid,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        ),
        user_id=uid,
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
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
):
    uid = _require_user_id(request)
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
                user_id=uid,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        ),
        user_id=uid,
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
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
):
    uid = _require_user_id(request)
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
                user_id=uid,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        ),
        user_id=uid,
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
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    provider: str | None = None,
    use_llm: bool = Query(default=True),
):
    """Sense-check: does income, spend, investments, and transfers tell a coherent story?"""
    uid = _require_user_id(request)
    start = _parse_optional_date(date_from)
    end = _parse_optional_date(date_to, end_of_day=True)
    pack = compute_tally(transactions, date_from=start, date_to=end, user_id=uid)
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
                user_id=uid,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        ),
        user_id=uid,
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
    request: Request,
    limit: int = Query(default=40, ge=1, le=100),
    use_llm: bool = Query(default=True),
    provider: str | None = None,
):
    uid = _require_user_id(request)
    return categorize_batch(
        transactions,
        limit=limit,
        use_llm=use_llm,
        provider_name=provider,
        merchant_memory=_load_merchant_memory(user_id=uid),
        settings=app_settings,
        learned_facts=user_learned_facts,
        user_id=uid,
    )


class SipMarkPayload(BaseModel):
    instrument: str = Field(..., min_length=1, max_length=120)
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


@app.post("/smart/sip/mark-invested")
def mark_sip_invested(request: Request, payload: SipMarkPayload):
    uid = _require_user_id(request)
    month = payload.month or datetime.now(timezone.utc).strftime("%Y-%m")
    name = payload.instrument.strip()
    sip_overrides.update_one(
        {"user_id": uid, "instrument": name, "month": month},
        {
            "$set": {
                "user_id": uid,
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
        user_id=uid,
    )
    return {"ok": True, "instrument": name, "month": month, "advisor_comment": comment}


class DriftSettingsPayload(BaseModel):
    targets: dict[str, float] | None = None
    threshold_pp: float = Field(default=10.0, ge=1, le=50)
    use_current_as_baseline: bool = False


@app.put("/smart/drift-settings")
def put_drift_settings(request: Request, payload: DriftSettingsPayload):
    uid = _require_user_id(request)
    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {
        "threshold_pp": payload.threshold_pp,
        "updated_at": now,
        "user_id": uid,
    }
    if payload.targets is not None:
        update["targets"] = {str(k): float(v) for k, v in payload.targets.items() if float(v) > 0}
    if payload.use_current_as_baseline:
        analytics_data = build_analytics(
            transactions,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            user_id=uid,
        )
        holdings = (analytics_data.get("investments") or {}).get("holdings") or []
        total = sum(float(h.get("current_value") or 0) for h in holdings) or 1.0
        baseline: dict[str, float] = {}
        for h in holdings:
            cls = str(h.get("asset_class") or "Other")
            baseline[cls] = baseline.get(cls, 0) + float(h.get("current_value") or 0)
        update["baseline"] = {k: round(v / total * 100, 1) for k, v in baseline.items()}
        update["baseline_saved_at"] = now
    sid = _settings_id("allocation", uid)
    app_settings.update_one(
        {"_id": sid},
        {"$set": update, "$setOnInsert": {"_id": sid}},
        upsert=True,
    )
    doc = app_settings.find_one({"_id": sid}) or {}
    return {
        "targets": doc.get("targets") or {},
        "baseline": doc.get("baseline") or {},
        "threshold_pp": float(doc.get("threshold_pp") or 10),
        "baseline_saved_at": doc.get("baseline_saved_at").isoformat()
        if isinstance(doc.get("baseline_saved_at"), datetime)
        else None,
    }


@app.get("/ai/transfer-suggestions")
def list_transfer_suggestions(request: Request):
    uid = _require_user_id(request)
    rows = list(
        transfer_suggestions.find({"user_id": uid, "status": "pending"})
        .sort("created_at", DESCENDING)
        .limit(50)
    )
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
    request: Request,
    limit: int = Query(default=25, ge=1, le=40),
    provider: str | None = None,
):
    uid = _require_user_id(request)
    banks = sorted(
        {
            str(doc.get("bank") or "")
            for doc in transactions.find({"user_id": uid}, {"bank": 1})
            if doc.get("bank")
        }
    )
    candidates = find_ambiguous_transfers(
        transactions, known_banks=banks, limit=limit, user_id=uid
    )
    # Skip ones already pending
    pending_ids = {
        str(r["txn_id"])
        for r in transfer_suggestions.find(
            {"user_id": uid, "status": "pending"}, {"txn_id": 1}
        )
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
            {"user_id": uid, "txn_id": s["id"]},
            {
                "$set": {
                    "txn_id": s["id"],
                    "user_id": uid,
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
def review_transfer_suggestion(request: Request, txn_id: str, payload: TransferReviewPayload):
    uid = _require_user_id(request)
    try:
        oid = ObjectId(txn_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction id") from exc

    suggestion = transfer_suggestions.find_one(
        {"user_id": uid, "txn_id": txn_id, "status": "pending"}
    )
    if not suggestion:
        raise HTTPException(status_code=404, detail="No pending suggestion")

    doc = transactions.find_one({"_id": oid, "user_id": uid})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaction not found")

    now = datetime.now(timezone.utc)
    if payload.action == "reject":
        transfer_suggestions.update_one(
            {"user_id": uid, "txn_id": txn_id},
            {"$set": {"status": "rejected", "reviewed_at": now}},
        )
        transactions.update_one(
            {"_id": oid, "user_id": uid},
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
                {"user_id": uid, "merchant_key": key},
                {
                    "$set": {
                        "merchant_key": key,
                        "merchant": merchant,
                        "category": "Transfers",
                        "user_id": uid,
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


def _report_settings(user_id: ObjectId | None = None) -> dict[str, Any]:
    if user_id is not None:
        doc = app_settings.find_one({"_id": _settings_id("monthly_report", user_id)}) or {}
        if not doc:
            doc = app_settings.find_one({"_id": "monthly_report"}) or {}
    else:
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
def reports_monthly_list(request: Request, limit: int = Query(default=24, ge=1, le=60)):
    uid = _require_user_id(request)
    return {
        "reports": list_reports(monthly_reports, limit=limit, user_id=uid),
        "settings": _report_settings(uid),
    }


@app.get("/reports/monthly/{month}")
def reports_monthly_get(request: Request, month: str):
    uid = _require_user_id(request)
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    doc = get_report(monthly_reports, month, user_id=uid)
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc


@app.get("/reports/monthly-settings")
def get_monthly_report_settings(request: Request):
    return _report_settings(_require_user_id(request))


@app.put("/reports/monthly-settings")
def put_monthly_report_settings(request: Request, payload: MonthlyReportSettingsPayload):
    uid = _require_user_id(request)
    email = payload.recipient_email.strip()
    if email and "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    sid = _settings_id("monthly_report", uid)
    app_settings.update_one(
        {"_id": sid},
        {
            "$set": {
                "email_enabled": payload.email_enabled,
                "recipient_email": email,
                "updated_at": datetime.now(timezone.utc),
                "user_id": uid,
            },
            "$setOnInsert": {"_id": sid},
        },
        upsert=True,
    )
    return _report_settings(uid)


@app.post("/reports/monthly/generate")
def reports_monthly_generate(request: Request, payload: GenerateReportPayload):
    uid = _require_user_id(request)
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
            user_id=uid,
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}") from exc

    email_result = None
    if payload.send_email:
        settings = _report_settings(uid)
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
                    advisor_profile=__import__('learned_facts', fromlist=['advisor_profile_from_facts']).advisor_profile_from_facts(user_learned_facts, user_id=uid),
                )
                monthly_reports.update_one(
                    {"user_id": uid, "month": report["month"]},
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
    """Cron entrypoint — protected by API_KEY. Generates prior-month report per user."""
    if not API_KEY or not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")

    results = []
    for user in users_col.find({"disabled": {"$ne": True}}):
        uid = user["_id"]
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
                user_id=uid,
            )
        except LLMError as exc:
            results.append({"user_id": str(uid), "ok": False, "error": str(exc)})
            continue
        except Exception as exc:  # noqa: BLE001
            results.append({"user_id": str(uid), "ok": False, "error": str(exc)})
            continue

        email_result = None
        settings = _report_settings(uid)
        if send_email and settings.get("email_enabled"):
            to = settings.get("recipient_email") or ""
            if to and email_configured():
                try:
                    email_result = send_report_email(
                        report,
                        to_email=to,
                        advisor_profile=__import__(
                            "learned_facts", fromlist=["advisor_profile_from_facts"]
                        ).advisor_profile_from_facts(user_learned_facts, user_id=uid),
                    )
                    monthly_reports.update_one(
                        {"user_id": uid, "month": report["month"]},
                        {"$set": {"emailed_at": datetime.now(timezone.utc)}},
                    )
                except Exception as exc:  # noqa: BLE001
                    email_result = {"ok": False, "reason": str(exc)}
            else:
                email_result = {
                    "ok": False,
                    "reason": "missing recipient_email or RESEND_API_KEY",
                }
        results.append(
            {
                "user_id": str(uid),
                "ok": True,
                "month": report.get("month"),
                "report_id": report.get("id"),
                "email": email_result,
            }
        )

    return {"ok": True, "results": results}


@app.get("/reports/monthly/{month}/preview-html")
def reports_monthly_preview_html(request: Request, month: str):
    """Debug/preview the email HTML body."""
    uid = _require_user_id(request)
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    doc = get_report(monthly_reports, month, user_id=uid)
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return HTMLResponse(
        render_report_html(
            doc,
            advisor_profile=__import__('learned_facts', fromlist=['advisor_profile_from_facts']).advisor_profile_from_facts(user_learned_facts, user_id=uid),
        )
    )


@app.get("/reports/monthly/{month}/pdf")
def reports_monthly_pdf(request: Request, month: str):
    """Download the month-end report as PDF (same payload as email attachment)."""
    uid = _require_user_id(request)
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    doc = get_report(monthly_reports, month, user_id=uid)
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    profile = __import__(
        "learned_facts", fromlist=["advisor_profile_from_facts"]
    ).advisor_profile_from_facts(user_learned_facts, user_id=uid)
    pdf_bytes = render_report_pdf(doc, advisor_profile=profile)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="money-track-{month}.pdf"'
        },
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


def _get_goal_or_404(goal_id: str, user_id: ObjectId) -> dict[str, Any]:
    try:
        oid = ObjectId(goal_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Invalid goal id") from exc
    doc = planning_goals.find_one(
        {"_id": oid, "user_id": user_id, "status": {"$ne": "deleted"}}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Goal not found")
    return doc


@app.get("/planning/summary")
def planning_summary(request: Request, month: str | None = Query(default=None)):
    uid = _require_user_id(request)
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
            user_id=uid,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Planning summary failed: {exc}") from exc


@app.get("/planning/settings")
def planning_get_settings(request: Request):
    return get_planning_settings(app_settings, user_id=_require_user_id(request))


class AdvisorPersonaPayload(BaseModel):
    persona_text: str | None = Field(default=None, max_length=12000)
    strictness_sensitivity: int | None = Field(default=None, ge=0, le=100)
    reset_persona_to_default: bool = False


@app.get("/advisor/persona")
def advisor_persona_get(request: Request):
    uid = _require_user_id(request)
    cfg = get_advisor_persona_settings(app_settings, user_id=uid)
    return {
        **cfg,
        "default_persona_text": default_persona_text(),
        "preview": preview_samples(app_settings, user_learned_facts, user_id=uid),
    }


@app.put("/advisor/persona")
def advisor_persona_put(request: Request, payload: AdvisorPersonaPayload):
    uid = _require_user_id(request)
    return save_advisor_persona_settings(
        app_settings,
        persona_text=payload.persona_text,
        strictness_sensitivity=payload.strictness_sensitivity,
        reset_persona_to_default=payload.reset_persona_to_default,
        user_id=uid,
    )


@app.get("/advisor/persona/preview")
def advisor_persona_preview(request: Request):
    uid = _require_user_id(request)
    return preview_samples(app_settings, user_learned_facts, user_id=uid)


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
def advisor_presence_get(request: Request, light: bool = Query(default=False)):
    """Bootstrap floating chat: session, nudges, memories, briefing.

    light=true skips learn-question generation (faster first paint for the FAB).
    Analytics is built once and reused (previously built twice → ~1 min).
    """
    uid = _require_user_id(request)
    analytics_stub = None
    questions: list = []
    try:
        analytics_stub = attach_smart_insights(
            build_analytics(
                transactions,
                portfolio=portfolio,
                networth_snapshots=networth_snapshots,
                liabilities=liabilities_col,
                budgets=budgets_col,
                learned_facts=user_learned_facts,
                user_id=uid,
            ),
            transactions,
            sip_overrides=sip_overrides,
            settings=app_settings,
            learned_facts=user_learned_facts,
            goals_col=planning_goals,
            user_id=uid,
        )
        if not light:
            questions = generate_questions(
                facts=user_learned_facts,
                events=learn_question_events,
                transactions=transactions,
                analytics=analytics_stub,
                category_memory=category_memory,
                user_id=uid,
            )
    except Exception:  # noqa: BLE001
        questions = []
        analytics_stub = None
    try:
        return _jsonable(
            presence_bootstrap(
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
                analytics=analytics_stub,
                user_id=uid,
            )
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Advisor presence failed: {exc}") from exc


@app.post("/advisor/chat")
def advisor_chat_post(request: Request, payload: AdvisorChatPayload):
    uid = _require_user_id(request)
    try:
        return _jsonable(
            advisor_chat(
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
                user_id=uid,
            )
        )
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Advisor chat failed: {exc}") from exc


@app.post("/advisor/nudge/answer")
def advisor_nudge_answer(request: Request, payload: AdvisorNudgeAnswerPayload):
    """Remember credit/spend explanations for future chats."""
    uid = _require_user_id(request)
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
            user_id=uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not save answer: {exc}") from exc


@app.post("/advisor/decision-comment")
def advisor_decision_comment(request: Request, payload: AdvisorDecisionPayload):
    uid = _require_user_id(request)
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
        user_id=uid,
    )
    impact = None
    if action in {"liability_txn", "category_change"} and payload.amount:
        impact = goal_impact_for_spend(
            amount=float(payload.amount),
            category=payload.category,
            goals_col=planning_goals,
            learned_facts=user_learned_facts,
            settings=app_settings,
            user_id=uid,
        )
    return {**comment, "goal_impact": impact}


class AdvisorTrainAnswer(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    value: str = Field(..., min_length=1, max_length=400)


class AdvisorTrainPayload(BaseModel):
    answers: list[AdvisorTrainAnswer] = Field(default_factory=list)


@app.get("/planning/advisor/training")
def planning_advisor_training(request: Request):
    return advisor_training_status(user_learned_facts, user_id=_require_user_id(request))


@app.put("/planning/advisor/training")
def planning_advisor_train(request: Request, payload: AdvisorTrainPayload):
    uid = _require_user_id(request)
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
            user_id=uid,
        )
        saved.append(fact)
    return {
        "saved": len(saved),
        "training": advisor_training_status(user_learned_facts, user_id=uid),
    }


@app.put("/planning/settings")
def planning_put_settings(request: Request, payload: PlanningSettingsPayload):
    uid = _require_user_id(request)
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
        user_id=uid,
    )
    if payload.bucket_pcts is not None:
        app_settings.update_one(
            {"_id": "planning"},
            {"$set": {"personal_plan_locked": True}},
        )
    return get_planning_settings(app_settings, user_id=uid)


@app.get("/planning/goals")
def planning_list_goals(request: Request, month: str | None = Query(default=None)):
    return planning_summary(request, month=month)


@app.post("/planning/goals")
def planning_create_goal(request: Request, payload: GoalCreatePayload):
    uid = _require_user_id(request)
    now = datetime.now(timezone.utc)
    max_pri = planning_goals.find_one(
        {"user_id": uid, "status": "active"},
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
        "user_id": uid,
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
def planning_goals_reorder(request: Request, payload: GoalReorderPayload):
    uid = _require_user_id(request)
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
def planning_update_goal(request: Request, goal_id: str, payload: GoalUpdatePayload):
    uid = _require_user_id(request)
    doc = _get_goal_or_404(goal_id, uid)
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
def planning_goal_lookup_price(request: Request, goal_id: str, payload: GoalPriceLookupPayload | None = None):
    uid = _require_user_id(request)
    doc = _get_goal_or_404(goal_id, uid)
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
def planning_goal_contribute(request: Request, goal_id: str, payload: GoalContributePayload):
    uid = _require_user_id(request)
    doc = _get_goal_or_404(goal_id, uid)
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
def planning_goal_complete(request: Request, goal_id: str, payload: GoalCompletePayload | None = None):
    uid = _require_user_id(request)
    doc = _get_goal_or_404(goal_id, uid)
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
def planning_goal_delete(request: Request, goal_id: str):
    uid = _require_user_id(request)
    doc = _get_goal_or_404(goal_id, uid)
    planning_goals.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "deleted", "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}
