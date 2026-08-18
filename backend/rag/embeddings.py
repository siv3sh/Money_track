"""Text embeddings for import RAG — Gemini when available, else hashed local vectors."""

from __future__ import annotations

import hashlib
import os
import re
from typing import Sequence

import httpx
import numpy as np

EMBED_DIM = 768
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBED_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-004")

_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def _normalize(vec: np.ndarray) -> list[float]:
    n = float(np.linalg.norm(vec))
    if n == 0:
        return [0.0] * EMBED_DIM
    return (vec / n).astype(float).tolist()


def local_hash_embed(text: str) -> list[float]:
    """Deterministic bag-of-tokens hashed into EMBED_DIM (offline fallback)."""
    vec = np.zeros(EMBED_DIM, dtype=np.float64)
    tokens = _TOKEN_RE.findall((text or "").lower())
    if not tokens:
        return _normalize(vec)
    for tok in tokens:
        h = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = int.from_bytes(h[:4], "little") % EMBED_DIM
        sign = 1.0 if h[4] % 2 == 0 else -1.0
        vec[idx] += sign
    return _normalize(vec)


def gemini_embed(text: str) -> list[float] | None:
    if not GEMINI_API_KEY or not (text or "").strip():
        return None
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": text[:8000]}]},
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
            values = (
                data.get("embedding", {}).get("values")
                or data.get("embeddings", [{}])[0].get("values")
            )
            if not values:
                return None
            arr = np.array(values, dtype=np.float64)
            if arr.shape[0] != EMBED_DIM:
                # Pad / truncate to fixed dim for store compatibility
                out = np.zeros(EMBED_DIM, dtype=np.float64)
                n = min(EMBED_DIM, arr.shape[0])
                out[:n] = arr[:n]
                return _normalize(out)
            return _normalize(arr)
    except Exception:  # noqa: BLE001
        return None


def embed_text(text: str) -> list[float]:
    return gemini_embed(text) or local_hash_embed(text)


def embed_batch(texts: Sequence[str]) -> list[list[float]]:
    return [embed_text(t) for t in texts]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b:
        return 0.0
    va = np.asarray(a, dtype=np.float64)
    vb = np.asarray(b, dtype=np.float64)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)
