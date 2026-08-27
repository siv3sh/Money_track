"""Expense categorization: MCC codes → keywords → merchant memory → Other."""

from __future__ import annotations

import re
from typing import Any, Optional

from merchant_label import clean_merchant_label, is_family_transfer, is_salary_source
from cc_payment_pairing import apply_cc_payoff_tags

# Stable category labels used across API + UI
CATEGORIES = [
    "Food & Dining",
    "Groceries",
    "Shopping",
    "Travel & Transport",
    "Bills & Utilities",
    "Entertainment",
    "Health & Wellness",
    "Investments",
    "Transfers",
    "Education",
    "Subscriptions",
    "Income",
    "Other",
]

# ISO MCC → category (common India UPI / card codes seen in HDFC narrations)
MCC_MAP: dict[str, str] = {
    "0000": "Transfers",
    # Food
    "5812": "Food & Dining",
    "5814": "Food & Dining",
    "5813": "Food & Dining",
    "5462": "Food & Dining",  # bakeries
    # Groceries / markets
    "5411": "Groceries",
    "5422": "Groceries",
    "5499": "Groceries",
    # Shopping / retail
    "5262": "Shopping",
    "5300": "Shopping",
    "5311": "Shopping",
    "5331": "Shopping",
    "5399": "Shopping",
    "5611": "Shopping",
    "5621": "Shopping",
    "5631": "Shopping",
    "5641": "Shopping",
    "5651": "Shopping",
    "5661": "Shopping",
    "5691": "Shopping",
    "5699": "Shopping",
    "5732": "Shopping",
    "5734": "Shopping",
    "5942": "Shopping",
    "5943": "Shopping",
    "5944": "Shopping",
    "5945": "Shopping",
    "5947": "Shopping",
    "5977": "Shopping",  # cosmetics
    "5999": "Shopping",
    # Digital / apps / streaming
    "5815": "Subscriptions",  # digital goods / Apple etc.
    "5816": "Entertainment",
    "5817": "Subscriptions",
    "5818": "Subscriptions",
    "4899": "Subscriptions",  # cable/streaming (Spotify)
    # Telecom / utilities
    "4814": "Bills & Utilities",
    "4816": "Bills & Utilities",
    "4900": "Bills & Utilities",
    # Travel
    "4111": "Travel & Transport",
    "4112": "Travel & Transport",
    "4121": "Travel & Transport",
    "4131": "Travel & Transport",
    "4511": "Travel & Transport",
    "4722": "Travel & Transport",
    "5541": "Travel & Transport",
    "5542": "Travel & Transport",
    "7011": "Travel & Transport",  # lodging
    "7512": "Travel & Transport",
    # Health
    "5912": "Health & Wellness",
    "8011": "Health & Wellness",
    "8021": "Health & Wellness",
    "8043": "Health & Wellness",
    "8062": "Health & Wellness",
    "8099": "Health & Wellness",
    # Investments / securities
    "6211": "Investments",
    "6012": "Investments",
    "6051": "Transfers",
    "6540": "Transfers",
    # Education / stationery sometimes misc shopping — keep education specific
    "8211": "Education",
    "8220": "Education",
    "8299": "Education",
    "8351": "Education",
}

