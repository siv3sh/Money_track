"""Resend Inbound webhooks — fetch body and route to the right linked account."""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_INBOUND_DOMAIN = (os.getenv("RESEND_INBOUND_DOMAIN") or "").strip().lower().lstrip("@")


def inbound_configured() -> bool:
    return bool(RESEND_API_KEY and RESEND_INBOUND_DOMAIN)


def inbound_email_for_token(token: str) -> str | None:
    token = (token or "").strip()
    if not token or not RESEND_INBOUND_DOMAIN:
        return None
    return f"{token}@{RESEND_INBOUND_DOMAIN}"


def resend_inbound_webhook_url(api_public_base: str) -> str:
    base = (api_public_base or "").rstrip("/")
    return f"{base}/webhooks/resend-inbound"


def token_from_recipients(recipients: list[Any]) -> str | None:
    """Map Resend `to` addresses to a linked-account webhook token (local-part)."""
    if not RESEND_INBOUND_DOMAIN:
        return None
    domain = RESEND_INBOUND_DOMAIN
    for raw in recipients:
        addr = str(raw or "").strip().lower()
        if not addr:
            continue
        if "<" in addr and ">" in addr:
            addr = addr.split("<", 1)[1].split(">", 1)[0].strip()
        if "@" not in addr:
            continue
        local, _, host = addr.partition("@")
        if host != domain:
            continue
        local = local.strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", local):
            return local
    return None


def fetch_received_email(email_id: str) -> dict[str, Any]:
    """Download full received email (text/html) from Resend Receiving API."""
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not configured")
    eid = (email_id or "").strip()
    if not eid:
        raise RuntimeError("missing email_id")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"https://api.resend.com/emails/receiving/{eid}",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Resend receiving API {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        return data if isinstance(data, dict) else {}


def fields_from_resend_received(data: dict[str, Any]) -> dict[str, str]:
    from_addr = data.get("from") or ""
    if isinstance(from_addr, dict):
        from_addr = from_addr.get("address") or from_addr.get("email") or str(from_addr)
    return {
        "from": str(from_addr or "").strip(),
        "subject": str(data.get("subject") or "").strip(),
        "text": str(data.get("text") or "").strip(),
        "html": str(data.get("html") or "").strip(),
    }
