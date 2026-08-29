"""Inbound bank-alert email → same transaction shape as SMS."""

from __future__ import annotations

import html as html_lib
import re
from typing import Any, Optional

from parser import Transaction, parse_sms

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]+\n")
_MULTI_NL = re.compile(r"\n{3,}")


def html_to_text(raw_html: str) -> str:
    """Rough HTML → plain text for bank alert emails (no heavy deps)."""
    if not raw_html:
        return ""
    text = raw_html
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n", text)
    text = re.sub(r"(?i)</div>", "\n", text)
    text = re.sub(r"(?i)</tr>", "\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html_lib.unescape(text)
    text = _WS_RE.sub("\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = _MULTI_NL.sub("\n\n", text)
    return text.strip()


def normalize_email_payload(data: dict[str, Any] | None) -> dict[str, str]:
    """Accept Resend inbound / generic JSON / nested `data` wrappers."""
    if not isinstance(data, dict):
        return {"from": "", "subject": "", "text": "", "html": ""}
    # Resend sometimes nests under data
    nested = data.get("data") if isinstance(data.get("data"), dict) else None
    src = nested or data

    from_addr = (
        src.get("from")
        or src.get("From")
        or src.get("sender")
        or src.get("Sender")
        or ""
    )
    if isinstance(from_addr, dict):
        from_addr = from_addr.get("address") or from_addr.get("email") or str(from_addr)

    subject = src.get("subject") or src.get("Subject") or ""
    text = (
        src.get("text")
        or src.get("body")
        or src.get("Body")
        or src.get("plain")
        or src.get("stripped-text")
        or ""
    )
    html = src.get("html") or src.get("Html") or src.get("body-html") or ""

    # Mailgun-ish
    if not text and src.get("body-plain"):
        text = src.get("body-plain") or ""

    return {
        "from": str(from_addr or "").strip(),
        "subject": str(subject or "").strip(),
        "text": str(text or "").strip(),
        "html": str(html or "").strip(),
    }


def email_body_for_parse(*, subject: str, text: str, html: str) -> str:
    # Subject stays out of parse/fingerprint text so SMS↔email soft dedupe works.
    plain = text.strip() or html_to_text(html)
    if not plain and subject.strip():
        # Last resort only when body is empty (some forwarders put amount in subject)
        plain = subject.strip()
    if len(plain) > 6000:
        plain = plain[:6000]
    return plain


def parse_bank_email(
    *,
    sender: str,
    subject: str = "",
    text: str = "",
    html: str = "",
    use_llm: bool = True,
) -> Optional[Transaction]:
    """
    Turn a bank alert email into a Transaction using the SMS parser.
    Sender hint = From address or subject bank token.
    """
    body = email_body_for_parse(subject=subject, text=text, html=html)
    if not body:
        return None
    sender_hint = (sender or "").strip() or (subject.split("-")[0].strip() if subject else "") or "EMAIL"
    # Prefer local-part / domain brand for merchant_label bank detection
    if "@" in sender_hint:
        local, _, domain = sender_hint.partition("@")
        sender_hint = f"{local} {domain.split('.')[0]}"
    return parse_sms(sender_hint[:80], body, use_llm=use_llm)
