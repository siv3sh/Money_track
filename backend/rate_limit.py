"""Simple in-memory sliding-window rate limits for auth endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

_lock = Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_rate_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_sec: int = 60,
) -> None:
    """Raise 429 if more than `limit` hits for this IP+bucket within the window."""
    key = f"{bucket}:{client_ip(request)}"
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        cutoff = now - window_sec
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts — wait a minute and try again",
            )
        q.append(now)
