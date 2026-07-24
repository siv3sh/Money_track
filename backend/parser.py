import re
from typing import Optional, TypedDict


class Transaction(TypedDict):
    type: str                # "debit" or "credit"
    amount: float
    account_last4: Optional[str]
    card_type: Optional[str] # "credit_card", "debit_card", "upi", "bank_account"
    merchant: Optional[str]
    balance: Optional[float]
    bank: Optional[str]
    raw_text: str


# Prefer ₹ / Rs / INR; allow optional space
AMOUNT_RE = re.compile(r"(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE)
ACCOUNT_RE = re.compile(r"(?:a/?c|acct|account|card)\D{0,20}(\d{4})\b", re.IGNORECASE)
BALANCE_RE = re.compile(
    r"(?:avl\.?\s?bal|available\s?bal(?:ance)?|bal(?:ance)?)\D{0,12}(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)

# Merchant / payee — avoid matching "to a/c …"
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
UPI_VPA_RE = re.compile(r"\b([\w.\-]+@[\w]+)\b")

DEBIT_KEYWORDS = ["debited", "spent", "paid", "withdrawn", "purchase of", "sent", "dr "]
CREDIT_KEYWORDS = ["credited", "received", "deposited", "cr "]

CARD_TYPE_KEYWORDS = [
    ("credit card", "credit_card"),
    ("debit card", "debit_card"),
    ("upi", "upi"),
]

BANK_SENDER_MAP = {
    "HDFCBK": "HDFC Bank",
    "HDFC": "HDFC Bank",
    "SBIINB": "SBI",
    "SBIPSG": "SBI",
    "SBI": "SBI",
    "ICICIB": "ICICI Bank",
    "ICICI": "ICICI Bank",
    "AXISBK": "Axis Bank",
    "AXIS": "Axis Bank",
    "KOTAKB": "Kotak Bank",
    "KOTAK": "Kotak Bank",
    "IDFCFB": "IDFC First Bank",
    "IDFC": "IDFC First Bank",
    "YESBNK": "Yes Bank",
    "PAYTMB": "Paytm",
    "PHONEPE": "PhonePe",
}

# Junk merchant fragments to drop
_BAD_MERCHANT = re.compile(
    r"^(a/?c|acct|account|card|your|the|upi|ref|info|inr|rs\.?|xx+\d*)$",
    re.IGNORECASE,
)


def _to_float(amount_str: str) -> float:
    return float(amount_str.replace(",", ""))


def _detect_card_type(text_lower: str) -> Optional[str]:
    for keyword, label in CARD_TYPE_KEYWORDS:
        if keyword in text_lower:
            return label
    if "@" in text_lower or "upi" in text_lower:
        return "upi"
    return "bank_account"


def _detect_bank(sender: str) -> Optional[str]:
    """Match exact or suffix (VM-HDFCBK, AX-AXISBK, JD-SBIINB, …)."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", (sender or "")).upper()
    if not cleaned:
        return None
    # Prefer longer keys first so HDFCBK wins over HDFC
    for key, name in sorted(BANK_SENDER_MAP.items(), key=lambda kv: -len(kv[0])):
        if cleaned == key.upper() or cleaned.endswith(key.upper()):
            return name
    return None


def _detect_type(text_lower: str) -> Optional[str]:
    debit_hits = [text_lower.find(k) for k in DEBIT_KEYWORDS if k in text_lower]
    credit_hits = [text_lower.find(k) for k in CREDIT_KEYWORDS if k in text_lower]
    debit_pos = min(debit_hits) if debit_hits else None
    credit_pos = min(credit_hits) if credit_hits else None

    if debit_pos is not None and credit_pos is not None:
        # Whichever verb appears first describes the customer's txn
        return "debit" if debit_pos <= credit_pos else "credit"
    if debit_pos is not None:
        return "debit"
    if credit_pos is not None:
        return "credit"
    return None


def _parse_amount(body: str) -> Optional[float]:
    """Use the first money amount that is not clearly the available-balance figure."""
    bal_match = BALANCE_RE.search(body)
    bal_start = bal_match.start() if bal_match else len(body)

    for match in AMOUNT_RE.finditer(body):
        if match.start() >= bal_start:
            continue
        # Skip tiny matches that are only inside the balance clause
        value = _to_float(match.group(1))
        if value > 0:
            return value

    # Fallback: first amount anywhere
    match = AMOUNT_RE.search(body)
    if match:
        return _to_float(match.group(1))
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


def parse_sms(sender: str, body: str) -> Optional[Transaction]:
    if not body or not str(body).strip():
        return None

    text = str(body).strip()
    text_lower = text.lower()

    txn_type = _detect_type(text_lower)
    if txn_type is None:
        return None

    amount = _parse_amount(text)
    if amount is None or amount <= 0:
        return None

    account_match = ACCOUNT_RE.search(text)
    balance_match = BALANCE_RE.search(text)

    return Transaction(
        type=txn_type,
        amount=amount,
        account_last4=account_match.group(1) if account_match else None,
        card_type=_detect_card_type(text_lower),
        merchant=_extract_merchant(text, txn_type),
        balance=_to_float(balance_match.group(1)) if balance_match else None,
        bank=_detect_bank(sender),
        raw_text=text,
    )


if __name__ == "__main__":
    samples = [
        ("HDFCBK", "Rs.500.00 debited from a/c XX1234 at AMAZON on 23-07-26. Avl Bal Rs.12,345.00"),
        ("SBIINB", "Rs 2000 credited to a/c XX5678 from RAVI KUMAR on 23-Jul-26"),
        ("ICICIB", "Rs.150 debited via UPI to rahul@oksbi on 23-07-26. Ref 987654321"),
        ("AXISBK", "Rs.3,499 spent on your Axis Bank Credit Card XX9876 at FLIPKART on 23-07-26"),
        ("VM-HDFCBK", "Rs.500.00 debited from a/c XX1234 at AMAZON on 23-07-26. Avl Bal Rs.12,345.00"),
        ("JD-SBIINB", "Dear SBI User, your A/c X1234-debited by Rs.250.00 on 24Jul26 to SWIGGY. Avl Bal Rs 1000"),
    ]
    for sender, body in samples:
        print(parse_sms(sender, body))
