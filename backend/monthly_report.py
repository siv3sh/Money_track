"""Monthly AI analysis report — structured stats + LLM narration + persistence."""

from __future__ import annotations

import calendar
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from analytics import NON_LIFESTYLE_CATEGORIES, build_analytics
from llm import LLMError, extract_json, get_provider
from news_service import fetch_relevant_news
from smart_insights import attach_smart_insights

REPORT_SYSTEM = (
    "You are a careful personal-finance analyst for one user in India (INR). "
    "Use ONLY the structured JSON context. Never invent numbers, tickers, or tax figures. "
    "If a comparison cannot be made for lack of history, say so plainly. "
    "Always include at least one genuinely positive observation in going_well. "
    "Suggestions must reference exact ₹ amounts from the context. "
    "Respond with JSON only."
)


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    last = calendar.monthrange(year, month)[1]
    end = datetime(year, month, last, 23, 59, 59, tzinfo=timezone.utc)
    return start, end


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    m = month + delta
    y = year
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return y, m


def _ym(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _overview_slice(analytics: dict[str, Any]) -> dict[str, Any]:
    o = analytics.get("overview") or {}
    credit = float(o.get("total_credit") or 0)
    lifestyle = float(o.get("lifestyle_spend") or 0)
    invested = float(o.get("investments_debit") or o.get("total_invested") or 0)
    savings_rate = round((credit - lifestyle) / credit * 100, 1) if credit else None
    invest_ratio = float(o.get("investment_to_income") or 0)
    return {
        "total_credit": round(credit, 2),
        "total_debit": round(float(o.get("total_debit") or 0), 2),
        "lifestyle_spend": round(lifestyle, 2),
        "credit_card_spend": round(float(o.get("credit_card_spend") or 0), 2),
        "bank_upi_spend": round(float(o.get("bank_upi_spend") or 0), 2),
        "investments_debit": round(float(o.get("investments_debit") or 0), 2),
        "savings_rate_pct": savings_rate,
        "invest_to_income_pct": invest_ratio,
        "net_worth_estimate": round(float(o.get("net_worth_estimate") or 0), 2),
        "salary_total": round(float(o.get("salary_total") or 0), 2),
        "categories": [
            {
                "name": r["name"],
                "debit": round(float(r.get("debit") or 0), 2),
                "count": int(r.get("count") or 0),
            }
            for r in (analytics.get("by_category_lifestyle") or analytics.get("by_category") or [])
            if r.get("name") not in NON_LIFESTYLE_CATEGORIES
            and float(r.get("debit") or 0) > 0
        ][:12],
    }


def _category_deltas(
    current: list[dict[str, Any]],
    previous: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    prev_map = {r["name"]: float(r.get("debit") or 0) for r in previous}
    deltas: list[dict[str, Any]] = []
    for row in current:
        name = row["name"]
        cur = float(row.get("debit") or 0)
        prev = prev_map.get(name, 0.0)
        abs_change = round(cur - prev, 2)
        pct = round((cur - prev) / prev * 100, 1) if prev else (100.0 if cur else 0.0)
        deltas.append(
            {
                "name": name,
                "current": cur,
                "previous": prev,
                "change_inr": abs_change,
                "change_pct": pct,
            }
        )
    deltas.sort(key=lambda d: -abs(d["change_inr"]))
    return deltas[:8]


def _trailing_avg(slices: list[dict[str, Any]], key: str) -> Optional[float]:
    vals = [float(s.get(key) or 0) for s in slices if s is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


def _suggestion_inputs(current: dict[str, Any], deltas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pre-compute concrete ₹ suggestion seeds from category averages."""
    seeds: list[dict[str, Any]] = []
    for d in deltas[:5]:
        if d["change_inr"] <= 0:
            continue
        half = round(d["current"] / 2, 0)
        if half < 200:
            continue
        seeds.append(
            {
                "category": d["name"],
                "current_month_spend": d["current"],
                "prior_month_spend": d["previous"],
                "halving_would_free_inr": half,
                "note": f"Halving {d['name']} this month's level frees ~₹{half:,.0f}",
            }
        )
    # Weekend dining heuristic if Food present
    for cat in current.get("categories") or []:
        if "food" in cat["name"].lower() or "dining" in cat["name"].lower():
            weekend_half = round(float(cat["debit"]) * 0.35 / 2, 0)
            if weekend_half >= 200:
                seeds.append(
                    {
                        "category": cat["name"],
                        "current_month_spend": cat["debit"],
                        "halving_would_free_inr": weekend_half,
                        "note": (
                            f"Cutting weekend dining (~35% of {cat['name']}) by half "
                            f"frees ~₹{weekend_half:,.0f}/month"
                        ),
                    }
                )
            break
    return seeds[:5]


def _tax_flags(ytd: dict[str, Any], investments: dict[str, Any]) -> list[dict[str, Any]]:
    """India tax-relevant flags only when thresholds are genuinely approached."""
    flags: list[dict[str, Any]] = []
    invested_ytd = float(ytd.get("investments_debit") or 0)
    # Soft 80C proximity using YTD investment debits (user may include ELSS etc.)
    limit_80c = 150_000.0
    if invested_ytd >= limit_80c * 0.7:
        remaining = max(limit_80c - invested_ytd, 0)
        flags.append(
            {
                "type": "80C",
                "message": (
                    f"YTD investment debits are ₹{invested_ytd:,.0f}. "
                    f"Section 80C ceiling is ₹{limit_80c:,.0f}"
                    + (
                        f" — about ₹{remaining:,.0f} headroom left"
                        if remaining > 0
                        else " — ceiling reached (if these qualify)"
                    )
                    + ". Confirm which of these are eligible tax-saving instruments."
                ),
                "ytd_invested": invested_ytd,
                "limit": limit_80c,
            }
        )

    pnl = float((investments or {}).get("pnl") or 0)
    # LTCG exemption often discussed around ₹1.25L for equity (current regime) — flag near it
    ltcg_exempt = 125_000.0
    if pnl >= ltcg_exempt * 0.7:
        flags.append(
            {
                "type": "LTCG",
                "message": (
                    f"Marked portfolio P&L is ₹{pnl:,.0f}. "
                    f"Equity LTCG exemption is commonly ₹{ltcg_exempt:,.0f}/year — "
                    "review cost basis and holding period with a tax advisor before realizing gains."
                ),
                "portfolio_pnl": pnl,
                "threshold": ltcg_exempt,
            }
        )
    return flags


def build_report_stats(
    transactions: Collection,
    *,
    year: int,
    month: int,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    sip_overrides: Collection | None = None,
    settings: Collection | None = None,
    news_cache: Collection | None = None,
) -> dict[str, Any]:
    """Pre-compute all numbers for the monthly report (no LLM)."""
    start, end = _month_bounds(year, month)
    py, pm = _prev_month(year, month)
    prev_start, prev_end = _month_bounds(py, pm)
    trail_y, trail_m = _add_months(year, month, -5)
    trail_start, _ = _month_bounds(trail_y, trail_m)
    ytd_start = datetime(year, 1, 1, tzinfo=timezone.utc)

    def load(s: datetime, e: datetime, *, with_smart: bool = False) -> dict[str, Any]:
        raw = build_analytics(
            transactions,
            date_from=s,
            date_to=e,
            portfolio=portfolio,
            networth_snapshots=networth_snapshots,
            liabilities=liabilities,
            budgets=budgets,
        )
        if with_smart:
            return attach_smart_insights(
                raw, transactions, sip_overrides=sip_overrides, settings=settings
            )
        return raw

    # Current month (with SIP/drift), prior month, YTD, trailing window
    current_a = load(start, end, with_smart=True)
    previous_a = load(prev_start, prev_end)
    ytd_a = load(ytd_start, end)
    trail_a = load(trail_start, end)

    current = _overview_slice(current_a)
    previous = _overview_slice(previous_a)
    ytd = _overview_slice(ytd_a)

    # Trailing 6-month averages from monthly cashflow rows in the window
    month_keys = {_ym(*_add_months(year, month, -i)) for i in range(0, 6)}
    monthly_rows = [
        r for r in (trail_a.get("monthly") or []) if r.get("month") in month_keys
    ]
    trail_slices: list[dict[str, Any]] = []
    for r in monthly_rows:
        credit = float(r.get("credit") or 0)
        debit = float(r.get("debit") or 0)
        # Approximate lifestyle as debit (category split unavailable per month cheaply)
        trail_slices.append(
            {
                "total_credit": credit,
                "total_debit": debit,
                "lifestyle_spend": debit,
                "savings_rate_pct": round((credit - debit) / credit * 100, 1) if credit else 0.0,
                "invest_to_income_pct": 0.0,
            }
        )
    # Prefer current+previous accurate lifestyle for invest ratio average from slices we have
    accurate = [current, previous]
    trail_avg = {
        "total_credit": _trailing_avg(trail_slices or accurate, "total_credit"),
        "total_debit": _trailing_avg(trail_slices or accurate, "total_debit"),
        "lifestyle_spend": _trailing_avg(
            [current, previous] if len(monthly_rows) < 2 else trail_slices,
            "lifestyle_spend",
        ),
        "savings_rate_pct": _trailing_avg(
            trail_slices
            or [
                {"savings_rate_pct": current.get("savings_rate_pct") or 0},
                {"savings_rate_pct": previous.get("savings_rate_pct") or 0},
            ],
            "savings_rate_pct",
        ),
        "invest_to_income_pct": _trailing_avg(
            [
                {"invest_to_income_pct": current.get("invest_to_income_pct") or 0},
                {"invest_to_income_pct": previous.get("invest_to_income_pct") or 0},
            ],
            "invest_to_income_pct",
        ),
        "months_in_average": len(trail_slices) or len(accurate),
        "note": "Trailing averages use monthly cashflow; lifestyle approximated when category history is thin",
    }

    deltas = _category_deltas(current.get("categories") or [], previous.get("categories") or [])
    smart = current_a.get("smart") or {}
    sip = smart.get("sip") or {}
    drift = smart.get("drift") or {}
    holdings = (current_a.get("investments") or {}).get("holdings") or []

    news = fetch_relevant_news(holdings, cache=news_cache, limit=5)
    tax = _tax_flags(ytd, current_a.get("investments") or {})

    history_ok = float(previous.get("total_debit") or 0) > 0 or float(previous.get("total_credit") or 0) > 0

    return {
        "month": _ym(year, month),
        "year": year,
        "month_num": month,
        "label": datetime(year, month, 1).strftime("%B %Y"),
        "history_ok": history_ok,
        "current": current,
        "previous": previous,
        "previous_month": _ym(py, pm),
        "trailing_6m_avg": trail_avg,
        "ytd": ytd,
        "category_changes": deltas,
        "suggestion_seeds": _suggestion_inputs(current, deltas),
        "sip": {
            "flagged": sip.get("flagged"),
            "sips": [
                {
                    "name": s.get("name"),
                    "status": s.get("status"),
                    "message": s.get("message"),
                    "typical_amount": s.get("typical_amount"),
                }
                for s in (sip.get("sips") or [])[:10]
            ],
        },
        "drift": {
            "reference_source": drift.get("reference_source"),
            "threshold_pp": drift.get("threshold_pp"),
            "drifts": drift.get("drifts") or [],
        },
        "news": {
            "entities": news.get("entities") or [],
            "headlines": news.get("headlines") or [],
            "note": news.get("note"),
        },
        "tax_flags": tax,
        "investments": {
            "total_invested": (current_a.get("investments") or {}).get("total_invested"),
            "total_current": (current_a.get("investments") or {}).get("total_current"),
            "pnl": (current_a.get("investments") or {}).get("pnl"),
            "holdings": [
                {"name": h.get("name"), "asset_class": h.get("asset_class")}
                for h in holdings[:15]
            ],
        },
        "headline_metric": {
            "savings_rate_pct": current.get("savings_rate_pct"),
            "net_worth_estimate": current.get("net_worth_estimate"),
            "lifestyle_spend": current.get("lifestyle_spend"),
            "vs_prior_lifestyle_pct": (
                round(
                    (current["lifestyle_spend"] - previous["lifestyle_spend"])
                    / previous["lifestyle_spend"]
                    * 100,
                    1,
                )
                if previous.get("lifestyle_spend")
                else None
            ),
        },
    }


def _narrate_report(stats: dict[str, Any], *, provider_name: str | None = None) -> dict[str, Any]:
    provider = get_provider(provider_name)
    # Slim payload for the model
    ctx = {
        "month": stats["label"],
        "history_ok": stats["history_ok"],
        "current": stats["current"],
        "previous": stats["previous"],
        "trailing_6m_avg": stats["trailing_6m_avg"],
        "ytd": stats["ytd"],
        "category_changes": stats["category_changes"],
        "suggestion_seeds": stats["suggestion_seeds"],
        "sip": stats["sip"],
        "drift": stats["drift"],
        "news_headlines": stats["news"]["headlines"],
        "news_note": stats["news"].get("note"),
        "tax_flags": stats["tax_flags"],
        "holdings": stats["investments"]["holdings"],
    }
    user = (
        "Generate a monthly finance report as JSON with keys:\n"
        "{\n"
        '  "summary": "3-4 sentences",\n'
        '  "going_well": ["...", "..."],\n'
        '  "suggestions": [{"text": "...", "inr_impact": number|null}],\n'
        '  "market_context": "1-2 sentences or empty string if no relevant news",\n'
        '  "tax_notes": ["..."] or [],\n'
        '  "ytd_snapshot": "2-3 sentences on YTD savings rate and invested"\n'
        "}\n"
        "Rules: use only numbers from context; include ≥1 positive in going_well; "
        "suggestions must use suggestion_seeds ₹ amounts; "
        "leave market_context empty if headlines list is empty; "
        "only mention tax_flags that are present.\n"
        f"Context:\n{_compact(ctx)}"
    )
    raw = provider.complete(REPORT_SYSTEM, user, temperature=0.25)
    try:
        parsed = extract_json(raw)
        if not isinstance(parsed, dict):
            parsed = {"summary": str(raw), "going_well": [], "suggestions": []}
    except LLMError:
        parsed = {
            "summary": raw,
            "going_well": [],
            "suggestions": [],
            "market_context": "",
            "tax_notes": [],
            "ytd_snapshot": "",
        }

    market = str(parsed.get("market_context") or "").strip()
    if not (stats.get("news") or {}).get("headlines"):
        market = ""

    suggestions_out = []
    for s in parsed.get("suggestions") or []:
        if isinstance(s, dict):
            suggestions_out.append(
                {
                    "text": str(s.get("text") or "")[:400],
                    "inr_impact": s.get("inr_impact"),
                }
            )
        elif isinstance(s, str):
            suggestions_out.append({"text": s[:400], "inr_impact": None})

    return {
        "summary": str(parsed.get("summary") or "")[:1200],
        "going_well": [str(x)[:300] for x in (parsed.get("going_well") or [])[:5]],
        "suggestions": suggestions_out[:6],
        "market_context": market[:600],
        "tax_notes": [str(x)[:400] for x in (parsed.get("tax_notes") or [])[:4]],
        "ytd_snapshot": str(parsed.get("ytd_snapshot") or "")[:800],
        "provider": provider.name,
        "raw": raw[:4000],
    }


def _compact(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))


def generate_monthly_report(
    transactions: Collection,
    reports: Collection,
    *,
    year: int | None = None,
    month: int | None = None,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    sip_overrides: Collection | None = None,
    settings: Collection | None = None,
    news_cache: Collection | None = None,
    provider_name: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Build stats, narrate with LLM, upsert into reports collection."""
    now = datetime.now(timezone.utc)
    if year is None or month is None:
        # Default: prior calendar month (for 1st-of-month job)
        py, pm = _prev_month(now.year, now.month)
        year, month = py, pm

    month_key = _ym(year, month)
    existing = reports.find_one({"month": month_key})
    if existing and not force:
        return _serialize_report(existing)

    stats = build_report_stats(
        transactions,
        year=year,
        month=month,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities,
        budgets=budgets,
        sip_overrides=sip_overrides,
        settings=settings,
        news_cache=news_cache,
    )
    narrative = _narrate_report(stats, provider_name=provider_name)

    doc = {
        "month": month_key,
        "year": year,
        "month_num": month,
        "label": stats["label"],
        "stats": stats,
        "narrative": narrative,
        "generated_at": now,
        "updated_at": now,
        "emailed_at": None,
    }
    reports.update_one({"month": month_key}, {"$set": doc}, upsert=True)
    saved = reports.find_one({"month": month_key})
    return _serialize_report(saved or doc)


def _serialize_report(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    if "_id" in doc:
        out["id"] = str(doc["_id"])
    for key in ("generated_at", "updated_at", "emailed_at"):
        val = out.get(key)
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    return out


def list_reports(reports: Collection, *, limit: int = 24) -> list[dict[str, Any]]:
    rows = list(reports.find().sort("month", -1).limit(limit))
    return [
        {
            "id": str(r["_id"]),
            "month": r.get("month"),
            "label": r.get("label"),
            "generated_at": r["generated_at"].isoformat()
            if isinstance(r.get("generated_at"), datetime)
            else r.get("generated_at"),
            "emailed_at": r["emailed_at"].isoformat()
            if isinstance(r.get("emailed_at"), datetime)
            else r.get("emailed_at"),
            "headline": (r.get("stats") or {}).get("headline_metric"),
            "summary_preview": ((r.get("narrative") or {}).get("summary") or "")[:160],
        }
        for r in rows
    ]


def get_report(reports: Collection, month: str) -> dict[str, Any] | None:
    doc = reports.find_one({"month": month})
    return _serialize_report(doc) if doc else None
