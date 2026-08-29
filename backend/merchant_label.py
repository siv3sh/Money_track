"""Short, human-readable merchant labels from bank/UPI narrations."""

from __future__ import annotations

import re
from typing import Optional

# Longest-first so okhdfcbank matches before okhdfc
_UPI_HANDLES = (
    "okhdfcbank",
    "okbizaxis",
    "okyesbank",
    "okkotak",
    "okidfc",
    "okicici",
    "okaxis",
    "oksbi",
    "okam",
    "okhdfc",
    "hdfcbank",
    "validhdfc",
    "paytm",
    "ibl",
    "axl",
    "apl",
    "ybl",
    "upi",
    "pty",
    "fbl",
    "rzp",
    "rxair",
    "rapl",
)

_VPA_RE = re.compile(
    r"(?i)([a-z0-9][a-z0-9._\-]{1,40})@("
    + "|".join(re.escape(h) for h in _UPI_HANDLES)
    + r")"
)

# Truncated handles still seen after newline glue (mariajames…@okh)
_VPA_LOOSE_RE = re.compile(
    r"(?i)([a-z0-9][a-z0-9._\-]{2,40})@(ok[a-z]{0,12}|hdfc[a-z]{0,8}|ybl|paytm|ibl|axl|apl|pty|fbl|rzp)"
)

_TXN_PREFIX = re.compile(
    r"(?i)^(?:upi\s*)?(?:out|in)[/:\-\s]*"
    r"|^(?:nft|neft|imps|rtgs|achdr|ach|ecs|ifn|pos|intl\.?\s*ecm\s*mrk)[/:\-\s]*"
)

_REF_TOKEN = re.compile(r"(?i)\b[a-z]{0,4}\d{4,}[a-z0-9]*\b")
_MCC_TAIL = re.compile(r"(?i)(?:/+\s*)?(?:paid\s*v)?/*\d{3,4}\s*$")
_TIME_TOKEN = re.compile(r"\b\d{1,2}:\d{2}\b")
_BANK_NOISE = re.compile(
    r"(?i)\b(?:"
    r"icici\s*bank|hdfc\s*bank|axis\s*bank|kotak\s*bank|federal\s*bank|"
    r"fedone|ffr|ifn|upi|neft|imps|rtgs|achdr|ach|ecs|ref|txn|a/c|acct|account|"
    r"south\s*indi(?:a)?|bank|clearingcorp"
    r")\b"
)

# (substring/regex needle in lowercase blob, display name) — first match wins
_BRAND_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"idea\s*elan"), "Idea Elan"),
    (re.compile(r"geetha"), "Geetha (Family)"),
    (re.compile(r"greeshma"), "Greeshma (Family)"),
    (re.compile(r"pvbalan|\bbalan\d"), "Balan (Family)"),
    (re.compile(r"christ\s*universi"), "Christ University"),
    (re.compile(r"digital\s*gold|neosie"), "Digital Gold"),
    (re.compile(r"zerodha"), "Zerodha"),
    (re.compile(r"indmoney|finzoomers|indstocks"), "INDmoney"),
    (re.compile(r"appleservices|apple\.com|apple\s*services"), "Apple Services"),
    (re.compile(r"amazonpay|amazon\.in|amazon\s*pay|\bamazon\b"), "Amazon"),
    (re.compile(r"lenskart"), "Lenskart"),
    (re.compile(r"swiggy"), "Swiggy"),
    (re.compile(r"zomato"), "Zomato"),
    (re.compile(r"myntra"), "Myntra"),
    (re.compile(r"flipkart"), "Flipkart"),
    (re.compile(r"spotify"), "Spotify"),
    (re.compile(r"netflix"), "Netflix"),
    (re.compile(r"\bcursor\b"), "Cursor"),
    (re.compile(r"paytm"), "Paytm"),
    (re.compile(r"groww"), "Groww"),
    (re.compile(r"phonepe"), "PhonePe"),
    (re.compile(r"google\s*pay|gpay|goog"), "Google Pay"),
    (re.compile(r"indian\s*clearing|clearingcorp|iccl"), "Indian Clearing (MF)"),
    (re.compile(r"oxygen"), "Oxygen Digital"),
    (re.compile(r"redbus"), "Redbus"),
    (re.compile(r"nesto"), "Nesto Hypermarket"),
    (re.compile(r"paramount"), "Paramount Restaurant"),
    (re.compile(r"makemytrip|mmt"), "MakeMyTrip"),
    (re.compile(r"vodafone|\bvi\b|idea\s*cellular"), "Vi (Vodafone Idea)"),
    (re.compile(r"\bfedone\b|\bfederal\s*bank\b"), "Federal Bank"),
    (re.compile(r"bigshopper"), "Bigshopper"),
]

# Generic payroll wording only — employers come from each user's profile keywords
_SALARY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?i)\bsalary\b"),
    re.compile(r"(?i)\bpayroll\b"),
    re.compile(r"(?i)\bsalaries\b"),
]

# Family UPI / people — transfers both ways, not income or lifestyle.
# Personal names live in each user's Profile (people_relation), not hardcoded here.
_FAMILY_PATTERNS: list[tuple[re.Pattern[str], str]] = []

_LOCAL_BRANDS: list[tuple[str, str]] = [
    ("appleservices", "Apple Services"),
    ("amazonpay", "Amazon"),
    ("lenskart", "Lenskart"),
    ("zerodha", "Zerodha"),
    ("indmoney", "INDmoney"),
    ("indstocks", "INDmoney"),
    ("finzoomers", "INDmoney"),
    ("paytm", "Paytm"),
    ("swiggy", "Swiggy"),
    ("zomato", "Zomato"),
    ("phonepe", "PhonePe"),
]


