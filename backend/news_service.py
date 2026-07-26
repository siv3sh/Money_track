"""Finance news for monthly reports — Marketaux primary, Alpha Vantage fallback.

Results are cached daily and filtered to the user's actual holdings.
Not exposed as an in-app news feed.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from pymongo.collection import Collection

MARKETAUX_KEY = os.getenv("MARKETAUX_API_KEY", "").strip()
ALPHAVANTAGE_KEY = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()

# Map holding names / asset classes → search entities for news APIs
_ASSET_ENTITY_MAP: list[tuple[str, list[str]]] = [
    ("digital gold", ["gold", "XAU"]),
    ("gold", ["gold", "XAU"]),
    ("voo", ["VOO", "S&P 500", "US stocks"]),
    ("s&p", ["S&P 500", "SPY", "VOO"]),
    ("us stock", ["US stocks", "S&P 500", "VOO"]),
    ("us equity", ["US stocks", "S&P 500"]),
    ("nifty", ["Nifty 50", "NSE"]),
    ("mutual fund", ["Nifty 50", "Indian mutual funds", "NSE"]),
    ("equity", ["Nifty 50", "NSE India"]),
    ("brokerage", ["Nifty 50", "NSE India"]),
    ("groww", ["Nifty 50", "NSE"]),
    ("zerodha", ["Nifty 50", "NSE"]),
    ("indmoney", ["Nifty 50", "NSE"]),
    ("upstox", ["Nifty 50", "NSE"]),
]

_TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")
_KNOWN_TICKERS = {
    "VOO",
    "SPY",
    "QQQ",
    "VT",
    "VXUS",
    "GLD",
    "IAU",
    "NIFTY",
    "BANKNIFTY",
}


def entities_from_holdings(holdings: list[dict[str, Any]]) -> list[str]:
    """Derive news search entities from portfolio holdings (no hardcoding of tickers)."""
    found: list[str] = []
    seen: set[str] = set()

    def add(label: str) -> None:
        key = label.strip().lower()
        if not key or key in seen:
            return
        seen.add(key)
        found.append(label.strip())

    for h in holdings:
        name = str(h.get("name") or "")
        asset = str(h.get("asset_class") or "")
        blob = f"{name} {asset}".lower()
        for needle, entities in _ASSET_ENTITY_MAP:
            if needle in blob:
                for e in entities:
                    add(e)
        for tok in _TICKER_RE.findall(name.upper()):
            if tok in _KNOWN_TICKERS:
                add(tok)

    # Always include broad India + gold + US if we have any equity-like holding
    classes = {str(h.get("asset_class") or "").lower() for h in holdings}
    if any("equity" in c or "mutual" in c or "broker" in c for c in classes):
        add("Nifty 50")
    if any("gold" in c for c in classes):
        add("gold")
    if any("us" in c for c in classes) or any(
        "voo" in str(h.get("name") or "").lower() for h in holdings
    ):
        add("S&P 500")
        add("VOO")

    return found[:12]


def _cache_get(cache: Collection | None, key: str) -> Optional[dict[str, Any]]:
    if cache is None:
        return None
    try:
        doc = cache.find_one({"_id": key})
        if not doc:
            return None
        expires = doc.get("expires_at")
        if isinstance(expires, datetime) and expires > datetime.now(timezone.utc):
            return doc.get("payload")
    except Exception:  # noqa: BLE001
        return None
    return None


def _cache_set(cache: Collection | None, key: str, payload: dict[str, Any], hours: int = 20) -> None:
    if cache is None:
        return
    try:
        from datetime import timedelta

        cache.update_one(
            {"_id": key},
            {
                "$set": {
                    "_id": key,
                    "payload": payload,
                    "expires_at": datetime.now(timezone.utc) + timedelta(hours=hours),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        pass


def _fetch_marketaux(entities: list[str], limit: int = 5) -> list[dict[str, Any]]:
    if not MARKETAUX_KEY:
        return []
    # Marketaux: filter by entity symbols / keywords
    symbols = [e for e in entities if e.isupper() and len(e) <= 5]
    search = " OR ".join(entities[:6])
    params: dict[str, Any] = {
        "api_token": MARKETAUX_KEY,
        "language": "en",
        "limit": max(limit, 10),
        "filter_entities": "true",
    }
    if symbols:
        params["symbols"] = ",".join(symbols[:8])
    else:
        params["search"] = search

    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get("https://api.marketaux.com/v1/news/all", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"Marketaux news fetch failed: {exc}")
        return []

    out: list[dict[str, Any]] = []
    for item in data.get("data") or []:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        ents = item.get("entities") or []
        sentiment = None
        if ents and isinstance(ents[0], dict):
            sentiment = ents[0].get("sentiment_score")
        out.append(
            {
                "title": title[:180],
                "source": item.get("source") or "Marketaux",
                "url": item.get("url"),
                "published_at": item.get("published_at"),
                "sentiment": sentiment,
                "provider": "marketaux",
            }
        )
        if len(out) >= limit:
            break
    return out


def _fetch_alphavantage(entities: list[str], limit: int = 5) -> list[dict[str, Any]]:
    if not ALPHAVANTAGE_KEY:
        return []
    # Prefer US tickers for Alpha Vantage NEWS_SENTIMENT
    tickers = [e for e in entities if e.upper() in _KNOWN_TICKERS or e.isupper()]
    if not tickers:
        tickers = ["VOO", "SPY"]
    tickers_param = ",".join(tickers[:5])
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(
                "https://www.alphavantage.co/query",
                params={
                    "function": "NEWS_SENTIMENT",
                    "tickers": tickers_param,
                    "limit": str(max(limit * 2, 10)),
                    "apikey": ALPHAVANTAGE_KEY,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"Alpha Vantage news fetch failed: {exc}")
        return []

    feed = data.get("feed") or []
    out: list[dict[str, Any]] = []
    for item in feed:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        # Relevance: prefer items mentioning our entities
        blob = f"{title} {item.get('summary') or ''}".lower()
        if not any(e.lower() in blob for e in entities):
            # still allow if ticker sentiment present
            ts = item.get("ticker_sentiment") or []
            if not any(t.get("ticker") in tickers for t in ts if isinstance(t, dict)):
                continue
        sentiment = None
        overall = item.get("overall_sentiment_score")
        if overall is not None:
            try:
                sentiment = float(overall)
            except (TypeError, ValueError):
                sentiment = None
        out.append(
            {
                "title": title[:180],
                "source": item.get("source") or "Alpha Vantage",
                "url": item.get("url"),
                "published_at": item.get("time_published"),
                "sentiment": sentiment,
                "provider": "alphavantage",
            }
        )
        if len(out) >= limit:
            break
    return out


def _score_relevance(headline: dict[str, Any], entities: list[str]) -> float:
    title = (headline.get("title") or "").lower()
    score = 0.0
    for e in entities:
        if e.lower() in title:
            score += 2.0
    sent = headline.get("sentiment")
    if isinstance(sent, (int, float)):
        score += abs(float(sent)) * 0.5
    return score


def fetch_relevant_news(
    holdings: list[dict[str, Any]],
    *,
    cache: Collection | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    """Return 3–5 headlines relevant to holdings, with daily cache."""
    entities = entities_from_holdings(holdings)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cache_key = f"news:{day}:{','.join(sorted(e.lower() for e in entities[:8]))}"

    cached = _cache_get(cache, cache_key)
    if cached:
        return {**cached, "cached": True}

    headlines: list[dict[str, Any]] = []
    if MARKETAUX_KEY:
        headlines.extend(_fetch_marketaux(entities, limit=limit + 3))
    if len(headlines) < limit and ALPHAVANTAGE_KEY:
        headlines.extend(_fetch_alphavantage(entities, limit=limit + 2))

    # Dedupe by title
    seen_titles: set[str] = set()
    unique: list[dict[str, Any]] = []
    for h in headlines:
        key = (h.get("title") or "").strip().lower()
        if not key or key in seen_titles:
            continue
        seen_titles.add(key)
        unique.append(h)

    unique.sort(key=lambda h: -_score_relevance(h, entities))
    selected = unique[: max(3, min(limit, 5))]

    payload = {
        "entities": entities,
        "headlines": selected,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "providers_used": sorted({h.get("provider") for h in selected if h.get("provider")}),
        "note": None
        if selected
        else (
            "No relevant headlines found"
            if entities
            else "No holdings-derived entities to search"
        ),
    }
    _cache_set(cache, cache_key, payload)
    return {**payload, "cached": False}
