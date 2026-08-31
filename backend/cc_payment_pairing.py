"""
Bank-side credit-card payment detection + pairing.

Paired payoffs are tagged cc_payoff=True and categorized as Transfers so they
do not inflate lifestyle spend (card purchases already count on the card side).

Ambiguous candidates are flagged only — category is left unchanged.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

# Extended from tally._CC_PAY_RE — bank narrations for paying a credit card bill
CC_PAY_RE = re.compile(
    r"(?:^|[^a-z])(?:"
    r"credit\s*card\s*payment|cc\s*payment|card\s*payment|"
    r"payment\s*towards\s*(?:icici\s*)?(?:bank\s*)?credit\s*card|"
    r"payment\s*to\s*(?:icici\s*)?(?:bank\s*)?credit\s*card|"
    r"icici\s*(?:bank\s*)?credit\s*card|"
    r"bill\s*pay(?:ment)?\s*(?:to\s*)?(?:icici\s*)?(?:bank\s*)?(?:credit\s*)?card|"
    r"autopay.{0,40}(?:credit\s*card|icici\s*cc)|"
    r"icici\s*cc\b|"
    r"bbps.{0,40}(?:credit\s*card|icici)|"
    r"bharat\s*bill.{0,40}(?:credit\s*card|icici)|"
    r"(?:neft|imps|rtgs|upi).{0,60}(?:credit\s*card|icici\s*cc)"
    r")",
    re.I,
)

_LAST4_RE = re.compile(
    r"(?:card|cc|xx|x{2,})\s*(\d{4})\b|\b(?:ending|no\.?)\s*(\d{4})\b",
    re.I,
)

# UPI to merchants that often collide with statement amounts — never amount-only pair
_MERCHANT_BLOCK_RE = re.compile(
    r"amazon|swiggy|zomato|flipkart|google|phonepe|paytm\s*wallet|merchant",
    re.I,
)


def looks_like_bank_cc_payment(merchant: str | None, raw_text: str | None) -> bool:
    blob = f"{merchant or ''} {raw_text or ''}".strip()
    if not blob:
        return False
    if not CC_PAY_RE.search(blob):
        return False
    # Card-side "payment received on your credit card" is not a bank payoff
    lower = blob.lower()
    if "received on your" in lower and "credit card" in lower:
        return False
    if "spent on" in lower and "card" in lower:
        return False
    return True


def _extract_pay_last4(blob: str) -> Optional[str]:
    m = _LAST4_RE.search(blob)
    if not m:
        return None
    return m.group(1) or m.group(2)


def pair_bank_cc_payment(
    *,
    amount: float,
    merchant: str | None,
    raw_text: str | None,
    card_type: str | None,
    cards: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Decide pairing for a bank-side debit.

    Returns:
      status: none | paired | ambiguous
      last4 / bank / reason when relevant
    """
    if (card_type or "") == "credit_card":
        return {"status": "none", "reason": "card_side_txn"}
    if not looks_like_bank_cc_payment(merchant, raw_text):
        return {"status": "none", "reason": "no_cc_pay_pattern"}

    blob = f"{merchant or ''} {raw_text or ''}"
    last4 = _extract_pay_last4(blob)
    card_by_last4 = {
        str(c.get("last4")): c for c in cards if c.get("last4")
    }

    if last4 and last4 in card_by_last4:
        card = card_by_last4[last4]
        return {
            "status": "paired",
            "last4": last4,
            "bank": card.get("bank"),
            "reason": "narration_last4",
        }

    if last4 and last4 not in card_by_last4:
        return {
            "status": "ambiguous",
            "last4": last4,
            "reason": "last4_not_in_credit_cards",
        }

    # Amount-only: unique statement_total match, narration is CC-pay, not a merchant UPI
    if _MERCHANT_BLOCK_RE.search(blob):
        return {
            "status": "ambiguous",
            "reason": "cc_pay_pattern_but_merchant_like_narration",
        }

    amt = round(float(amount or 0), 2)
    matches = [
        c
        for c in cards
        if c.get("statement_total") is not None
        and abs(float(c["statement_total"]) - amt) < 0.021
    ]
    if len(matches) == 1:
        card = matches[0]
        return {
            "status": "paired",
            "last4": card.get("last4"),
            "bank": card.get("bank"),
            "reason": "unique_statement_total",
        }
    if len(matches) > 1:
        return {
            "status": "ambiguous",
            "reason": "amount_matches_multiple_statement_totals",
            "candidate_last4s": [c.get("last4") for c in matches],
        }

    return {
        "status": "ambiguous",
        "reason": "cc_pay_pattern_unpaired",
    }


