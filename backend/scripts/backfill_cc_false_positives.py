#!/usr/bin/env python3
"""
Phase 1 backfill — reclassify credit-card false-positive SMS rows in place.

Approved mode: RECLASSIFY only (never delete).
Sets cc_sms_kind to statement|payment|limit_alert so spend aggregations
exclude these rows (via cc_sms_kind + raw_text noise clause).

Usage:
  cd backend && python scripts/backfill_cc_false_positives.py --dry-run
  cd backend && python scripts/backfill_cc_false_positives.py --execute
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _serialize(doc: dict) -> dict:
    out = {}
    for k, v in doc.items():
        if k == "_id":
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _candidates(transactions):
    from parser import classify_credit_card_sms

    out = []
    for doc in transactions.find({"card_type": "credit_card"}):
        kind = classify_credit_card_sms(str(doc.get("raw_text") or ""))
        if kind in {"statement", "payment", "limit_alert"}:
            out.append((doc, kind))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="List candidates only.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Reclassify candidates in place (sets cc_sms_kind; never deletes).",
    )
    args = parser.parse_args()

    if not args.execute and not args.dry_run:
        args.dry_run = True

    if args.execute and args.dry_run:
        print("Pick one of --dry-run or --execute")
        return 2

    from main import transactions

    pairs = _candidates(transactions)
    print(f"Candidates to reclassify: {len(pairs)}")

    if args.dry_run:
        for doc, kind in pairs:
            print(f"  would set cc_sms_kind={kind} id={doc['_id']} amt={doc.get('amount')}")
            print(f"    {(doc.get('raw_text') or '')[:120]}")
        print("No writes performed.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    results = []
    for doc, kind in pairs:
        before = {
            "cc_sms_kind": doc.get("cc_sms_kind"),
            "type": doc.get("type"),
            "card_type": doc.get("card_type"),
            "amount": doc.get("amount"),
            "account_last4": doc.get("account_last4"),
            "merchant": doc.get("merchant"),
        }
        patch = {
            "cc_sms_kind": kind,
            "cc_reclassified_at": now,
            "cc_reclassify_note": "phase1_false_positive_not_spend",
        }
        transactions.update_one({"_id": doc["_id"]}, {"$set": patch})
        after_doc = transactions.find_one({"_id": doc["_id"]}) or {}
        after = {
            "cc_sms_kind": after_doc.get("cc_sms_kind"),
            "type": after_doc.get("type"),
            "card_type": after_doc.get("card_type"),
            "amount": after_doc.get("amount"),
            "account_last4": after_doc.get("account_last4"),
            "merchant": after_doc.get("merchant"),
            "cc_reclassified_at": after_doc.get("cc_reclassified_at"),
            "cc_reclassify_note": after_doc.get("cc_reclassify_note"),
        }
        results.append(
            {
                "id": str(doc["_id"]),
                "kind": kind,
                "raw_text": (doc.get("raw_text") or "")[:200],
                "before": before,
                "after": after,
            }
        )
        print(json.dumps(results[-1], indent=2, default=str))

    print(f"\nReclassified {len(results)} documents. None deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
