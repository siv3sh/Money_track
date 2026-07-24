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


AMOUNT_RE = re.compile(r"(?:Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE)
ACCOUNT_RE = re.compile(r"(?:a/c|account|card)\D{0,15}(\d{4})\b", re.IGNORECASE)
BALANCE_RE = re.compile(r"(?:avl\.?\s?bal|available\s?bal(?:ance)?)\D{0,10}(?:Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE)

MERCHANT_RE = re.compile(r"(?:at|to)\s+([A-Za-z0-9&_.\-@\s]{2,35}?)(?:\s+on\b|\.|$)", re.IGNORECASE)
UPI_VPA_RE = re.compile(r"\b([\w.\-]+@[\w]+)\b")

DEBIT_KEYWORDS = ["debited", "spent", "paid", "withdrawn", "purchase of", "sent"]
CREDIT_KEYWORDS = ["credited", "received", "deposited"]

CARD_TYPE_KEYWORDS = [
    ("credit card", "credit_card"),
    ("debit card", "debit_card"),
    ("upi", "upi"),
]

BANK_SENDER_MAP = {
    "HDFCBK": "HDFC Bank",
    "SBIINB": "SBI",
    "ICICIB": "ICICI Bank",
    "AXISBK": "Axis Bank",
    "KOTAKB": "Kotak Bank",
    "IDFCFB": "IDFC First Bank",
}


def _to_float(amount_str: str) -> float:
    return float(amount_str.replace(",", ""))


def _detect_card_type(text_lower: str) -> Optional[str]:
    for keyword, label in CARD_TYPE_KEYWORDS:
        if keyword in text_lower:
            return label
    return "bank_account"


def parse_sms(sender: str, body: str) -> Optional[Transaction]:
    text_lower = body.lower()

    if any(k in text_lower for k in DEBIT_KEYWORDS):
        txn_type = "debit"
    elif any(k in text_lower for k in CREDIT_KEYWORDS):
        txn_type = "credit"
    else:
        return None

    amount_match = AMOUNT_RE.search(body)
    if not amount_match:
        return None

    account_match = ACCOUNT_RE.search(body)
    balance_match = BALANCE_RE.search(body)

    upi_match = UPI_VPA_RE.search(body)
    merchant_match = MERCHANT_RE.search(body)
    merchant = upi_match.group(1) if upi_match else (
        merchant_match.group(1).strip() if merchant_match else None
    )

    return Transaction(
        type=txn_type,
        amount=_to_float(amount_match.group(1)),
        account_last4=account_match.group(1) if account_match else None,
        card_type=_detect_card_type(text_lower),
        merchant=merchant,
        balance=_to_float(balance_match.group(1)) if balance_match else None,
        bank=BANK_SENDER_MAP.get(sender.upper()),
        raw_text=body,
    )


if __name__ == "__main__":
    samples = [
        ("HDFCBK", "Rs.500.00 debited from a/c XX1234 at AMAZON on 23-07-26. Avl Bal Rs.12,345.00"),
        ("SBIINB", "Rs 2000 credited to a/c XX5678 from RAVI KUMAR on 23-Jul-26"),
        ("ICICIB", "Rs.150 debited via UPI to rahul@oksbi on 23-07-26. Ref 987654321"),
        ("AXISBK", "Rs.3,499 spent on your Axis Bank Credit Card XX9876 at FLIPKART on 23-07-26"),
    ]
    for sender, body in samples:
        print(parse_sms(sender, body))
