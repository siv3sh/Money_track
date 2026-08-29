"""Monthly AI analysis report — structured stats + LLM narration + persistence."""

from __future__ import annotations

import calendar
import re
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from analytics import NON_LIFESTYLE_CATEGORIES, build_analytics
from learned_facts import planned_spend_keys
from llm import LLMError, extract_json, get_provider
from merchant_label import clean_merchant_label
from news_service import fetch_relevant_news
from smart_insights import attach_smart_insights

REPORT_SYSTEM = (
    "Task: write a monthly personal-finance report for one person in India (INR). "
    "Respond with JSON only. "
    "Always include at least one genuinely positive observation in going_well. "
    "Suggestions must reference exact ₹ amounts from the context. "
    "Write directly as 'you'/'your'. Never say 'the user'."
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


def _top_lifestyle_merchants(
    transactions: Collection,
    start: datetime,
    end: datetime,
    *,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Largest lifestyle debit merchants for the month (excludes transfers/investments/income)."""
    from collections import defaultdict

    from parser import credit_card_noise_mongo_clause

    totals: dict[str, dict[str, float]] = defaultdict(lambda: {"amount": 0.0, "count": 0.0})
    match = {
        "type": "debit",
        "card_type": {"$ne": "wallet"},
        "received_at": {"$gte": start, "$lte": end},
        "category": {"$nin": list(NON_LIFESTYLE_CATEGORIES)},
        "cc_payoff": {"$ne": True},
        **credit_card_noise_mongo_clause(),
    }
    for doc in transactions.find(match, {"merchant": 1, "raw_text": 1, "amount": 1, "category": 1}):
        label = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text"))
        if not label or "(Family)" in label:
            continue
        lower = label.lower()
        if lower.startswith("siv3sh") or "siv3sh@" in lower or lower in {"self", "self transfer"}:
            continue
        totals[label]["amount"] += float(doc.get("amount") or 0)
        totals[label]["count"] += 1

    ranked = sorted(totals.items(), key=lambda kv: -kv[1]["amount"])
    total = sum(v["amount"] for _, v in ranked) or 1.0
    return [
        {
            "name": name,
            "amount": round(vals["amount"], 2),
            "count": int(vals["count"]),
            "share": round(vals["amount"] / total * 100, 1),
        }
        for name, vals in ranked[:limit]
        if vals["amount"] > 0
    ]


def _category_deltas(
    current: list[dict[str, Any]],
    previous: list[dict[str, Any]],
    *,
    planned_keys: set[str] | None = None,
    current_month: str | None = None,
) -> list[dict[str, Any]]:
    prev_map = {r["name"]: float(r.get("debit") or 0) for r in previous}
    planned = planned_keys or set()
    deltas: list[dict[str, Any]] = []
    for row in current:
        name = row["name"]
        # Skip categories the user marked as planned one-offs for this month
        if current_month and f"{current_month}|{name}" in planned:
            continue
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


LEAKAGE_MIN_INR = 1500.0
LEAKAGE_MIN_PCT = 25.0
BIG_SPEND_MIN_INR = 3000.0


def _build_leakages(
    deltas: list[dict[str, Any]],
    creep_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Categories/subscriptions that leaked vs prior month — deterministic."""
    out: list[dict[str, Any]] = []
    for d in deltas:
        change = float(d.get("change_inr") or 0)
        pct = float(d.get("change_pct") or 0)
        prev = float(d.get("previous") or 0)
        if change < LEAKAGE_MIN_INR:
            continue
        if prev > 0 and pct < LEAKAGE_MIN_PCT:
            continue
        name = str(d.get("name") or "Category")
        out.append(
            {
                "kind": "category_spike",
                "name": name,
                "amount": round(float(d.get("current") or 0), 2),
                "change_inr": round(change, 2),
                "change_pct": round(pct, 1),
                "message": (
                    f"{name} up ₹{change:,.0f}"
                    + (f" ({pct:+.0f}% vs prior)" if prev > 0 else " (new vs prior)")
                ),
            }
        )
    for item in creep_items:
        st = str(item.get("status") or "")
        if st not in {"price_up", "missing"}:
            continue
        name = str(item.get("name") or item.get("merchant") or "Subscription")
        try:
            amt = float(
                item.get("amount")
                or item.get("last_amount")
                or item.get("latest_amount")
                or item.get("typical_amount")
                or 0
            )
        except (TypeError, ValueError):
            amt = 0.0
        detail = "price increased" if st == "price_up" else "charge missing / irregular"
        msg = str(item.get("message") or "").strip()
        out.append(
            {
                "kind": "subscription",
                "name": name,
                "amount": round(amt, 2) if amt else None,
                "change_inr": None,
                "change_pct": None,
                "message": msg
                or (
                    f"Subscription '{name}' — {detail}"
                    + (f" (₹{amt:,.0f})" if amt else "")
                ),
            }
        )
    return out[:10]


def _build_big_spends(merchants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Largest lifestyle merchants worth a month-end look."""
    out: list[dict[str, Any]] = []
    for m in merchants:
        try:
            amt = float(m.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        if amt < BIG_SPEND_MIN_INR:
            continue
        name = str(m.get("name") or "Merchant")
        count = int(m.get("count") or 0)
        share = m.get("share")
        out.append(
            {
                "name": name,
                "amount": round(amt, 2),
                "count": count,
                "share": share,
                "message": (
                    f"{name} — ₹{amt:,.0f}"
                    + (f" across {count} pays" if count > 1 else "")
                    + (
                        f" ({share:.0f}% of lifestyle merchants)"
                        if share is not None
                        else ""
                    )
                ),
            }
        )
    if not out and merchants:
        for m in merchants[:5]:
            try:
                amt = float(m.get("amount") or 0)
            except (TypeError, ValueError):
                continue
            if amt <= 0:
                continue
            out.append(
                {
                    "name": str(m.get("name") or "Merchant"),
                    "amount": round(amt, 2),
                    "count": int(m.get("count") or 0),
                    "share": m.get("share"),
                    "message": f"{m.get('name')} — ₹{amt:,.0f}",
                }
            )
    return out[:8]


def _build_month_end_checklist(
    *,
    current: dict[str, Any],
    sip: dict[str, Any],
    creep_items: list[dict[str, Any]],
    liability_rows: list[dict[str, Any]],
    goal_docs: list[dict[str, Any]] | None = None,
    year: int,
    month: int,
) -> list[dict[str, Any]]:
    """Fixed month-end 'what to look at' list — status: action | watch | ok."""
    items: list[dict[str, Any]] = []

    sip_problems = [
        s
        for s in (sip.get("sips") or [])
        if str(s.get("status") or "") in {"missing", "stopped"}
    ]
    if sip_problems:
        names = ", ".join(str(s.get("name") or "SIP") for s in sip_problems[:4])
        items.append(
            {
                "id": "sips",
                "status": "action",
                "title": "SIPs need attention",
                "detail": names,
            }
        )
    else:
        items.append(
            {
                "id": "sips",
                "status": "ok",
                "title": "SIPs look on track",
                "detail": "No missing/stopped SIPs flagged this month",
            }
        )

    cc_rows = [
        r
        for r in liability_rows
        if str(r.get("type") or "") == "credit_card"
        and float(r.get("outstanding") or 0) > 0
    ]
    if cc_rows:
        total = sum(float(r.get("outstanding") or 0) for r in cc_rows)
        due_bits = []
        for r in cc_rows[:3]:
            label = r.get("name") or (
                f"{r.get('bank') or 'Card'} ••{r.get('last4') or ''}"
            )
            due = r.get("due_date")
            due_bits.append(
                f"{label} ₹{float(r.get('outstanding') or 0):,.0f}"
                + (f" due {due}" if due else "")
            )
        items.append(
            {
                "id": "credit_cards",
                "status": "action" if total >= 10000 else "watch",
                "title": f"Credit card outstanding ₹{total:,.0f}",
                "detail": "; ".join(due_bits)
                if due_bits
                else "Pay before due to avoid interest",
            }
        )
    else:
        items.append(
            {
                "id": "credit_cards",
                "status": "ok",
                "title": "No open credit-card balance flagged",
                "detail": "Or cards not synced yet",
            }
        )

    try:
        lts = float(current.get("lifestyle_to_salary") or 0)
    except (TypeError, ValueError):
        lts = 0.0
    if lts >= 85:
        items.append(
            {
                "id": "lifestyle_ratio",
                "status": "action",
                "title": f"Lifestyle is {lts:.0f}% of salary credits",
                "detail": "Little room left for buffer / goals — review discretionary",
            }
        )
    elif lts >= 70:
        items.append(
            {
                "id": "lifestyle_ratio",
                "status": "watch",
                "title": f"Lifestyle is {lts:.0f}% of salary credits",
                "detail": "Tight but workable — keep an eye on soft-spot categories",
            }
        )
    elif current.get("salary_total"):
        items.append(
            {
                "id": "lifestyle_ratio",
                "status": "ok",
                "title": f"Lifestyle at {lts:.0f}% of salary credits",
                "detail": "Healthy headroom vs income",
            }
        )

    bad_subs = [
        i for i in creep_items if str(i.get("status") or "") in {"price_up", "missing"}
    ]
    if bad_subs:
        items.append(
            {
                "id": "subscriptions",
                "status": "watch",
                "title": f"{len(bad_subs)} subscription alert(s)",
                "detail": ", ".join(
                    str(i.get("name") or i.get("merchant") or "?") for i in bad_subs[:4]
                ),
            }
        )
    else:
        items.append(
            {
                "id": "subscriptions",
                "status": "ok",
                "title": "No subscription creep alerts",
                "detail": "Recurring charges look stable vs recent history",
            }
        )

    ym = _ym(year, month)
    py, pm = _prev_month(year, month)
    prev = _ym(py, pm)
    quiet_goals: list[str] = []
    for g in goal_docs or []:
        if (g.get("status") or "active") != "active":
            continue
        months = list(g.get("contribution_months") or [])
        name = str(g.get("name") or "Goal")
        if ym not in months and prev not in months and float(g.get("saved_amount") or 0) > 0:
            quiet_goals.append(name)
    if quiet_goals:
        items.append(
            {
                "id": "goals",
                "status": "watch",
                "title": "Goal funding quiet",
                "detail": ", ".join(quiet_goals[:4]),
            }
        )

    return items


def _build_month_end_review(
    *,
    deltas: list[dict[str, Any]],
    merchants: list[dict[str, Any]],
    current: dict[str, Any],
    sip: dict[str, Any],
    creep: dict[str, Any],
    liability_rows: list[dict[str, Any]],
    goal_docs: list[dict[str, Any]] | None,
    year: int,
    month: int,
    suggestion_seeds: list[dict[str, Any]],
) -> dict[str, Any]:
    creep_items = list(creep.get("items") or [])
    leakages = _build_leakages(deltas, creep_items)
    big_spends = _build_big_spends(merchants)
    checklist = _build_month_end_checklist(
        current=current,
        sip=sip,
        creep_items=creep_items,
        liability_rows=liability_rows,
        goal_docs=goal_docs,
        year=year,
        month=month,
    )
    recommendations: list[dict[str, Any]] = []
    for seed in suggestion_seeds[:5]:
        text = seed.get("note") or (
            f"Cut {seed.get('category')} — freeing "
            f"~₹{float(seed.get('halving_would_free_inr') or 0):,.0f}"
        )
        recommendations.append(
            {
                "text": str(text),
                "inr_impact": seed.get("halving_would_free_inr"),
                "source": "seed",
            }
        )
    return {
        "leakages": leakages,
        "big_spends": big_spends,
        "checklist": checklist,
        "recommendations": recommendations,
    }


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
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
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
            learned_facts=learned_facts,
        )
        if with_smart:
            return attach_smart_insights(
                raw,
                transactions,
                sip_overrides=sip_overrides,
                settings=settings,
                learned_facts=learned_facts,
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
    current["top_merchants"] = _top_lifestyle_merchants(transactions, start, end)

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

    planned = planned_spend_keys(learned_facts) if learned_facts is not None else set()
    deltas = _category_deltas(
        current.get("categories") or [],
        previous.get("categories") or [],
        planned_keys=planned,
        current_month=_ym(year, month),
    )
    smart = current_a.get("smart") or {}
    sip = smart.get("sip") or {}
    drift = smart.get("drift") or {}
    creep = smart.get("subscription_creep") or {}
    holdings = (current_a.get("investments") or {}).get("holdings") or []
    seeds = _suggestion_inputs(current, deltas)

    liability_rows: list[dict[str, Any]] = []
    if liabilities is not None:
        try:
            liability_rows = list(liabilities.find().sort("outstanding", -1).limit(20))
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: liabilities for month-end review skipped: {exc}")

    goal_docs: list[dict[str, Any]] = []
    if goals_col is not None:
        try:
            goal_docs = list(goals_col.find({"status": "active"}).limit(20))
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: goals for month-end review skipped: {exc}")

    month_end_review = _build_month_end_review(
        deltas=deltas,
        merchants=current.get("top_merchants") or [],
        current=current,
        sip=sip,
        creep=creep,
        liability_rows=liability_rows,
        goal_docs=goal_docs,
        year=year,
        month=month,
        suggestion_seeds=seeds,
    )

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
        "suggestion_seeds": seeds,
        "month_end_review": month_end_review,
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
        "subscription_creep": {
            "items": [
                {
                    "name": i.get("name") or i.get("merchant"),
                    "merchant": i.get("merchant"),
                    "status": i.get("status"),
                    "amount": i.get("last_amount") or i.get("amount"),
                    "last_amount": i.get("last_amount"),
                    "message": i.get("message"),
                }
                for i in (creep.get("items") or [])[:10]
            ]
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


def _repair_llm_json(text: str) -> str:
    """Fix common LLM JSON mistakes before parsing."""
    s = text.strip()
    # Replace bogus inr_impact: suggestion_seeds[...] with a number if present
    def _seed_impact(m: re.Match[str]) -> str:
        blob = m.group(0)
        nums = re.findall(r"halving_would_free_inr[\"']?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)", blob)
        if nums:
            return f'"inr_impact": {nums[0]}'
        nums = re.findall(r"([0-9]+(?:\.[0-9]+)?)", blob)
        return f'"inr_impact": {nums[-1]}' if nums else '"inr_impact": null'

    s = re.sub(
        r'"inr_impact"\s*:\s*suggestion_seeds\[[^\]]*\]',
        _seed_impact,
        s,
        flags=re.I,
    )
    s = re.sub(
        r'"inr_impact"\s*:\s*suggestion_seeds\{[^}]*\}',
        _seed_impact,
        s,
        flags=re.I,
    )
    # Trailing commas before } or ]
    s = re.sub(r",\s*([}\]])", r"\1", s)
    # Balance braces/brackets if the model truncated the closing
    opens = s.count("{") - s.count("}")
    open_arr = s.count("[") - s.count("]")
    if opens > 0 or open_arr > 0:
        s = s + ("]" * max(0, open_arr)) + ("}" * max(0, opens))
    return s


def _parse_report_narrative(raw: str) -> dict[str, Any]:
    """Parse LLM report JSON with repair + field fallbacks."""
    candidates = [raw, _repair_llm_json(raw)]
    parsed: dict[str, Any] | None = None
    for cand in candidates:
        try:
            data = extract_json(cand)
            if isinstance(data, dict) and (
                data.get("summary") or data.get("going_well") or data.get("suggestions")
            ):
                # If model stuffed whole JSON into summary again, unwrap
                summary = data.get("summary")
                if isinstance(summary, str) and summary.strip().startswith("{") and '"going_well"' in summary:
                    try:
                        inner = extract_json(_repair_llm_json(summary))
                        if isinstance(inner, dict) and inner.get("summary"):
                            data = inner
                    except LLMError:
                        pass
                parsed = data
                break
        except LLMError:
            continue

    if parsed is None:
        def _unescape(val: str) -> str:
            return (
                val.replace("\\n", "\n")
                .replace('\\"', '"')
                .replace("\\/", "/")
            )

        summary_m = re.search(r'"summary"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
        ytd_m = re.search(r'"ytd_snapshot"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
        well = re.findall(r'"going_well"\s*:\s*\[(.*?)\]', raw, flags=re.S)
        going = []
        if well:
            going = re.findall(r'"((?:\\.|[^"\\])*)"', well[0])
        # Pull suggestion texts even when inr_impact is broken
        sug_texts = re.findall(
            r'\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"',
            raw,
        )
        sug_impacts = re.findall(
            r"halving_would_free_inr[\"']?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)",
            raw,
        )
        suggestions = []
        for i, t in enumerate(sug_texts):
            impact = None
            if i < len(sug_impacts):
                try:
                    impact = float(sug_impacts[i])
                except ValueError:
                    impact = None
            suggestions.append({"text": _unescape(t), "inr_impact": impact})

        parsed = {
            "summary": _unescape(summary_m.group(1)) if summary_m else raw[:800],
            "going_well": [_unescape(g) for g in going[:5]],
            "suggestions": suggestions,
            "market_context": "",
            "tax_notes": [],
            "ytd_snapshot": _unescape(ytd_m.group(1)) if ytd_m else "",
        }

    return parsed


def _narrate_report(
    stats: dict[str, Any],
    *,
    provider_name: str | None = None,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
) -> dict[str, Any]:
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
        "month_end_review": stats.get("month_end_review") or {},
    }
    # Build a mini analytics bundle for severity from report stats
    analytics_for_sev = {
        "overview": {
            "lifestyle_spend": (stats.get("current") or {}).get("lifestyle_spend"),
            "salary_total": (stats.get("current") or {}).get("salary_total"),
            "total_credit": (stats.get("current") or {}).get("total_credit"),
            "lifestyle_to_salary": (stats.get("current") or {}).get("lifestyle_to_salary"),
        },
        "mom": (stats.get("current") or {}).get("mom") or {},
        "smart": {
            "sip": stats.get("sip") or {},
            "drift": stats.get("drift") or {},
            "subscription_creep": {},
            "spend_forecast": {},
        },
    }
    try:
        from advisor_persona import build_persona_system_prompt, severity_from_analytics_bundle

        severity = severity_from_analytics_bundle(
            analytics_for_sev,
            settings=settings,
            learned_facts=learned_facts,
            goals_col=goals_col,
        )
        system = build_persona_system_prompt(
            REPORT_SYSTEM,
            settings=settings,
            learned_facts=learned_facts,
            severity=severity,
            extra_grounding=None,
        )
        try:
            from advisor_memory import memories_for_prompt

            # Optional: caller may pass memories via stats
            mem_col = stats.get("_memories_col")
            mem_lines = memories_for_prompt(mem_col, limit=10) if mem_col is not None else []
            if mem_lines:
                system = build_persona_system_prompt(
                    REPORT_SYSTEM,
                    settings=settings,
                    learned_facts=learned_facts,
                    severity=severity,
                    extra_grounding="Advisor memory:\n" + "\n".join(mem_lines),
                )
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: report persona fallback: {exc}")
        severity = {"level": "informational", "context_line": "tone: informational"}
        system = REPORT_SYSTEM

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
        "lean on month_end_review.leakages / big_spends / checklist for what to call out; "
        "do not invent merchants or leakages not in context; "
        "inr_impact must be a plain number (e.g. 1914) or null — never paste objects/code; "
        "leave market_context empty if headlines list is empty; "
        "only mention tax_flags that are present; "
        "write in a warm, direct second-person voice using 'you'/'your'; "
        "never say 'the user'.\n"
        f"Advisor severity (deterministic, match tone): {_compact(severity)}\n"
        f"Context:\n{_compact(ctx)}"
    )
    raw = provider.complete(system, user, temperature=0.25)
    parsed = _parse_report_narrative(raw)

    market = str(parsed.get("market_context") or "").strip()
    if not (stats.get("news") or {}).get("headlines"):
        market = ""

    suggestions_out = []
    for s in parsed.get("suggestions") or []:
        if isinstance(s, dict):
            impact = s.get("inr_impact")
            try:
                impact_n = float(impact) if impact is not None else None
            except (TypeError, ValueError):
                impact_n = None
            suggestions_out.append(
                {
                    "text": str(s.get("text") or "")[:400],
                    "inr_impact": impact_n,
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
        "advisor_severity": severity,
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
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    memories_col: Collection | None = None,
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
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    if memories_col is not None:
        stats["_memories_col"] = memories_col
    narrative = _narrate_report(
        stats,
        provider_name=provider_name,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    stats.pop("_memories_col", None)

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