# Merchant / description keyword rules (lowercase substrings)
KEYWORD_RULES: list[tuple[str, str]] = [
    # Income
    ("salary", "Income"),
    ("payroll", "Income"),
    ("credited", "Income"),  # only used when type is credit — see categorize()
    # Food
    ("swiggy", "Food & Dining"),
    ("zomato", "Food & Dining"),
    ("dominos", "Food & Dining"),
    ("mcdonald", "Food & Dining"),
    ("kfc", "Food & Dining"),
    ("starbucks", "Food & Dining"),
    ("cafe", "Food & Dining"),
    ("restaurant", "Food & Dining"),
    ("bakery", "Food & Dining"),
    ("dunzo", "Food & Dining"),
    # Groceries
    ("blinkit", "Groceries"),
    ("zepto", "Groceries"),
    ("bigbasket", "Groceries"),
    ("instamart", "Groceries"),
    ("grocery", "Groceries"),
    ("supermarket", "Groceries"),
    ("hypermar", "Groceries"),
    ("wefive", "Groceries"),
    ("dmart", "Groceries"),
    ("bigshopper", "Groceries"),
    # Shopping
    ("amazon", "Shopping"),
    ("flipkart", "Shopping"),
    ("myntra", "Shopping"),
    ("meesho", "Shopping"),
    ("ajio", "Shopping"),
    ("nykaa", "Shopping"),
    ("snapdeal", "Shopping"),
    ("soni", "Shopping"),
    ("bags", "Shopping"),
    ("shop", "Shopping"),
    # Travel
    ("uber", "Travel & Transport"),
    ("ola", "Travel & Transport"),
    ("rapido", "Travel & Transport"),
    ("irctc", "Travel & Transport"),
    ("makemytrip", "Travel & Transport"),
    ("goibibo", "Travel & Transport"),
    ("ibibo", "Travel & Transport"),
    ("redbus", "Travel & Transport"),
    ("regency", "Travel & Transport"),
    ("hotel", "Travel & Transport"),
    ("indigo", "Travel & Transport"),
    ("airindia", "Travel & Transport"),
    ("petrol", "Travel & Transport"),
    ("fuel", "Travel & Transport"),
    ("parking", "Travel & Transport"),
    ("metro", "Travel & Transport"),
    ("fastag", "Travel & Transport"),
    ("fast tag", "Travel & Transport"),
    ("toll", "Travel & Transport"),
    # Bills
    ("electricity", "Bills & Utilities"),
    ("bescom", "Bills & Utilities"),
    ("kseb", "Bills & Utilities"),
    ("airtel", "Bills & Utilities"),
    ("jio", "Bills & Utilities"),
    ("vodafone", "Bills & Utilities"),
    ("vi-", "Bills & Utilities"),
    ("bsnl", "Bills & Utilities"),
    ("broadband", "Bills & Utilities"),
    ("water bill", "Bills & Utilities"),
    ("gas", "Bills & Utilities"),
    ("recharge", "Bills & Utilities"),
    # Entertainment
    ("netflix", "Entertainment"),
    ("spotify", "Entertainment"),
    ("hotstar", "Entertainment"),
    ("prime video", "Entertainment"),
    ("youtube", "Entertainment"),
    ("bookmyshow", "Entertainment"),
    ("pvr", "Entertainment"),
    ("inox", "Entertainment"),
    ("theater", "Entertainment"),
    ("theatre", "Entertainment"),
    # Health
    ("pharmacy", "Health & Wellness"),
    ("apollo", "Health & Wellness"),
    ("1mg", "Health & Wellness"),
    ("pharmeasy", "Health & Wellness"),
    ("hospital", "Health & Wellness"),
    ("clinic", "Health & Wellness"),
    ("dental", "Health & Wellness"),
    # Investments
    ("zerodha", "Investments"),
    ("groww", "Investments"),
    ("upstox", "Investments"),
    ("kuvera", "Investments"),
    ("indmoney", "Investments"),
    ("indstocks", "Investments"),
    ("finzoomers", "Investments"),
    ("indian clearing", "Investments"),
    ("mutual fund", "Investments"),
    ("stocksip", "Investments"),
    ("stocks", "Investments"),
    ("broker", "Investments"),
    ("digital gold", "Investments"),
    ("neosie", "Investments"),
    # Education
    ("school", "Education"),
    ("college", "Education"),
    ("tuition", "Education"),
    ("udemy", "Education"),
    ("coursera", "Education"),
    # Subscriptions / software
    ("apple", "Subscriptions"),
    ("icloud", "Subscriptions"),
    ("google one", "Subscriptions"),
    ("microsoft", "Subscriptions"),
    ("adobe", "Subscriptions"),
    ("notion", "Subscriptions"),
    ("cursor", "Subscriptions"),
    # Shopping extras
    ("apparel", "Shopping"),
    # Transfers / P2P
    ("self transfer", "Transfers"),
    ("to self", "Transfers"),
    ("own account", "Transfers"),
]

MCC_RE = re.compile(r"(?:/|\s)(\d{4})\s*$")
# Also match ".../5814" mid/end patterns common in UPIOUT lines
MCC_SLASH_RE = re.compile(r"/(\d{4})(?:\s|$)")


def _normalize_narration(text: str) -> str:
    """Collapse OCR line-breaks that split MCCs like '/546\\n2' → '/5462'."""
    cleaned = (text or "").replace("\r", " ").replace("\n", " ")
    # Join digit runs broken by whitespace (statement OCR)
    while True:
        nxt = re.sub(r"(\d)\s+(\d)", r"\1\2", cleaned)
        if nxt == cleaned:
            break
        cleaned = nxt
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_mcc(text: str) -> Optional[str]:
    if not text:
        return None
    cleaned = _normalize_narration(text)
    m = MCC_RE.search(cleaned)
    if m:
        return m.group(1)
    matches = MCC_SLASH_RE.findall(cleaned)
    if matches:
        return matches[-1]
    return None


