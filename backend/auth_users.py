"""Users, linked phone/bank accounts, password hashing, JWT auth."""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.collection import Collection

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)
_bearer = HTTPBearer(auto_error=False)

_raw_jwt = os.getenv("JWT_SECRET", "").strip()
_api_key = os.getenv("API_KEY", "").strip()
_env_name = (os.getenv("ENV") or os.getenv("APP_ENV") or "production").strip().lower()
_INSECURE = "dev-insecure-change-me"

if _raw_jwt and _raw_jwt not in {_INSECURE, "change-me-to-a-long-random-string"}:
    JWT_SECRET = _raw_jwt
elif _api_key:
    # Temporary fallback so deploys that only set API_KEY still boot.
    # Prefer a dedicated JWT_SECRET in Render (do not share webhook/cron secrets long-term).
    print(
        "WARNING: JWT_SECRET unset — falling back to API_KEY for token signing. "
        "Set JWT_SECRET to a long random value in Render env."
    )
    JWT_SECRET = _api_key
elif _env_name in {"development", "dev", "local", "test"}:
    JWT_SECRET = _INSECURE
    print("WARNING: using insecure JWT_SECRET for local development only.")
else:
    raise RuntimeError(
        "JWT_SECRET (or API_KEY fallback) must be set to a long random value in production."
    )
JWT_ALG = "HS256"
JWT_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "14"))