def _compact(text: str) -> str:
    """Drop newlines/spaces that banks insert mid-token."""
    return re.sub(r"[\s]+", "", text or "")


def _person_from_local(local: str) -> str:
    base = re.sub(r"[-_.]?\d+$", "", local)
    base = re.sub(r"[._\-]+", " ", base).strip()
    if not base:
        return "UPI transfer"
    # stk-8592… store codes
    if re.match(r"(?i)^stk\b", base) or re.match(r"^\d+$", base):
        return "UPI merchant"
    parts = [p for p in base.split() if p]
    label = " ".join(p[:1].upper() + p[1:] for p in parts)
    return label[:40]


def _brand_from_blob(blob: str) -> Optional[str]:
    lower = blob.lower()
    for pattern, pretty in _BRAND_RULES:
        if pattern.search(lower):
            return pretty
    return None


def _brand_from_local(local: str) -> Optional[str]:
    lower = local.lower()
    for needle, pretty in _LOCAL_BRANDS:
        if needle in lower:
            return pretty
    return None


def is_salary_source(
    *texts: str | None,
    extra_needles: list[str] | None = None,
) -> bool:
    """True when credit text looks like payroll or matches the user's salary keywords."""
    blob = " ".join(t for t in texts if t)
    if not blob:
        return False
    if any(pattern.search(blob) for pattern in _SALARY_PATTERNS):
        return True
    lower = blob.lower()
    for raw in extra_needles or []:
        needle = str(raw or "").strip().lower()
        if len(needle) < 3:
            continue
        # Allow multi-word employer names with flexible whitespace
        compact_blob = re.sub(r"\s+", " ", lower)
        compact_needle = re.sub(r"\s+", " ", needle)
        if compact_needle in compact_blob:
            return True
        if re.search(re.escape(needle).replace(r"\ ", r"\s+"), lower):
            return True
    return False


def family_person(
    *texts: str | None,
    extra_people: list[tuple[str, str]] | None = None,
) -> Optional[str]:
    """Return family display name if narration matches a known relative."""
    blob = " ".join(t for t in texts if t)
    if not blob:
        return None
    lower = blob.lower()
    for pattern, name in _FAMILY_PATTERNS:
        if pattern.search(lower):
            return name
    for needle, name in extra_people or []:
        n = str(needle or "").strip().lower()
        if len(n) < 3:
            continue
        if n in lower or re.search(re.escape(n).replace(r"\ ", r"\s+"), lower):
            return name
    return None


def is_family_transfer(
    *texts: str | None,
    extra_people: list[tuple[str, str]] | None = None,
) -> bool:
    return family_person(*texts, extra_people=extra_people) is not None


_WEAK_LABELS = frozenset({"Bank transfer", "Unknown", "UPI transfer", "UPI merchant"})


def _label_from(text: str, max_len: int, *, strict: bool = False) -> str:
    """strict=True only trusts brand/VPA hits (used for full SMS bodies)."""
    # Repair mid-token newlines: mariajames…@o\\nkh → …@okh
    joined = re.sub(r"\s+", " ", text.replace("\n", "").replace("\r", "")).strip()
    if not joined:
        return "Unknown"
    compact = _compact(joined)

    brand = _brand_from_blob(joined) or _brand_from_blob(compact)
    if brand:
        return brand

    # Prefer a VPA handle when present
    vpa = _VPA_RE.search(compact) or _VPA_LOOSE_RE.search(compact)
    if vpa:
        local = vpa.group(1)
        local_brand = _brand_from_local(local)
        if local_brand:
            return local_brand
        return _person_from_local(local)[:max_len]

    if strict:
        return "Bank transfer"

    # Strip rail prefixes and reference ids
    s = _TXN_PREFIX.sub("", joined)
    s = _REF_TOKEN.sub(" ", s)
    s = _MCC_TAIL.sub("", s)
    s = _TIME_TOKEN.sub(" ", s)
    s = _BANK_NOISE.sub(" ", s)
    s = re.sub(r"[/\\]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" /-_,.")
    if not s or len(s) < 2:
        return "Bank transfer"

    brand = _brand_from_blob(s)
    if brand:
        return brand

    words = [w for w in s.split() if not re.fullmatch(r"\d+", w)]
    if not words:
        return "Bank transfer"
    label = " ".join(w[:1].upper() + w[1:].lower() for w in words[:5])
    if len(label) > max_len:
        label = label[: max_len - 1].rstrip() + "…"
    return label


def clean_merchant_label(
    name: str | None,
    *,
    fallback: str | None = None,
    max_len: int = 40,
) -> str:
    """
    Turn raw SMS/statement narrations into a short display label.

    Examples:
      NFT/CHRIST UNIVERSI/...      → Christ University
      UPIOUT/.../rajeevkshr@okaxis → Rajeevkshr
      .../zerodhabrokingsignup@hdf → Zerodha
      NFT/IDEA ELAN INDIA/...      → Idea Elan
    """
    name = (name or "").strip()
    fallback = (fallback or "").strip()
    if not name and not fallback:
        return "Unknown"

    if name:
        label = _label_from(name, max_len)
        if label not in _WEAK_LABELS:
            return label

    # Raw SMS bodies are full sentences, so only trust brand/VPA hits from them
    if fallback:
        label = _label_from(fallback, max_len, strict=True)
        if label not in _WEAK_LABELS:
            return label

    return "Bank transfer"
