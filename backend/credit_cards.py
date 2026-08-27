"""Credit card account snapshots derived from SMS (read-focused)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from parser import (
    ALLOWED_BANKS,
    classify_credit_card_sms,
    extract_credit_card_available_limit,
    extract_credit_card_due_date,
    extract_credit_card_last4,
    extract_credit_card_statement_total,
    _detect_bank,
)


def _as_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc.get("_id"))
    for key in ("as_of", "updated_at", "created_at"):
        val = out.get(key)
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    return out


def upsert_credit_card_from_sms(
    credit_cards: Collection,
    *,
    sender: str,
    body: str,
    received_at: datetime | None = None,
) -> Optional[dict[str, Any]]:
    """
    Upsert a credit_cards row from an SMS body.

    purchase / limit_alert → available_limit + as_of
    statement → statement_total + due_date + as_of
    payment → as_of only (audit; outstanding still from statement)
    """
    kind = classify_credit_card_sms(body)
    if not kind:
        return None

    last4 = extract_credit_card_last4(body)
    if not last4:
        return None

    bank = _detect_bank(sender, body)
    if bank not in ALLOWED_BANKS:
        # ICICI CC SMS sometimes omit bank in sender parse — default ICICI when CC context
        if "icici" in (body or "").lower():
            bank = "ICICI Bank"
        else:
            return None

    as_of = _as_utc(received_at)
    now = datetime.now(timezone.utc)
    key = {"bank": bank, "last4": last4}

    existing = credit_cards.find_one(key) or {}
    patch: dict[str, Any] = {
        "bank": bank,
        "last4": last4,
        "product": existing.get("product") or "credit_card",
        "as_of": as_of,
        "updated_at": now,
        "last_sms_kind": kind,
    }
    if not existing:
        patch["created_at"] = now

    if kind in {"purchase", "limit_alert"}:
        limit = extract_credit_card_available_limit(body)
        if limit is not None:
            patch["available_limit"] = limit
    elif kind == "statement":
        total = extract_credit_card_statement_total(body)
        due = extract_credit_card_due_date(body)
        if total is not None:
            patch["statement_total"] = total
        if due:
            patch["due_date"] = due
    # payment: touch as_of / last_sms_kind only

    credit_cards.update_one(key, {"$set": patch}, upsert=True)
    doc = credit_cards.find_one(key)
    return _serialize(doc) if doc else None


def list_credit_cards(credit_cards: Collection) -> list[dict[str, Any]]:
    rows = list(credit_cards.find().sort([("bank", 1), ("last4", 1)]))
    return [_serialize(r) for r in rows]


def get_credit_card_by_last4(
    credit_cards: Collection,
    last4: str,
    *,
    bank: str | None = None,
) -> Optional[dict[str, Any]]:
    cleaned = "".join(c for c in str(last4) if c.isdigit())[-4:]
    if len(cleaned) != 4:
        return None
    query: dict[str, Any] = {"last4": cleaned}
    if bank:
        query["bank"] = bank
    docs = list(credit_cards.find(query).sort("updated_at", -1).limit(2))
    if not docs:
        return None
    if len(docs) > 1 and not bank:
        # Ambiguous last4 across banks — return first but flag
        out = _serialize(docs[0])
        out["ambiguous"] = True
        out["matches"] = len(docs)
        return out
    return _serialize(docs[0])


def sync_credit_cards_to_liabilities(
    credit_cards: Collection,
    liabilities: Collection,
) -> dict[str, Any]:
    """
    Upsert auto liability rows from credit_cards (statement_total → outstanding).

    Manual liabilities (source != \"credit_cards\") are left untouched.
    Cards without a known statement_total are not written; stale auto rows removed.
    """
    now = datetime.now(timezone.utc)
    cards = list_credit_cards(credit_cards)
    synced: list[dict[str, Any]] = []
    keep_keys: set[tuple[str, str]] = set()

    for card in cards:
        last4 = str(card.get("last4") or "").strip()
        if len(last4) != 4:
            continue
        stmt = card.get("statement_total")
        if stmt is None:
            continue
        bank = str(card.get("bank") or "Credit card").strip() or "Credit card"
        keep_keys.add((bank, last4))
        key = {"source": "credit_cards", "bank": bank, "last4": last4}
        patch: dict[str, Any] = {
            "name": f"{bank} Card XX{last4}",
            "type": "credit_card",
            "outstanding": round(float(stmt), 2),
            "due_date": card.get("due_date"),
            "available_limit": card.get("available_limit"),
            "source": "credit_cards",
            "bank": bank,
            "last4": last4,
            "updated_at": now,
            "as_of": card.get("as_of"),
        }
        liabilities.update_one(key, {"$set": patch, "$setOnInsert": {"created_at": now}}, upsert=True)
        doc = liabilities.find_one(key)
        if doc:
            synced.append(
                {
                    "id": str(doc["_id"]),
                    "name": doc.get("name"),
                    "outstanding": float(doc.get("outstanding") or 0),
                    "due_date": doc.get("due_date"),
                    "last4": last4,
                    "bank": bank,
                }
            )

    removed = 0
    for doc in liabilities.find({"source": "credit_cards"}):
        pair = (str(doc.get("bank") or ""), str(doc.get("last4") or ""))
        if pair not in keep_keys:
            liabilities.delete_one({"_id": doc["_id"]})
            removed += 1

    return {
        "synced": len(synced),
        "removed": removed,
        "items": synced,
    }


def backfill_credit_cards_from_transactions(
    credit_cards: Collection,
    transactions: Collection,
) -> dict[str, Any]:
    """
    One-shot populate from existing SMS transactions (including reclassified rows).
    Safe to re-run; upserts by bank+last4.
    """
    updated = 0
    skipped = 0
    cursor = transactions.find(
        {
            "$or": [
                {"card_type": "credit_card"},
                {"cc_sms_kind": {"$exists": True}},
                {
                    "raw_text": {
                        "$regex": r"credit\s*card|spent on .{0,40}card|avl\.?\s*lmt",
                        "$options": "i",
                    }
                },
            ],
        },
        {"sender": 1, "raw_text": 1, "received_at": 1},
    ).sort("received_at", 1)

    for doc in cursor:
        body = str(doc.get("raw_text") or "")
        if not body:
            skipped += 1
            continue
        sender = str(doc.get("sender") or "")
        res = upsert_credit_card_from_sms(
            credit_cards,
            sender=sender,
            body=body,
            received_at=doc.get("received_at") if isinstance(doc.get("received_at"), datetime) else None,
        )
        if res:
            updated += 1
        else:
            skipped += 1

    return {
        "upserts_attempted": updated,
        "skipped": skipped,
        "cards": list_credit_cards(credit_cards),
    }
