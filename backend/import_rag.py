"""Lightweight RAG for statement imports — token TF cosine over Mongo examples.

No external embedding service required. Indexes:
  - merchant → category memories
  - past reviewed import narrations
  - known statement header / template snippets
"""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from pymongo.collection import Collection

_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _tf(tokens: list[str]) -> dict[str, float]:
    if not tokens:
        return {}
    counts = Counter(tokens)
    n = float(len(tokens))
    return {t: c / n for t, c in counts.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) & set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


class ImportRAG:
    """In-memory retrieval index built from Mongo + seeded templates."""

    def __init__(self) -> None:
        self._docs: list[dict[str, Any]] = []

    def __len__(self) -> int:
        return len(self._docs)

    def clear(self) -> None:
        self._docs.clear()

    def add(
        self,
        *,
        kind: str,
        text: str,
        payload: dict[str, Any] | None = None,
        bank: str | None = None,
    ) -> None:
        tokens = tokenize(text)
        if not tokens:
            return
        self._docs.append(
            {
                "kind": kind,
                "text": text[:800],
                "bank": bank,
                "payload": payload or {},
                "tf": _tf(tokens),
            }
        )

    def seed_templates(self) -> None:
        templates = [
            (
                "Federal Bank",
                "template",
                "Txn Date Value Date Particulars Withdrawals Deposits Balance Federal Bank savings statement",
            ),
            (
                "Federal Bank",
                "template",
                "Transaction Date Narration Debit Credit Closing Balance FEDBNK account statement",
            ),
            (
                "ICICI Bank",
                "template",
                "Transaction Date Details Debit Credit Balance ICICI Bank savings account statement",
            ),
            (
                "ICICI Bank",
                "template",
                "Date Transaction Details Amount Debit Credit ICICI credit card statement Visa Mastercard",
            ),
            (
                "ICICI Bank",
                "template",
                "Date of Transaction Serial No Transaction Details Reward Points Amount",
            ),
        ]
        for bank, kind, text in templates:
            self.add(kind=kind, text=text, bank=bank, payload={"role": "header_template"})

    def load_from_mongo(
        self,
        *,
        category_memory: Collection | None = None,
        transactions: Collection | None = None,
        rag_examples: Collection | None = None,
        txn_limit: int = 1500,
        example_limit: int = 800,
    ) -> int:
        self.clear()
        self.seed_templates()
        n = 0

        if category_memory is not None:
            for row in category_memory.find({}, {"merchant_key": 1, "category": 1}).limit(2000):
                key = str(row.get("merchant_key") or "").strip()
                cat = str(row.get("category") or "").strip()
                if not key or not cat:
                    continue
                self.add(
                    kind="merchant_memory",
                    text=f"{key} category {cat}",
                    payload={"merchant_key": key, "category": cat},
                )
                n += 1

        if transactions is not None:
            cursor = (
                transactions.find(
                    {"category": {"$exists": True, "$nin": [None, "", "Other"]}},
                    {"merchant": 1, "raw_text": 1, "category": 1, "bank": 1, "type": 1},
                )
                .sort("received_at", -1)
                .limit(txn_limit)
            )
            for row in cursor:
                merchant = str(row.get("merchant") or "").strip()
                raw = str(row.get("raw_text") or "").strip()
                cat = str(row.get("category") or "").strip()
                if not cat:
                    continue
                blob = f"{merchant} {raw} {cat}".strip()
                if len(blob) < 4:
                    continue
                self.add(
                    kind="past_txn",
                    text=blob[:500],
                    bank=row.get("bank"),
                    payload={
                        "category": cat,
                        "merchant": merchant,
                        "type": row.get("type"),
                    },
                )
                n += 1

        if rag_examples is not None:
            for row in rag_examples.find({}).sort("created_at", -1).limit(example_limit):
                text = str(row.get("text") or "").strip()
                if not text:
                    continue
                self.add(
                    kind=str(row.get("kind") or "example"),
                    text=text,
                    bank=row.get("bank"),
                    payload=dict(row.get("payload") or {}),
                )
                n += 1

        return n

    def retrieve(
        self,
        query: str,
        *,
        k: int = 5,
        kinds: Iterable[str] | None = None,
        bank: str | None = None,
        min_score: float = 0.08,
    ) -> list[dict[str, Any]]:
        qtf = _tf(tokenize(query))
        if not qtf:
            return []
        kind_set = set(kinds) if kinds else None
        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in self._docs:
            if kind_set and doc["kind"] not in kind_set:
                continue
            if bank and doc.get("bank") and doc["bank"] != bank:
                # Soft preference: still allow but slight penalty applied later
                pass
            score = _cosine(qtf, doc["tf"])
            if bank and doc.get("bank") == bank:
                score += 0.05
            if score < min_score:
                continue
            scored.append((score, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        out: list[dict[str, Any]] = []
        for score, doc in scored[:k]:
            out.append(
                {
                    "score": round(score, 4),
                    "kind": doc["kind"],
                    "text": doc["text"],
                    "bank": doc.get("bank"),
                    "payload": doc.get("payload") or {},
                }
            )
        return out

    def suggest_category(
        self,
        narration: str,
        *,
        bank: str | None = None,
        min_score: float = 0.22,
    ) -> Optional[dict[str, Any]]:
        hits = self.retrieve(
            narration,
            k=5,
            kinds=("merchant_memory", "past_txn", "example"),
            bank=bank,
            min_score=min_score,
        )
        for hit in hits:
            cat = (hit.get("payload") or {}).get("category")
            if cat and cat != "Other":
                return {
                    "category": cat,
                    "confidence": hit["score"],
                    "source": hit["kind"],
                    "evidence": hit["text"][:160],
                }
        return None

    def suggest_bank(self, sample: str) -> Optional[dict[str, Any]]:
        hits = self.retrieve(sample, k=3, kinds=("template",), min_score=0.12)
        if not hits:
            return None
        top = hits[0]
        bank = top.get("bank")
        if not bank:
            return None
        return {"bank": bank, "confidence": top["score"], "evidence": top["text"][:120]}


def remember_import_examples(
    rag_examples: Collection,
    docs: list[dict[str, Any]],
    *,
    bank: str | None = None,
    limit: int = 40,
) -> int:
    """Persist high-signal categorized rows for future RAG retrieval."""
    written = 0
    now = datetime.now(timezone.utc)
    for doc in docs[:limit]:
        cat = str(doc.get("category") or "").strip()
        if not cat or cat == "Other":
            continue
        merchant = str(doc.get("merchant") or "").strip()
        raw = str(doc.get("raw_text") or "").strip()
        text = f"{merchant} {raw} {cat}".strip()
        if len(text) < 6:
            continue
        try:
            rag_examples.insert_one(
                {
                    "kind": "example",
                    "text": text[:500],
                    "bank": bank or doc.get("bank"),
                    "payload": {
                        "category": cat,
                        "merchant": merchant,
                        "type": doc.get("type"),
                    },
                    "created_at": now,
                }
            )
            written += 1
        except Exception:  # noqa: BLE001
            continue
    return written