USER_OWNED_COLLECTIONS = (
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
    "transfer_suggestions",
    "monthly_reports",
    "user_learned_facts",
    "learn_question_events",
    "planning_goals",
    "advisor_memories",
    "advisor_chat_sessions",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def is_admin_user(doc: dict[str, Any] | None) -> bool:
    if not doc:
        return False
    admin = normalize_email(os.getenv("ADMIN_EMAIL") or os.getenv("SEED_USER_EMAIL") or "")
    if not admin:
        return False
    return normalize_email(str(doc.get("email") or "")) == admin


def create_access_token(*, user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": _now() + timedelta(days=JWT_DAYS),
        "iat": _now(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session expired — please log in again") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid session — please log in again") from exc


def serialize_user(doc: dict[str, Any]) -> dict[str, Any]:
    # Users who finished SMS setup before onboarding existed should not be forced
    # through Getting Started again.
    if "onboarding_completed" in doc:
        onboarding_completed = bool(doc.get("onboarding_completed"))
    else:
        onboarding_completed = bool(doc.get("setup_completed"))
    return {
        "id": str(doc["_id"]),
        "email": doc.get("email"),
        "created_at": doc["created_at"].isoformat()
        if isinstance(doc.get("created_at"), datetime)
        else doc.get("created_at"),
        "setup_completed": bool(doc.get("setup_completed")),
        "setup_platform": doc.get("setup_platform"),
        "onboarding_completed": onboarding_completed,
        "disabled": bool(doc.get("disabled")),
        "is_admin": is_admin_user(doc),
    }


def ensure_auth_indexes(users: Collection, linked_accounts: Collection) -> None:
    users.create_index("email", unique=True)
    linked_accounts.create_index("webhook_token", unique=True)
    linked_accounts.create_index([("user_id", 1), ("kind", 1), ("identifier", 1)], unique=True)
    linked_accounts.create_index("user_id")


def seed_user_from_env(users: Collection) -> dict[str, Any] | None:
    """Create the first user from SEED_USER_EMAIL / SEED_USER_PASSWORD if missing."""
    email = normalize_email(os.getenv("SEED_USER_EMAIL", ""))
    password = os.getenv("SEED_USER_PASSWORD", "")
    if not email or not password:
        return None
    existing = users.find_one({"email": email})
    if existing:
        return existing
    now = _now()
    doc = {
        "email": email,
        "password_hash": hash_password(password),
        "created_at": now,
        "updated_at": now,
        "setup_completed": False,
        "setup_platform": None,
        "onboarding_completed": False,
    }
    res = users.insert_one(doc)
    doc["_id"] = res.inserted_id
    print(f"Seeded user account for {email}")
    return doc


def register_user(users: Collection, email: str, password: str) -> dict[str, Any]:
    """Create a self-service account. Raises HTTPException on conflict / validation."""
    email_n = normalize_email(email)
    if not email_n or "@" not in email_n:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if users.find_one({"email": email_n}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    now = _now()
    doc = {
        "email": email_n,
        "password_hash": hash_password(password),
        "created_at": now,
        "updated_at": now,
        "setup_completed": False,
        "setup_platform": None,
        "onboarding_completed": False,
    }
    res = users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


def get_primary_user(users: Collection) -> dict[str, Any] | None:
    email = normalize_email(os.getenv("SEED_USER_EMAIL", ""))
    if email:
        doc = users.find_one({"email": email})
        if doc:
            return doc
    return users.find_one(sort=[("created_at", 1)])


def migrate_assign_user_id(db, user_id: ObjectId) -> dict[str, int]:
    """Stamp existing docs missing user_id with the seeded owner."""
    counts: dict[str, int] = {}
    for name in USER_OWNED_COLLECTIONS:
        col = db[name]
        try:
            result = col.update_many(
                {"user_id": {"$exists": False}},
                {"$set": {"user_id": user_id}},
            )
            counts[name] = int(result.modified_count)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: user_id migrate skipped for {name}: {exc}")
            counts[name] = 0
    return counts


def ensure_default_linked_account(
    linked_accounts: Collection,
    *,
    user_id: ObjectId,
    label: str = "Primary phone",
) -> dict[str, Any]:
    existing = linked_accounts.find_one({"user_id": user_id})
    if existing:
        return existing
    now = _now()
    doc = {
        "user_id": user_id,
        "kind": "phone",
        "identifier": "primary",
        "label": label,
        "webhook_token": secrets.token_urlsafe(24),
        "linked_at": now,
        "last_seen_at": None,
        "active": True,
        "platform": None,
    }
    res = linked_accounts.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


def serialize_linked_account(
    doc: dict[str, Any],
    *,
    include_token: bool = False,
    webhook_base: str = "",
) -> dict[str, Any]:
    token = doc.get("webhook_token") or ""
    out: dict[str, Any] = {
        "id": str(doc["_id"]),
        "kind": doc.get("kind") or "phone",
        "identifier": doc.get("identifier"),
        "label": doc.get("label"),
        "linked_at": doc["linked_at"].isoformat()
        if isinstance(doc.get("linked_at"), datetime)
        else doc.get("linked_at"),
        "last_seen_at": doc["last_seen_at"].isoformat()
        if isinstance(doc.get("last_seen_at"), datetime)
        else doc.get("last_seen_at"),
        "active": bool(doc.get("active", True)),
        "platform": doc.get("platform"),
    }
    if include_token:
        out["webhook_token"] = token
        base = webhook_base.rstrip("/")
        out["webhook_url"] = f"{base}/sms-webhook/{token}" if token else None
        out["email_webhook_url"] = f"{base}/email-webhook/{token}" if token else None
    else:
        out["webhook_url_hint"] = "Reveal in Accounts to copy your private SMS / email links"
    return out


def find_linked_by_token(linked_accounts: Collection, token: str) -> dict[str, Any] | None:
    token = (token or "").strip()
    if not token:
        return None
    return linked_accounts.find_one({"webhook_token": token, "active": {"$ne": False}})


def authenticate_user(users: Collection, email: str, password: str) -> dict[str, Any]:
    email_n = normalize_email(email)
    doc = users.find_one({"email": email_n})
    if not doc or not verify_password(str(doc.get("password_hash") or ""), password):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    if doc.get("disabled"):
        raise HTTPException(status_code=403, detail="This account has been disabled")
    return doc


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    users: Collection | None = getattr(request.app.state, "users", None)
    if users is None:
        raise HTTPException(status_code=503, detail="Auth not ready")
    token = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please log in",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    try:
        uid = ObjectId(payload.get("sub"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    doc = users.find_one({"_id": uid})
    if not doc:
        raise HTTPException(status_code=401, detail="Account not found — please log in again")
    if doc.get("disabled"):
        raise HTTPException(status_code=403, detail="This account has been disabled")
    request.state.user = doc
    request.state.user_id = uid
    return doc


def user_match(user_id: ObjectId | None) -> dict[str, Any]:
    """Mongo filter for owner-scoped queries. Never returns unscoped {} when called with None — callers must require login first."""
    if user_id is None:
        raise ValueError("user_match requires an authenticated user_id")
    return {"user_id": user_id}
