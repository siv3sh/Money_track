"""Optional SMS delivery for OTP (Twilio, MSG91, or log)."""

from __future__ import annotations

import os
from typing import Any

import httpx


def sms_configured() -> bool:
    provider = (os.getenv("SMS_PROVIDER") or "").strip().lower()
    if provider in {"", "none"}:
        return False
    if provider == "log":
        return True
    if provider == "twilio":
        return bool(
            os.getenv("TWILIO_ACCOUNT_SID")
            and os.getenv("TWILIO_AUTH_TOKEN")
            and os.getenv("TWILIO_FROM")
        )
    if provider == "msg91":
        return bool(os.getenv("MSG91_AUTH_KEY"))
    return False


def send_sms(*, to_e164: str, body: str) -> dict[str, Any]:
    provider = (os.getenv("SMS_PROVIDER") or "").strip().lower()
    if not provider or provider == "none":
        raise RuntimeError("SMS_PROVIDER is not configured")
    if provider == "log":
        print(f"[sms:log] to={to_e164} body={body}")
        return {"ok": True, "provider": "log"}
    if provider == "twilio":
        return _send_twilio(to_e164, body)
    if provider == "msg91":
        return _send_msg91(to_e164, body)
    raise RuntimeError(f"Unsupported SMS_PROVIDER: {provider}")


def _send_twilio(to_e164: str, body: str) -> dict[str, Any]:
    sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
    from_num = (os.getenv("TWILIO_FROM") or "").strip()
    if not sid or not token or not from_num:
        raise RuntimeError("Twilio credentials incomplete")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            url,
            data={"To": to_e164, "From": from_num, "Body": body},
            auth=(sid, token),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Twilio error {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        return {"ok": True, "provider": "twilio", "sid": data.get("sid")}


def _send_msg91(to_e164: str, body: str) -> dict[str, Any]:
    """MSG91 flow API — uses MSG91_TEMPLATE_ID when set, else plain text route."""
    auth_key = (os.getenv("MSG91_AUTH_KEY") or "").strip()
    if not auth_key:
        raise RuntimeError("MSG91_AUTH_KEY is not configured")
    digits = "".join(ch for ch in to_e164 if ch.isdigit())
    template_id = (os.getenv("MSG91_TEMPLATE_ID") or "").strip()
    sender = (os.getenv("MSG91_SENDER") or "MNYTRK").strip()[:6]
    with httpx.Client(timeout=30.0) as client:
        if template_id:
            # Extract 6-digit OTP from body when using DLT templates.
            otp = "".join(ch for ch in body if ch.isdigit())[:6]
            payload = {
                "template_id": template_id,
                "short_url": "0",
                "recipients": [{"mobiles": digits, "otp": otp or body[:6]}],
            }
            resp = client.post(
                "https://control.msg91.com/api/v5/flow/",
                headers={"authkey": auth_key, "Content-Type": "application/json"},
                json=payload,
            )
        else:
            resp = client.post(
                "https://control.msg91.com/api/v5/flow/",
                headers={"authkey": auth_key, "Content-Type": "application/json"},
                json={
                    "sender": sender,
                    "short_url": "0",
                    "recipients": [{"mobiles": digits, "message": body}],
                },
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"MSG91 error {resp.status_code}: {resp.text[:300]}")
        return {"ok": True, "provider": "msg91"}