def _keyword_category(blob: str, txn_type: str | None) -> Optional[str]:
    lower = blob.lower()
    # Credits: prefer Income unless clearly a refund category from keywords
    if txn_type == "credit":
        for needle, category in KEYWORD_RULES:
            if needle in lower and category != "Income":
                # refunds of known merchants keep that category
                if any(w in lower for w in ("refund", "reversed", "cashback")):
                    return category
        return "Income"

    for needle, category in KEYWORD_RULES:
        if needle == "credited":
            continue
        if needle in lower:
            return category
    return None


def categorize(
    *,
    merchant: str | None = None,
    raw_text: str | None = None,
    txn_type: str | None = None,
    merchant_memory: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Return {category, mcc, source} where source is
    mcc | keyword | memory | type_default | other.
    """
    merchant_s = (merchant or "").strip()
    raw = (raw_text or "").strip()
    blob = f"{merchant_s} {raw}".strip()

    # Family transfers beat MCC/Income defaults (credits from relatives are not salary)
    if is_family_transfer(merchant_s, raw):
        mcc_early = extract_mcc(raw) or extract_mcc(merchant_s)
        return {"category": "Transfers", "mcc": mcc_early, "source": "family"}

    mcc = extract_mcc(raw) or extract_mcc(merchant_s)
    if mcc and mcc in MCC_MAP:
        # 0000 on credits is Income; on debits Transfers
        if mcc == "0000" and txn_type == "credit":
            return {"category": "Income", "mcc": mcc, "source": "mcc"}
        return {"category": MCC_MAP[mcc], "mcc": mcc, "source": "mcc"}

    # Merchant memory (manual overrides) — check raw + cleaned label
    if merchant_memory and merchant_s:
        key = merchant_s.lower()
        if key in merchant_memory:
            return {
                "category": merchant_memory[key],
                "mcc": mcc,
                "source": "memory",
            }
        cleaned = clean_merchant_label(merchant_s, fallback=raw).lower()
        if cleaned and cleaned in merchant_memory:
            return {
                "category": merchant_memory[cleaned],
                "mcc": mcc,
                "source": "memory",
            }

    if txn_type == "credit" and is_salary_source(merchant_s, raw):
        return {"category": "Income", "mcc": mcc, "source": "salary"}

    kw = _keyword_category(blob, txn_type)
    if kw:
        return {"category": kw, "mcc": mcc, "source": "keyword"}

    if txn_type == "credit":
        return {"category": "Income", "mcc": mcc, "source": "type_default"}

    return {"category": "Other", "mcc": mcc, "source": "other"}


def apply_category(
    doc: dict[str, Any],
    merchant_memory: dict[str, str] | None = None,
    credit_card_accounts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Mutate/return doc with category (+ mcc, category_source) fields."""
    invest_hint = bool(doc.pop("_investment_hint", None))
    existing_source = str(doc.get("category_source") or "")
    existing_cat = str(doc.get("category") or "").strip()

    def _finish() -> dict[str, Any]:
        apply_cc_payoff_tags(doc, credit_card_accounts or [])
        return doc

    # Keep high-signal RAG hits unless investment cue forces Investments
    if (
        existing_source.startswith("rag:")
        and existing_cat
        and existing_cat != "Other"
        and not invest_hint
    ):
        return _finish()

    result = categorize(
        merchant=doc.get("merchant"),
        raw_text=doc.get("raw_text"),
        txn_type=doc.get("type"),
        merchant_memory=merchant_memory,
    )
    # Statement investment cues beat weak Other/type_default — not merchant memory
    if (
        invest_hint
        and doc.get("type") == "debit"
        and result["source"] in {"other", "type_default"}
    ):
        result = {
            "category": "Investments",
            "mcc": result.get("mcc"),
            "source": "keyword",
        }
    # Prefer RAG over weak Other when both exist
    if (
        existing_source.startswith("rag:")
        and existing_cat
        and existing_cat != "Other"
        and result["source"] in {"other", "type_default"}
    ):
        doc["category"] = existing_cat
        doc["category_source"] = existing_source
        return _finish()

    doc["category"] = result["category"]
    doc["mcc"] = result.get("mcc")
    doc["category_source"] = result["source"]
    return _finish()
