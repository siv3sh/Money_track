import re
from typing import Any, Literal, NotRequired, Optional, TypedDict

from llm import LLMError, extract_json, get_provider

# purchase = real card spend; others are informational (do not store as ledger spend)
CreditCardSmsKind = Literal["purchase", "payment", "statement", "limit_alert"]


class Transaction(TypedDict):
    type: str                # "debit" or "credit"
    amount: float
    account_last4: Optional[str]
    card_type: Optional[str] # "credit_card", "debit_card", "upi", "bank_account"
    merchant: Optional[str]
    balance: Optional[float]
    bank: Optional[str]
    raw_text: str
    cc_sms_kind: NotRequired[Optional[CreditCardSmsKind]]


AMOUNT_RE = re.compile(r"(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE)
ACCOUNT_RE = re.compile(r"(?:a/?c|acct|account|card)\D{0,20}(\d{4})\b", re.IGNORECASE)
BALANCE_RE = re.compile(
    r"(?:avl\.?\s?bal|available\s?bal(?:ance)?|bal(?:ance)?)\D{0,12}(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
# Credit-card available limit — ICICI uses "Avl Lmt:", others use "limit"
LIMIT_RE = re.compile(
    r"(?:avl\.?\s?lmt|avl\.?\s?limit|available\s?limit|credit\s?limit)"
    r"\D{0,12}(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)

# Credit-card SMS taxonomy (checked before DEBIT_KEYWORDS to avoid collisions)
_CC_STATEMENT_RE = re.compile(
    r"statement\s+is\s+sent|"
    r"total\s+of\s*(?:rs\.?|inr|₹).{0,80}(?:minimum\s+of|is\s+due\s+by)|"
    r"(?:minimum\s+of\s*(?:rs\.?|inr|₹).{0,40})?is\s+due\s+by\b",
    re.IGNORECASE,
)
_CC_PAYMENT_RE = re.compile(
    r"payment\s+of\s*(?:rs\.?|inr|₹).{0,80}(?:has\s+been\s+)?received\s+on\s+your.{0,80}credit\s*card|"
    r"received\s+on\s+your.{0,60}credit\s*card.{0,80}(?:bharat\s+bill|bbps|bill\s+payment)",
    re.IGNORECASE,
)
_CC_PURCHASE_RE = re.compile(
    r"spent\s+(?:on|using)\b.{0,60}card|"
    r"purchase\s+on\s+(?:your\s+)?card|"
    r"txn\s+on\s+(?:your\s+)?(?:icici\s+)?(?:bank\s+)?card",
    re.IGNORECASE,
)
_CC_LIMIT_ALERT_RE = re.compile(
    r"(?:avl\.?\s*lmt|avl\.?\s*limit|available\s*limit|credit\s*limit)"
    r".{0,40}(?:is|now|updated|:)",
    re.IGNORECASE,
)
_CC_CONTEXT_RE = re.compile(
    r"credit\s*card|bank\s+card|avl\.?\s*lmt|avl\.?\s*limit|available\s*limit|"
    r"spent\s+(?:on|using)\b|purchase\s+on\s+card",
    re.IGNORECASE,
)
# "… Card XX4001 on 25-Jul-26 on WEFIVE HYPERMAR"
MERCHANT_ON_DATE_ON_RE = re.compile(
    r"\bon\s+\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}\s+on\s+"
    r"([A-Za-z0-9][A-Za-z0-9&_.\-@ ]{1,40}?)(?=\s*(?:\.|Avl|Available|If\s+not|,|$))",
    re.IGNORECASE,
)

MERCHANT_AT_RE = re.compile(
    r"(?:at|towards|paid\s+to|trf\s+to|transfer\s+to)\s+"
    r"([A-Za-z0-9][A-Za-z0-9&_.\-@ ]{1,40}?)(?=\s+(?:on\b|via\b|ref\b|upi\b|avl|bal|a/?c|xx|\*|INR|Rs\.?|₹|\.|$))",
    re.IGNORECASE,
)
MERCHANT_TO_RE = re.compile(
    r"\bto\s+(?!a/?c\b|acct\b|account\b|your\b|the\b)"
    r"([A-Za-z0-9][A-Za-z0-9&_.\-@ ]{1,40}?)(?=\s+(?:on\b|via\b|ref\b|upi\b|avl|bal|a/?c|xx|\*|INR|Rs\.?|₹|\.|$))",
    re.IGNORECASE,
)
MERCHANT_FROM_RE = re.compile(
    r"\bfrom\s+(?!a/?c\b|acct\b|account\b|your\b)"
    r"([A-Za-z0-9][A-Za-z0-9&_.\-@ ]{1,40}?)(?=\s+(?:on\b|via\b|ref\b|upi\b|avl|bal|a/?c|xx|\*|INR|Rs\.?|₹|\.|$))",
    re.IGNORECASE,
)
# "Digital Gold India Private Limited has received Rs 20.00 from your A/c ..."
MERCHANT_SUBJECT_RE = re.compile(
    r"^([A-Za-z0-9][A-Za-z0-9&_.\-@ ]{1,60}?)\s+has\s+received\b",
    re.IGNORECASE,
)
# Money leaving the user's account even though the verb is "received"
DEBIT_RECEIVED_RE = re.compile(
    r"received\s+(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s+from\s+your\s+a/?c",
    re.IGNORECASE,
)
UPI_VPA_RE = re.compile(r"\b([\w.\-]+@[\w]+)\b")

# NOTE: bare "sent" and "payment of" intentionally omitted — they collided with
# ICICI credit-card statement ("Statement is sent") and payment-received SMS.
DEBIT_KEYWORDS = [
    "debited",
    "spent",
    "paid",
    "withdrawn",
    "purchase of",
    "dr ",
    "dr.",
    "purchase",
    "has been sent",  # UPI / NEFT style, not "statement is sent"
    " amt sent",
    "rs sent",
    "inr sent",
]
CREDIT_KEYWORDS = [
    "credited", "received", "deposited", "cr ", "cr.", "refund",
]

CARD_TYPE_KEYWORDS = [
    ("credit card", "credit_card"),
    ("debit card", "debit_card"),
    ("upi", "upi"),
]

# Phrases that strongly indicate a credit-card spend even without the words "credit card"
CREDIT_CARD_HINTS = [
    "avl lmt",
    "avl limit",
    "available limit",
    "credit limit",
    "spent using",
    "spent on your",
    "spent on ",
]

# Prepaid wallet / FASTag debits — money already left the bank at recharge time,
# so these must NOT count as fresh bank spend.
WALLET_HINTS = [
    "toll debited",
    "toll bal",
    "fastag",
    "fast tag",
    "wallet bal",
    "from your wallet",
    "wallet balance",
    "paytm wallet",
    "amazon pay balance",
    "vrn-",
]

BANK_SENDER_MAP = {
    "ICICIB": "ICICI Bank",
    "ICICI": "ICICI Bank",
    "FEDBNK": "Federal Bank",
    "FEDBK": "Federal Bank",
    "FEDERAL": "Federal Bank",
}

# Only these banks are stored — everything else is ignored on SMS ingest / import UI
ALLOWED_BANKS = frozenset({"Federal Bank", "ICICI Bank"})
ALLOWED_BANK_HINTS = (
    "federal",
    "fedbnk",
    "fedbk",
    "icici",
    "icicib",
)

_BAD_MERCHANT = re.compile(
    r"^(a/?c|acct|account|card|your|the|upi|ref|info|inr|rs\.?|xx+\d*)$",
    re.IGNORECASE,
)

# Non-transaction / spam / OTP noise — never store these
SPAM_PATTERNS = [
    r"\botp\b",
    r"one[\s-]?time\s+password",
    r"verification\s+code",
    r"do\s+not\s+share",
    r"dont\s+share",
    r"don't\s+share",
    r"secret\s+code",
    r"valid\s+for\s+\d+\s+min",
    r"\boffer\b",
    r"congratulat",
    r"click\s+here",
    r"unsubscribe",
    r"limited\s+period",
    r"loan\s+approved\s+pre[\s-]?approved",
    r"kyc\s+pending",
    r"update\s+your\s+kyc",
    r"requested\s+to\s+block",
    r"is\s+your\s+mobile\s+banking",
]

# Known demo / tutorial SMS from README & local tests
DEMO_PATTERNS = [
    r"xx1234.*amazon.*12,?345",
    r"a/c\s+xx1234\s+at\s+amazon\s+on\s+23-07-26",
]

SPAM_RE = re.compile("|".join(f"(?:{p})" for p in SPAM_PATTERNS), re.IGNORECASE)
DEMO_RE = re.compile("|".join(f"(?:{p})" for p in DEMO_PATTERNS), re.IGNORECASE)


ALLOWED_CARD_TYPES = frozenset(
    {"credit_card", "debit_card", "upi", "bank_account", "wallet"}
)
_LLM_PARSE_BATCH = 8

_SMS_LLM_SYSTEM = (
    "Extract bank transactions from Indian SMS or statement narrations. "
    "Only Federal Bank and ICICI Bank. Ignore OTP, KYC, promo, and non-money texts. "
    "Return JSON only. Amounts are INR numbers (no commas). "
    "type debit = money left the user; credit = money received."
)


def _to_float(amount_str: Optional[str]) -> Optional[float]:
    if amount_str is None:
        return None
    cleaned = (
        str(amount_str)
        .replace("\xa0", "")
        .replace("\u202f", "")
        .replace(",", "")
        .replace(" ", "")
        .strip()
    )
    if not cleaned or cleaned in {".", "-", "+", "-.", "+."}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def coerce_amount(value: Any, default: Optional[float] = None) -> Optional[float]:
    """Parse an amount without raising. Blanks, NBSP, and commas-only become default."""
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        n = float(value)
        if n != n or n in {float("inf"), float("-inf")}:
            return default
        if abs(n) >= 1e10:
            return default
        return n
    parsed = _to_float(str(value))
    if parsed is not None and abs(parsed) >= 1e10:
        return default
    return default if parsed is None else parsed


def _amount_digit_token(amount: float) -> str:
    n = abs(float(amount))
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    return f"{n:.2f}".rstrip("0").rstrip(".")


_BANK_REF_START = re.compile(
    r"(?i)^\s*(?:UPI|NEFT|NFT|IMPS|RTGS|NACH|ACHDR|UPIOUT)\b"
)
_BANK_REF_HINT = re.compile(
    r"(?i)(?:NEOSIE|XEDDD|NEFT|IMPS|RTGS|NACH|/UPI)"
)
_NEOSIE_DIGITAL_GOLD_RE = re.compile(
    r"(?i)(?:NEOSIE|XEDDD).{0,80}digital\s*gold|digital\s*gold.{0,80}(?:NEOSIE|XEDDD)"
)


def is_bank_ref_narration(text: str) -> bool:
    """True for NEFT/NFT/IMPS/UTR-style lines, not a free-text SMS."""
    blob = text or ""
    return bool(_BANK_REF_START.search(blob) or _BANK_REF_HINT.search(blob))


def is_neosie_digital_gold_narration(text: str) -> bool:
    """NFT/NEOSIE… Digital Gold In — a gold *purchase*, not an SMS amount."""
    return bool(_NEOSIE_DIGITAL_GOLD_RE.search(text or ""))


def amount_taken_from_reference_id(amount: float, text: str) -> bool:
    """True when `amount` is the tail of a long UTR/NEFT/IMPS id, not rupees."""
    token = _amount_digit_token(amount)
    if not token or not text or len(token) < 3:
        return False
    for match in re.finditer(r"\d{10,}", text):
        run = match.group(0)
        if run != token and run.endswith(token):
            return True
    return False


def is_phantom_bank_ref_amount(
    amount: float,
    text: str,
    txn_type: Optional[str] = None,
) -> bool:
    """
    Drop this row. The amount did not come from a real debit/credit value.

    REJECT:
      NFT/NEOSIEXEDDD2026081605552282230 Digital Gold In  + 2230
      → 2230 is the UTR tail.
      NFT/NEOSIE… Digital Gold In  + credit 10018 / 2141 / 6211
      → gold *in* is a purchase (bank debit). Credits from that line are fake.

    KEEP:
      NFT/NEOSIE… Digital Gold In  + debit column 20
      → 20 is not the UTR tail, and type is debit.
      NFT/OTTAPALAM PATTA/…  + credit 10000
      → real incoming NEFT; amount is not the id tail.
    """
    if amount_taken_from_reference_id(amount, text):
        return True
    kind = (txn_type or "").strip().lower()
    if kind == "credit" and is_neosie_digital_gold_narration(text):
        return True
    return False


def is_ref_tail_amount(amount: float, text: str) -> bool:
    return amount_taken_from_reference_id(amount, text)


def narration_has_money_token(text: str) -> bool:
    return bool(AMOUNT_RE.search(text or ""))


def _is_spam_or_non_txn(text_lower: str) -> bool:
    if SPAM_RE.search(text_lower):
        return True
    if DEMO_RE.search(text_lower):
        return True
    return False


def classify_credit_card_sms(text: str) -> Optional[CreditCardSmsKind]:
    """
    Sub-classify credit-card SMS narrations.

    purchase     — real spend (store as credit_card debit)
    payment      — payoff received on the card (not spend)
    statement    — bill/due alert (not spend)
    limit_alert  — available-limit update without a purchase
    """
    if not text or not str(text).strip():
        return None
    raw = str(text).strip()
    if not _CC_CONTEXT_RE.search(raw):
        return None

    # Order matters: statement/payment before purchase; purchase before bare limit alert
    if _CC_STATEMENT_RE.search(raw):
        return "statement"
    if _CC_PAYMENT_RE.search(raw):
        return "payment"
    if _CC_PURCHASE_RE.search(raw):
        return "purchase"
    if "spent" in raw.lower() and "card" in raw.lower() and "debit card" not in raw.lower():
        return "purchase"
    if _CC_LIMIT_ALERT_RE.search(raw) and "spent" not in raw.lower():
        return "limit_alert"
    return None


def is_credit_card_non_purchase_sms(text: str) -> bool:
    """True for CC statement / payment / limit alerts that must not count as spend."""
    kind = classify_credit_card_sms(text)
    return kind in {"statement", "payment", "limit_alert"}


def credit_card_noise_mongo_clause() -> dict[str, Any]:
    """
    Exclude non-purchase CC SMS from spend aggregations.
    Prefers cc_sms_kind when present; also matches legacy raw_text patterns.
    """
    return {
        "$nor": [
            {"cc_sms_kind": {"$in": ["statement", "payment", "limit_alert"]}},
            {"raw_text": {"$regex": r"statement\s+is\s+sent", "$options": "i"}},
            {
                "raw_text": {
                    "$regex": (
                        r"payment\s+of\s*(?:rs\.?|inr|₹).{0,80}"
                        r"(?:has\s+been\s+)?received\s+on\s+your.{0,80}credit\s*card"
                    ),
                    "$options": "i",
                }
            },
            {
                "raw_text": {
                    "$regex": r"total\s+of\s*(?:rs\.?|inr|₹).{0,80}(?:is\s+)?due\s+by",
                    "$options": "i",
                }
            },
        ]
    }


_CC_DUE_RE = re.compile(
    r"due\s+by\s+(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})",
    re.IGNORECASE,
)
_CC_STATEMENT_TOTAL_RE = re.compile(
    r"total\s+of\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
_MONTH_MAP = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def extract_credit_card_due_date(text: str) -> Optional[str]:
    """Return ISO date YYYY-MM-DD from 'due by 30-AUG-26' style text."""
    m = _CC_DUE_RE.search(text or "")
    if not m:
        return None
    day = int(m.group(1))
    mon = _MONTH_MAP.get(m.group(2).lower()[:3])
    if not mon:
        return None
    year = int(m.group(3))
    if year < 100:
        year += 2000
    try:
        return f"{year:04d}-{mon:02d}-{day:02d}"
    except ValueError:
        return None


def extract_credit_card_statement_total(text: str) -> Optional[float]:
    m = _CC_STATEMENT_TOTAL_RE.search(text or "")
    if not m:
        return None
    return _to_float(m.group(1))


def extract_credit_card_last4(text: str) -> Optional[str]:
    m = ACCOUNT_RE.search(text or "")
    return m.group(1) if m else None


def extract_credit_card_available_limit(text: str) -> Optional[float]:
    m = LIMIT_RE.search(text or "")
    return _to_float(m.group(1)) if m else None


def _detect_card_type(text_lower: str) -> Optional[str]:
    # Wallet/FASTag debits first — recharge was already counted as bank spend
    if any(h in text_lower for h in WALLET_HINTS):
        # "fastag recharge" itself is a bank debit, not a wallet spend
        if "recharge" not in text_lower or "toll" in text_lower:
            return "wallet"
    for keyword, label in CARD_TYPE_KEYWORDS:
        if keyword in text_lower:
            return label
    # ICICI / similar: "spent using … Bank Card XX####" + Avl Limit
    if any(h in text_lower for h in CREDIT_CARD_HINTS) and (
        "card" in text_lower or "limit" in text_lower or "lmt" in text_lower
    ):
        if "debit card" not in text_lower:
            return "credit_card"
    if "bank card" in text_lower and ("spent" in text_lower or "purchase" in text_lower):
        return "credit_card"
    if "@" in text_lower or "upi" in text_lower:
        return "upi"
    return "bank_account"


def _detect_bank(sender: str, body: str = "") -> Optional[str]:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", (sender or "")).upper()
    if cleaned:
        for key, name in sorted(BANK_SENDER_MAP.items(), key=lambda kv: -len(kv[0])):
            if cleaned == key.upper() or cleaned.endswith(key.upper()):
                return name
    blob = f"{sender} {body}".lower()
    if "icici" in blob:
        return "ICICI Bank"
    if "federal" in blob or "fedbnk" in blob or "fedbk" in blob:
        return "Federal Bank"
    return None


def _detect_type(text_lower: str) -> Optional[str]:
    # "<merchant> has received Rs X from your A/c" is money going OUT
    if DEBIT_RECEIVED_RE.search(text_lower):
        return "debit"

    debit_hits = [text_lower.find(k) for k in DEBIT_KEYWORDS if k in text_lower]
    credit_hits = [text_lower.find(k) for k in CREDIT_KEYWORDS if k in text_lower]
    debit_pos = min(debit_hits) if debit_hits else None
    credit_pos = min(credit_hits) if credit_hits else None

    if debit_pos is not None and credit_pos is not None:
        return "debit" if debit_pos <= credit_pos else "credit"
    if debit_pos is not None:
        return "debit"
    if credit_pos is not None:
        return "credit"
    return None


def _parse_amount(body: str) -> Optional[float]:
    bal_match = BALANCE_RE.search(body)
    limit_match = LIMIT_RE.search(body)
    bal_start = len(body)
    if bal_match:
        bal_start = min(bal_start, bal_match.start())
    if limit_match:
        bal_start = min(bal_start, limit_match.start())

    for match in AMOUNT_RE.finditer(body):
        if match.start() >= bal_start:
            continue
        value = _to_float(match.group(1))
        if value is not None and value > 0:
            return value

    match = AMOUNT_RE.search(body)
    if match:
        value = _to_float(match.group(1))
        if value is not None and value > 0:
            return value
    return None


def _clean_merchant(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    cleaned = re.sub(r"\s+", " ", name).strip(" .-_,")
    if len(cleaned) < 2 or _BAD_MERCHANT.match(cleaned):
        return None
    if cleaned.lower().startswith(("a/c", "acct", "account", "xx")):
        return None
    return cleaned[:60]


def _extract_merchant(body: str, txn_type: str) -> Optional[str]:
    subject = MERCHANT_SUBJECT_RE.search(body)
    if txn_type == "debit" and subject:
        cleaned = _clean_merchant(subject.group(1))
        if cleaned:
            return cleaned

    # Credit-card style: "on 25-Jul-26 on WEFIVE HYPERMAR"
    dated = MERCHANT_ON_DATE_ON_RE.search(body)
    if dated:
        cleaned = _clean_merchant(dated.group(1))
        if cleaned:
            return cleaned

    upi = UPI_VPA_RE.search(body)
    at = MERCHANT_AT_RE.search(body)
    to = MERCHANT_TO_RE.search(body)
    frm = MERCHANT_FROM_RE.search(body)

    if txn_type == "credit":
        candidate = _clean_merchant(frm.group(1) if frm else None) or _clean_merchant(
            to.group(1) if to else None
        )
    else:
        candidate = (
            _clean_merchant(at.group(1) if at else None)
            or _clean_merchant(to.group(1) if to else None)
            or _clean_merchant(frm.group(1) if frm else None)
        )

    if candidate:
        return candidate
    if upi:
        return upi.group(1)
    return None


def _parse_sms_regex(sender: str, body: str) -> Optional[Transaction]:
    """Regex-only SMS parse. Never raises on empty/malformed amounts."""
    if not body or not str(body).strip():
        return None

    text = str(body).strip()
    text_lower = text.lower()

    if _is_spam_or_non_txn(text_lower):
        return None

    # CC statement / payment-received / limit-only alerts are not ledger spend
    cc_kind = classify_credit_card_sms(text)
    if cc_kind in {"statement", "payment", "limit_alert"}:
        return None

    txn_type = _detect_type(text_lower)
    if txn_type is None:
        return None

    if is_bank_ref_narration(text) and not AMOUNT_RE.search(text):
        return None

    amount = _parse_amount(text)
    if amount is None or amount <= 0:
        return None
    if is_phantom_bank_ref_amount(amount, text, txn_type):
        return None

    bank = _detect_bank(sender, text)
    if bank not in ALLOWED_BANKS:
        return None

    account_match = ACCOUNT_RE.search(text)
    balance_match = BALANCE_RE.search(text)
    limit_match = LIMIT_RE.search(text)
    bal_value = None
    if balance_match:
        bal_value = _to_float(balance_match.group(1))
    elif limit_match:
        bal_value = _to_float(limit_match.group(1))

    card_type = _detect_card_type(text_lower)
    if cc_kind == "purchase":
        card_type = "credit_card"

    txn: Transaction = {
        "type": txn_type,
        "amount": amount,
        "account_last4": account_match.group(1) if account_match else None,
        "card_type": card_type,
        "merchant": _extract_merchant(text, txn_type),
        "balance": bal_value,
        "bank": bank,
        "raw_text": text,
    }
    if cc_kind == "purchase":
        txn["cc_sms_kind"] = "purchase"
    return txn


def _coerce_llm_number(value: Any, *, allow_zero: bool = False) -> Optional[float]:
    if value is None or value is False:
        return None
    if isinstance(value, (int, float)):
        n = float(value)
    else:
        n = _to_float(str(value))
        if n is None:
            return None
    if n > 0 or (allow_zero and n >= 0):
        return n
    return None


def _coerce_llm_amount(value: Any) -> Optional[float]:
    return _coerce_llm_number(value, allow_zero=False)


def _txn_from_llm_obj(obj: Any, sender: str, raw_text: str) -> Optional[Transaction]:
    if not isinstance(obj, dict) or obj.get("is_transaction") is False:
        return None
    # Same gate as regex path — do not let the LLM invent spend from CC alerts
    cc_kind = classify_credit_card_sms(raw_text)
    if cc_kind in {"statement", "payment", "limit_alert"}:
        return None
    txn_type = str(obj.get("type") or "").strip().lower()
    if txn_type not in {"debit", "credit"}:
        return None
    if is_neosie_digital_gold_narration(raw_text):
        return None
    if is_bank_ref_narration(raw_text) and not AMOUNT_RE.search(raw_text):
        return None
    amount = _coerce_llm_amount(obj.get("amount"))
    if amount is None:
        return None
    if is_phantom_bank_ref_amount(amount, raw_text, txn_type):
        return None
    token = _amount_digit_token(amount)
    blob = (raw_text or "").replace(",", "")
    if token and not AMOUNT_RE.search(raw_text or "") and not re.search(
        rf"(?<!\d){re.escape(token)}(?!\d)", blob
    ):
        return None
    bank = obj.get("bank") if obj.get("bank") in ALLOWED_BANKS else _detect_bank(sender, raw_text)
    if bank not in ALLOWED_BANKS:
        return None
    last4 = obj.get("account_last4")
    last4_s = re.sub(r"\D", "", str(last4))[-4:] if last4 else ""
    card = obj.get("card_type")
    if card not in ALLOWED_CARD_TYPES:
        card = _detect_card_type(raw_text.lower())
    if cc_kind == "purchase":
        card = "credit_card"
    merchant = obj.get("merchant")
    merchant_s = str(merchant).strip()[:60] if merchant else None
    # Prefer Avl Lmt from narration when LLM omits balance
    bal = _coerce_llm_number(obj.get("balance"), allow_zero=True)
    if bal is None:
        lim = LIMIT_RE.search(raw_text or "")
        if lim:
            bal = _to_float(lim.group(1))
    txn: Transaction = {
        "type": txn_type,
        "amount": amount,
        "account_last4": last4_s or None,
        "card_type": card,
        "merchant": merchant_s or _extract_merchant(raw_text, txn_type),
        "balance": bal,
        "bank": bank,
        "raw_text": raw_text,
    }
    if cc_kind == "purchase":
        txn["cc_sms_kind"] = "purchase"
    return txn


def _parse_sms_llm(sender: str, body: str) -> Optional[Transaction]:
    try:
        provider = get_provider()
        user = (
            "Parse this message into one JSON object with keys: "
            "is_transaction, type, amount, merchant, account_last4, card_type, balance, bank.\n"
            f"sender: {sender}\nmessage: {body}"
        )
        raw = provider.complete(_SMS_LLM_SYSTEM, user, temperature=0.0)
        parsed = extract_json(raw)
        if isinstance(parsed, list) and parsed:
            parsed = parsed[0]
        return _txn_from_llm_obj(parsed, sender, body)
    except LLMError:
        return None
    except Exception:  # noqa: BLE001
        return None


def parse_messages_llm(items: list[tuple[str, str]]) -> list[Optional[Transaction]]:
    """Batch LLM parse for (sender, body) rows regex could not handle."""
    out: list[Optional[Transaction]] = [None] * len(items)
    pending: list[int] = []
    for i, (_sender, body) in enumerate(items):
        text = str(body or "").strip()
        if not text or _is_spam_or_non_txn(text.lower()) or not re.search(r"\d", text):
            continue
        pending.append(i)
    if not pending:
        return out
    try:
        provider = get_provider()
    except LLMError:
        return out

    for start in range(0, len(pending), _LLM_PARSE_BATCH):
        chunk_idx = pending[start : start + _LLM_PARSE_BATCH]
        numbered = "\n".join(
            f"{n}. sender={items[i][0]!s}\n   text={str(items[i][1]).strip()}"
            for n, i in enumerate(chunk_idx, 1)
        )
        user = (
            "Parse each numbered message. Return a JSON array of the same length. "
            "Each element is an object with keys is_transaction, type, amount, merchant, "
            "account_last4, card_type, balance, bank — or null if not a transaction.\n"
            f"{numbered}"
        )
        parsed_list: Any = None
        try:
            raw = provider.complete(_SMS_LLM_SYSTEM, user, temperature=0.0)
            parsed_list = extract_json(raw)
        except LLMError:
            parsed_list = None
        if not isinstance(parsed_list, list) or len(parsed_list) != len(chunk_idx):
            for i in chunk_idx:
                out[i] = _parse_sms_llm(items[i][0], str(items[i][1]).strip())
            continue
        for i, obj in zip(chunk_idx, parsed_list):
            sender, body = items[i]
            out[i] = _txn_from_llm_obj(obj, sender, str(body).strip())
    return out


def parse_sms(sender: str, body: str, *, use_llm: bool = True) -> Optional[Transaction]:
    """
    Parse a bank/UPI SMS into a Transaction, or None if spam / non-transaction.
    Regex first (fast); LLM only if the pattern path cannot extract type+amount.
    """
    if not body or not str(body).strip():
        return None
    text = str(body).strip()
    if _is_spam_or_non_txn(text.lower()):
        return None

    txn = _parse_sms_regex(sender, text)
    if txn is not None:
        return txn
    if use_llm and re.search(r"\d", text):
        return _parse_sms_llm(sender, text)
    return None


if __name__ == "__main__":
    samples = [
        ("HDFCBK", "Rs.500.00 debited from a/c XX1234 at AMAZON on 23-07-26. Avl Bal Rs.12,345.00"),
        ("SBIINB", "Rs 2000 credited to a/c XX5678 from RAVI KUMAR on 23-Jul-26"),
        ("ICICIB", "Rs.150 debited via UPI to rahul@oksbi on 23-07-26. Ref 987654321"),
        ("AXISBK", "Rs.3,499 spent on your Axis Bank Credit Card XX9876 at FLIPKART on 23-07-26"),
        (
            "ICICIB",
            "INR 2,411.00 spent using ICICI Bank Card XX4001 on 25-Jul-26 on WEFIVE HYPERMAR. "
            "Avl Limit: INR 1,31,260.41. If not you, call 1800 2662/SMS BLOCK 4001 to 9215676766",
        ),
        ("VM-HDFCBK", "Your OTP is 123456. Do not share with anyone."),
        ("HDFCBK", "Pre-approved loan offer waiting. Click here now!"),
        ("JD-SBIINB", "Dear SBI User, your A/c X9876-debited by Rs.250.00 on 24Jul26 to SWIGGY. Avl Bal Rs 1000"),
    ]
    for sender, body in samples:
        print(sender, "->", parse_sms(sender, body, use_llm=False))