def apply_cc_payoff_tags(
    doc: dict[str, Any],
    cards: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Mutate a transaction doc with payoff tags when appropriate.
    Paired → cc_payoff=True, category=Transfers.
    Ambiguous → flag only (no lifestyle exclusion).
    """
    if str(doc.get("type") or "") != "debit":
        return doc
    if doc.get("cc_sms_kind") in {"statement", "payment", "limit_alert"}:
        return doc

    cards = cards or []
    result = pair_bank_cc_payment(
        amount=float(doc.get("amount") or 0),
        merchant=doc.get("merchant"),
        raw_text=doc.get("raw_text"),
        card_type=doc.get("card_type"),
        cards=cards,
    )
    status = result.get("status") or "none"
    if status == "none":
        # Clear stale tags if narration no longer looks like a payoff
        if doc.get("cc_payoff") or doc.get("cc_payoff_status"):
            doc.pop("cc_payoff", None)
            doc.pop("cc_payoff_status", None)
            doc.pop("cc_payoff_last4", None)
            doc.pop("cc_payoff_bank", None)
            doc.pop("cc_payoff_reason", None)
        return doc

    doc["cc_payoff_status"] = status
    doc["cc_payoff_reason"] = result.get("reason")
    if result.get("last4"):
        doc["cc_payoff_last4"] = result["last4"]
    if result.get("bank"):
        doc["cc_payoff_bank"] = result["bank"]

    if status == "paired":
        doc["cc_payoff"] = True
        doc["category"] = "Transfers"
        doc["category_source"] = "cc_payoff"
        doc["cc_payoff_tagged_at"] = datetime.now(timezone.utc).isoformat()
    else:
        # ambiguous — do not exclude from lifestyle; leave category alone
        doc["cc_payoff"] = False
        doc["cc_payoff_ambiguous"] = True

    return doc


def cc_payoff_lifestyle_exclusion() -> dict[str, Any]:
    """Mongo clause: exclude confidently paired bank CC payoffs from lifestyle."""
    return {"cc_payoff": {"$ne": True}}


def scan_and_tag_payoffs(
    transactions,
    credit_cards,
    *,
    execute: bool = False,
    limit: int = 5000,
    user_id=None,
) -> dict[str, Any]:
    """Scan bank debits; optionally write payoff tags. Default dry-run."""
    from credit_cards import list_credit_cards

    if user_id is None:
        raise ValueError("user_id is required for payoff scan")
    cards = list_credit_cards(credit_cards, user_id=user_id)
    cursor = (
        transactions.find(
            {
                "user_id": user_id,
                "type": "debit",
                "card_type": {"$ne": "credit_card"},
            }
        )
        .sort("received_at", -1)
        .limit(limit)
    )

    paired: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    updated = 0

    for doc in cursor:
        probe = {
            "type": doc.get("type"),
            "amount": doc.get("amount"),
            "merchant": doc.get("merchant"),
            "raw_text": doc.get("raw_text"),
            "card_type": doc.get("card_type"),
            "category": doc.get("category"),
        }
        apply_cc_payoff_tags(probe, cards)
        status = probe.get("cc_payoff_status")
        if status not in {"paired", "ambiguous"}:
            continue
        row = {
            "id": str(doc.get("_id")),
            "amount": doc.get("amount"),
            "category_before": doc.get("category"),
            "category_after": probe.get("category"),
            "status": status,
            "reason": probe.get("cc_payoff_reason"),
            "last4": probe.get("cc_payoff_last4"),
            "raw_text": (doc.get("raw_text") or "")[:140],
        }
        if status == "paired":
            paired.append(row)
        else:
            ambiguous.append(row)

        if execute and status == "paired":
            patch = {
                "cc_payoff": True,
                "cc_payoff_status": "paired",
                "cc_payoff_reason": probe.get("cc_payoff_reason"),
                "cc_payoff_last4": probe.get("cc_payoff_last4"),
                "cc_payoff_bank": probe.get("cc_payoff_bank"),
                "cc_payoff_tagged_at": datetime.now(timezone.utc).isoformat(),
                "category": "Transfers",
                "category_source": "cc_payoff",
            }
            transactions.update_one({"_id": doc["_id"]}, {"$set": patch})
            updated += 1
        elif execute and status == "ambiguous":
            patch = {
                "cc_payoff": False,
                "cc_payoff_status": "ambiguous",
                "cc_payoff_ambiguous": True,
                "cc_payoff_reason": probe.get("cc_payoff_reason"),
                "cc_payoff_tagged_at": datetime.now(timezone.utc).isoformat(),
            }
            if probe.get("cc_payoff_last4"):
                patch["cc_payoff_last4"] = probe["cc_payoff_last4"]
            transactions.update_one({"_id": doc["_id"]}, {"$set": patch})
            updated += 1

    return {
        "cards_known": len(cards),
        "paired": paired,
        "ambiguous": ambiguous,
        "paired_count": len(paired),
        "ambiguous_count": len(ambiguous),
        "updated": updated,
        "executed": execute,
    }
