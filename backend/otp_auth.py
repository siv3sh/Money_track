"""Email/phone OTP create, verify, and delivery."""

from __future__ import annotations

import hashlib
import os
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import HTTPException
from pymongo.collection import Collection

from auth_users import normalize_email
from email_report import email_configured, send_transactional_email
from sms_send import send_sms, sms_configured

Purpose = Literal["login", "verify", "reset"]
Channel = Literal["email", "phone"]

OTP_TTL_MIN = 10
OTP_MAX_ATTEMPTS = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_phone(raw: str) -> str:
    """Normalize to E.164; default India (+91) for 10-digit mobiles."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Enter a phone number")
    s = re.sub(r"[\s\-()]", "", s)
    if s.startswith("00"):
        s = "+" + s[2:]
    if s.startswith("+"):
        digits = "".join(ch for ch in s[1:] if ch.isdigit())
        if len(digits) < 10 or len(digits) > 15:
            raise HTTPException(status_code=400, detail="Enter a valid phone number")
        return "+" + digits
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) == 10 and digits[0] in "6789":
        return "+91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        return "+91" + digits[1:]
    raise HTTPException(
        status_code=400,
        detail="Use a 10-digit Indian mobile or full number with country code",
    )


def _hash_code(code: str) -> str:
    pepper = (os.getenv("JWT_SECRET") or os.getenv("API_KEY") or "otp").strip()
    return hashlib.sha256(f"{pepper}:{code}".encode("utf-8")).hexdigest()


def ensure_otp_indexes(otps: Collection) -> None:
    otps.create_index(
        [("channel", 1), ("destination", 1), ("purpose", 1)],
        unique=True,
    )
    otps.create_index("expires_at", expireAfterSeconds=0)


def create_otp(
    otps: Collection,
    *,
    channel: Channel,
    destination: str,
    purpose: Purpose,
) -> str:
    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    now = _now()
    otps.update_one(
        {"channel": channel, "destination": destination, "purpose": purpose},
        {
            "$set": {
                "code_hash": _hash_code(code),
                "expires_at": now + timedelta(minutes=OTP_TTL_MIN),
                "attempts": 0,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return code


def verify_otp(
    otps: Collection,
    *,
    channel: Channel,
    destination: str,
    purpose: Purpose,
    code: str,
) -> None:
    raw = (code or "").strip()
    if not re.fullmatch(r"\d{6}", raw):
        raise HTTPException(status_code=400, detail="Enter the 6-digit code")
    doc = otps.find_one({"channel": channel, "destination": destination, "purpose": purpose})
    if not doc:
        raise HTTPException(status_code=400, detail="Code expired or not found — request a new one")
    expires = doc.get("expires_at")
    if isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < _now():
            otps.delete_one({"_id": doc["_id"]})
            raise HTTPException(status_code=400, detail="Code expired — request a new one")
    attempts = int(doc.get("attempts") or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        otps.delete_one({"_id": doc["_id"]})
        raise HTTPException(status_code=400, detail="Too many wrong codes — request a new one")
    if doc.get("code_hash") != _hash_code(raw):
        otps.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Wrong code")
    otps.delete_one({"_id": doc["_id"]})


def deliver_otp(*, channel: Channel, destination: str, code: str, purpose: Purpose) -> None:
    label = {
        "login": "sign-in",
        "verify": "verification",
        "reset": "password reset",
    }.get(purpose, "verification")
    if channel == "email":
        if not email_configured():
            raise HTTPException(
                status_code=503,
                detail="Email OTP is not configured (set RESEND_API_KEY)",
            )
        try:
            send_transactional_email(
                to_email=destination,
                subject=f"Your Money Track {label} code",
                html=(
                    f"<p>Your Money Track {label} code is:</p>"
                    f"<p style='font-size:24px;letter-spacing:4px'><strong>{code}</strong></p>"
                    f"<p>This code expires in {OTP_TTL_MIN} minutes. "
                    "If you did not request it, you can ignore this email.</p>"
                ),
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail="Could not send email OTP") from exc
        return

    if not sms_configured():
        raise HTTPException(
            status_code=503,
            detail="Phone OTP is not configured (set SMS_PROVIDER + credentials)",
        )
    body = f"Money Track {label} code: {code}. Valid {OTP_TTL_MIN} min."
    try:
        send_sms(to_e164=destination, body=body)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: SMS OTP failed: {exc}")
        raise HTTPException(status_code=502, detail="Could not send SMS OTP") from exc


def resolve_destination(channel: Channel, raw: str) -> str:
    if channel == "email":
        email = normalize_email(raw)
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail="Enter a valid email")
        return email
    return normalize_phone(raw)


def find_user_by_destination(
    users: Collection,
    *,
    channel: Channel,
    destination: str,
) -> dict[str, Any] | None:
    if channel == "email":
        return users.find_one({"email": destination})
    return users.find_one({"phone": destination})


def mask_destination(channel: Channel, destination: str) -> str:
    if channel == "email":
        parts = destination.split("@", 1)
        if len(parts) != 2:
            return "***"
        local, domain = parts
        shown = local[:1] + "***" if local else "***"
        return f"{shown}@{domain}"
    if len(destination) < 4:
        return "***"
    return destination[:3] + "***" + destination[-2:]
