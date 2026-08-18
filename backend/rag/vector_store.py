"""
Mongo-only vector store for import RAG.

Collections:
  - document_formats  — header signatures + column mappings + embeddings
  - merchant_knowledge — descriptions + categories + embeddings

Similarity is cosine over float arrays stored on each document.
(Optional later: Atlas Vector Search index on the same fields.)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from rag.embeddings import cosine, embed_text

DOC_MATCH_THRESHOLD = float(os.getenv("RAG_DOC_MATCH_THRESHOLD", "0.62"))
MERCHANT_MATCH_THRESHOLD = float(os.getenv("RAG_MERCHANT_MATCH_THRESHOLD", "0.48"))


def _classification_for_category(category: str) -> str:
    c = (category or "").lower()
    if c in {"investments"}:
        return "asset"
    if c in {"transfers", "other"}:
        return "neutral"
    if c in {"bills & utilities"}:
        return "liability"
    return "neutral"


class VectorStore:
    """DocumentFormat + MerchantKnowledge backed by MongoDB."""

    def __init__(self, mongo_db: Any | None = None) -> None:
        self._mongo = mongo_db

    @property
    def backend(self) -> str:
        return "mongo"

    def _col(self, name: str) -> Any | None:
        if self._mongo is None:
            return None
        return self._mongo[name]

    def upsert_document_format(
        self,
        *,
        flow: str,
        header_signature: str,
        column_mapping: dict[str, Any],
        bank: str | None = None,
        sheet_purpose: str | None = None,
        filename_hint: str | None = None,
    ) -> dict[str, Any]:
        col = self._col("document_formats")
        if col is None:
            return {"id": None, "backend": "mongo"}

        emb = embed_text(header_signature)
        now = datetime.now(timezone.utc)
        matches = self.match_document_formats(
            header_signature, flow=flow, k=1, threshold=0.92
        )
        if matches:
            rid = matches[0]["id"]
            col.update_one(
                {"_id": rid},
                {
                    "$set": {
                        "column_mapping": column_mapping,
                        "bank": bank,
                        "sheet_purpose": sheet_purpose,
                        "filename_hint": filename_hint,
                        "header_embedding": emb,
                        "header_signature": header_signature[:2000],
                        "updated_at": now,
                    },
                    "$inc": {"usage_count": 1},
                },
            )
            return {"id": str(rid), "backend": "mongo", "updated": True}

        result = col.insert_one(
            {
                "flow": flow,
                "header_signature": header_signature[:2000],
                "header_embedding": emb,
                "column_mapping": column_mapping,
                "bank": bank,
                "sheet_purpose": sheet_purpose,
                "filename_hint": filename_hint,
                "usage_count": 1,
                "created_at": now,
                "updated_at": now,
            }
        )
        return {"id": str(result.inserted_id), "backend": "mongo", "updated": False}

    def match_document_formats(
        self,
        header_signature: str,
        *,
        flow: str,
        k: int = 5,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        col = self._col("document_formats")
        if col is None:
            return []
        thr = DOC_MATCH_THRESHOLD if threshold is None else threshold
        emb = embed_text(header_signature)
        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in col.find({"flow": flow}).limit(500):
            sim = cosine(emb, doc.get("header_embedding") or [])
            if sim < thr:
                continue
            scored.append(
                (
                    sim,
                    {
                        "id": doc.get("_id"),
                        "flow": doc.get("flow"),
                        "header_signature": doc.get("header_signature"),
                        "column_mapping": doc.get("column_mapping") or {},
                        "bank": doc.get("bank"),
                        "sheet_purpose": doc.get("sheet_purpose"),
                        "usage_count": doc.get("usage_count") or 1,
                        "similarity": round(sim, 4),
                    },
                )
            )
        scored.sort(key=lambda x: x[0], reverse=True)
        return [s[1] for s in scored[:k]]

    def upsert_merchant_knowledge(
        self,
        *,
        description: str,
        category: str,
        classification: str | None = None,
        merchant_key: str | None = None,
        confidence: float | None = None,
        source: str = "correction",
    ) -> dict[str, Any]:
        col = self._col("merchant_knowledge")
        if col is None:
            return {"id": None, "backend": "mongo"}

        emb = embed_text(description)
        now = datetime.now(timezone.utc)
        payload = {
            "description": description[:1000],
            "description_embedding": emb,
            "category": category,
            "classification": classification or _classification_for_category(category),
            "merchant_key": (merchant_key or "").lower() or None,
            "confidence": confidence,
            "source": source,
            "updated_at": now,
        }
        if merchant_key:
            existing = col.find_one({"merchant_key": merchant_key.lower()})
            if existing:
                col.update_one({"_id": existing["_id"]}, {"$set": payload})
                return {
                    "id": str(existing["_id"]),
                    "backend": "mongo",
                    "updated": True,
                }
        result = col.insert_one({**payload, "created_at": now})
        return {"id": str(result.inserted_id), "backend": "mongo"}

    def match_merchant_knowledge(
        self,
        description: str,
        *,
        k: int = 5,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        col = self._col("merchant_knowledge")
        if col is None:
            return []
        thr = MERCHANT_MATCH_THRESHOLD if threshold is None else threshold
        emb = embed_text(description)
        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in col.find({}).limit(2000):
            sim = cosine(emb, doc.get("description_embedding") or [])
            if sim < thr:
                continue
            scored.append(
                (
                    sim,
                    {
                        "id": doc.get("_id"),
                        "description": doc.get("description"),
                        "category": doc.get("category"),
                        "classification": doc.get("classification"),
                        "merchant_key": doc.get("merchant_key"),
                        "confidence": doc.get("confidence"),
                        "source": doc.get("source"),
                        "similarity": round(sim, 4),
                    },
                )
            )
        scored.sort(key=lambda x: x[0], reverse=True)
        return [s[1] for s in scored[:k]]

    def seed_from_category_memory(self, category_memory: Any, limit: int = 2000) -> int:
        n = 0
        try:
            for row in category_memory.find({}).limit(limit):
                key = (row.get("merchant_key") or "").strip().lower()
                cat = (row.get("category") or "").strip()
                merchant = (row.get("merchant") or key).strip()
                if not key or not cat:
                    continue
                self.upsert_merchant_knowledge(
                    description=f"{merchant} {key}",
                    category=cat,
                    classification=_classification_for_category(cat),
                    merchant_key=key,
                    confidence=0.95,
                    source="category_memory_seed",
                )
                n += 1
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: seed MerchantKnowledge failed: {exc}")
        return n


_store: Optional[VectorStore] = None


def get_vector_store(mongo_db: Any | None = None) -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore(mongo_db=mongo_db)
    elif mongo_db is not None and _store._mongo is None:
        _store._mongo = mongo_db
    return _store
