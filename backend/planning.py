"""Money Planning — budget buckets, goal funding, price lookup, opportunity cost."""

from __future__ import annotations

import calendar
import math
import re
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from analytics import build_analytics
from categorizer import CATEGORIES
from learned_facts import advisor_profile_from_facts
from llm import LLMError, extract_json, get_provider
from merchant_label import clean_merchant_label

BUCKETS = ("Needs", "Investments", "Discretionary", "Buffer")

DEFAULT_BUCKET_PCTS: dict[str, float] = {
    "Needs": 45.0,
    "Investments": 27.0,
    "Discretionary": 17.0,
    "Buffer": 7.0,
}

# Merchants we treat as work/tools — don't ask to cut these first
_PROTECTED_CUT_MERCHANTS = (
    "cursor",
    "indmoney",
    "indian clearing",
    "zerodha",
    "groww",
)

# Prefer cutting these discretionary patterns first when present
_CUT_PRIORITY_NEEDLES = (
    "oxygen",
    "myntra",
    "flipkart",
    "amazon",
    "lkst",
    "sonicbags",
    "zoiecraft",
    "redbus",
    "paramount",
    "spotify",
    "apple services",
)

# Wealth classification overlap: Investments=asset, Needs=neutral, Disc/Buffer=liability-framed
DEFAULT_CATEGORY_BUCKETS: dict[str, str] = {
    "Food & Dining": "Needs",
    "Groceries": "Needs",
    "Bills & Utilities": "Needs",
    "Health & Wellness": "Needs",
    "Education": "Needs",
    "Travel & Transport": "Needs",
    "Investments": "Investments",
    "Shopping": "Discretionary",
    "Entertainment": "Discretionary",
    "Subscriptions": "Discretionary",
    "Other": "Discretionary",
    "Transfers": "Buffer",
    "Income": "Buffer",  # ignored for spend; kept for map completeness
}

# EMI / credit finance charge approximation for opportunity-cost display
DEFAULT_EMI_ANNUAL_RATE = 0.18
DEFAULT_EMI_TENURE_MONTHS = 12

SETTINGS_ID = "planning"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    last = calendar.monthrange(year, month)[1]
    end = datetime(year, month, last, 23, 59, 59, tzinfo=timezone.utc)
    return start, end


def _current_month_bounds() -> tuple[datetime, datetime, int, int]:
    now = _now()
    start, end = _month_bounds(now.year, now.month)
    return start, end, now.year, now.month


def normalize_bucket_pcts(raw: dict[str, Any] | None) -> dict[str, float]:
    base = dict(DEFAULT_BUCKET_PCTS)
    if not raw:
        return base
    for k in BUCKETS:
        if k in raw:
            try:
                base[k] = float(raw[k])
            except (TypeError, ValueError):
                continue
    total = sum(base.values()) or 1.0
    # Soft-normalize if user drifts off 100
    if abs(total - 100.0) > 0.5:
        base = {k: round(v / total * 100, 1) for k, v in base.items()}
    return base


def normalize_category_map(raw: dict[str, Any] | None) -> dict[str, str]:
    out = dict(DEFAULT_CATEGORY_BUCKETS)
    if not raw:
        return out
    for cat, bucket in raw.items():
        cat_s = str(cat).strip()
        bucket_s = str(bucket).strip()
        if cat_s in CATEGORIES and bucket_s in BUCKETS:
            out[cat_s] = bucket_s
    return out


def get_planning_settings(settings: Collection) -> dict[str, Any]:
    doc = settings.find_one({"_id": SETTINGS_ID}) or {}
    pcts = normalize_bucket_pcts(doc.get("bucket_pcts"))
    cat_map = normalize_category_map(doc.get("category_buckets"))
    return {
        "bucket_pcts": pcts,
        "category_buckets": cat_map,
        "emi_annual_rate": float(doc.get("emi_annual_rate") or DEFAULT_EMI_ANNUAL_RATE),
        "emi_tenure_months": int(doc.get("emi_tenure_months") or DEFAULT_EMI_TENURE_MONTHS),
        "liquid_buffer_override": (
            float(doc["liquid_buffer_override"])
            if doc.get("liquid_buffer_override") is not None
            else None
        ),
        "personalization_note": doc.get("personalization_note"),
        "personal_plan_locked": bool(doc.get("personal_plan_locked")),
    }


def save_planning_settings(
    settings: Collection,
    *,
    bucket_pcts: dict[str, Any] | None = None,
    category_buckets: dict[str, Any] | None = None,
    emi_annual_rate: float | None = None,
    emi_tenure_months: int | None = None,
    liquid_buffer_override: float | None = None,
) -> dict[str, Any]:
    current = get_planning_settings(settings)
    patch: dict[str, Any] = {"updated_at": _now()}
    if bucket_pcts is not None:
        patch["bucket_pcts"] = normalize_bucket_pcts(bucket_pcts)
    else:
        patch["bucket_pcts"] = current["bucket_pcts"]
    if category_buckets is not None:
        patch["category_buckets"] = normalize_category_map(category_buckets)
    else:
        patch["category_buckets"] = current["category_buckets"]
    if emi_annual_rate is not None:
        patch["emi_annual_rate"] = max(0.0, float(emi_annual_rate))
    else:
        patch["emi_annual_rate"] = current["emi_annual_rate"]
    if emi_tenure_months is not None:
        patch["emi_tenure_months"] = max(1, int(emi_tenure_months))
    else:
        patch["emi_tenure_months"] = current["emi_tenure_months"]
    if liquid_buffer_override is not None:
        patch["liquid_buffer_override"] = max(0.0, float(liquid_buffer_override))
    elif current.get("liquid_buffer_override") is not None:
        patch["liquid_buffer_override"] = current["liquid_buffer_override"]

    settings.update_one(
        {"_id": SETTINGS_ID},
        {"$set": patch, "$setOnInsert": {"_id": SETTINGS_ID}},
        upsert=True,
    )
    return get_planning_settings(settings)


def wealth_class_for_bucket(bucket: str) -> str:
    if bucket == "Investments":
        return "asset"
    if bucket == "Needs":
        return "neutral"
    if bucket in {"Discretionary", "Buffer"}:
        return "liability"
    return "neutral"


def opportunity_cost_emi(
    amount: float,
    *,
    annual_rate: float = DEFAULT_EMI_ANNUAL_RATE,
    tenure_months: int = DEFAULT_EMI_TENURE_MONTHS,
) -> dict[str, Any]:
    """Interest you'd roughly pay financing `amount` on EMI/credit."""
    principal = max(0.0, float(amount or 0))
    n = max(1, int(tenure_months))
    r = max(0.0, float(annual_rate)) / 12.0
    if principal <= 0:
        return {
            "principal": 0.0,
            "interest_approx": 0.0,
            "total_payable": 0.0,
            "monthly_emi": 0.0,
            "annual_rate": annual_rate,
            "tenure_months": n,
        }
    if r <= 0:
        emi = principal / n
        return {
            "principal": round(principal, 2),
            "interest_approx": 0.0,
            "total_payable": round(principal, 2),
            "monthly_emi": round(emi, 2),
            "annual_rate": annual_rate,
            "tenure_months": n,
        }
    factor = (1 + r) ** n
    emi = principal * r * factor / (factor - 1)
    total = emi * n
    interest = total - principal
    return {
        "principal": round(principal, 2),
        "interest_approx": round(interest, 2),
        "total_payable": round(total, 2),
        "monthly_emi": round(emi, 2),
        "annual_rate": annual_rate,
        "tenure_months": n,
    }


def _income_base(analytics: dict[str, Any]) -> float:
    o = analytics.get("overview") or {}
    profile = analytics.get("income_profile") or {}
    for key in (
        "expected_net_monthly",
        "salary_total",
        "total_credit",
    ):
        try:
            v = float(o.get(key) or profile.get(key) or 0)
        except (TypeError, ValueError):
            v = 0.0
        if v > 0:
            return round(v, 2)
    return 0.0


def _category_debits(analytics: dict[str, Any]) -> dict[str, float]:
    rows = analytics.get("by_category") or []
    out: dict[str, float] = {}
    for r in rows:
        name = str(r.get("name") or "")
        if not name:
            continue
        out[name] = round(float(r.get("debit") or 0), 2)
    # Prefer investments_debit if Investments category thin
    o = analytics.get("overview") or {}
    inv = float(o.get("investments_debit") or 0)
    if inv > out.get("Investments", 0):
        out["Investments"] = round(inv, 2)
    return out


def build_budget_framework(
    analytics: dict[str, Any],
    settings: dict[str, Any],
) -> dict[str, Any]:
    income = _income_base(analytics)
    pcts = settings["bucket_pcts"]
    cat_map = settings["category_buckets"]
    debits = _category_debits(analytics)

    actual: dict[str, float] = {b: 0.0 for b in BUCKETS}
    breakdown: dict[str, list[dict[str, Any]]] = {b: [] for b in BUCKETS}
    for cat, amt in debits.items():
        if amt <= 0:
            continue
        if cat in {"Income", "Transfers"}:
            # Transfers/self-moves aren't lifestyle buffer consumption for goal surplus
            continue
        bucket = cat_map.get(cat, "Discretionary")
        if bucket not in BUCKETS:
            bucket = "Discretionary"
        actual[bucket] = round(actual[bucket] + amt, 2)
        breakdown[bucket].append({"category": cat, "amount": amt})

    template: dict[str, float] = {
        b: round(income * pcts[b] / 100.0, 2) for b in BUCKETS
    }

    comparison = []
    for b in BUCKETS:
        t = template[b]
        a = actual[b]
        comparison.append(
            {
                "bucket": b,
                "wealth_class": wealth_class_for_bucket(b),
                "template_pct": pcts[b],
                "template_inr": t,
                "actual_inr": a,
                "delta_inr": round(a - t, 2),
                "actual_pct_of_income": round(a / income * 100, 1) if income else 0.0,
                "categories": sorted(breakdown[b], key=lambda x: -x["amount"]),
            }
        )

    # Surplus for goals: only Discretionary + Buffer template minus committed spend
    disc_buf_template = template["Discretionary"] + template["Buffer"]
    disc_buf_actual = actual["Discretionary"] + actual["Buffer"]
    available_surplus = round(max(0.0, disc_buf_template - disc_buf_actual), 2)
    disc_overshoot = round(max(0.0, actual["Discretionary"] - template["Discretionary"]), 2)
    buffer_leftover = round(max(0.0, template["Buffer"] - actual["Buffer"]), 2)
    # If back on plan (disc at template), surplus equals unused buffer (+ unused disc)
    surplus_if_on_plan = round(
        max(0.0, disc_buf_template - (min(actual["Discretionary"], template["Discretionary"]) + actual["Buffer"])),
        2,
    )

    return {
        "income_base": income,
        "income_source": (
            "expected_net_monthly"
            if (analytics.get("overview") or {}).get("expected_net_monthly")
            else "credits"
        ),
        "bucket_pcts": pcts,
        "category_buckets": cat_map,
        "template": template,
        "actual": actual,
        "comparison": comparison,
        "available_surplus": available_surplus,
        "disc_overshoot": disc_overshoot,
        "buffer_leftover": buffer_leftover,
        "surplus_if_on_plan": surplus_if_on_plan,
        "surplus_note": (
            "Surplus = (Discretionary + Buffer template) − spend in those buckets. "
            "Investments allocation is never reduced to fund goals."
        ),
    }


# Proven wealth habits — practical methods (not celebrity worship)
WEALTH_METHODS: list[dict[str, str]] = [
    {
        "id": "pay_yourself_first",
        "name": "Pay Yourself First",
        "origin": "Classic wealth habit (Clason / every high-saver household)",
        "rule": "Invest on salary day before lifestyle spending — treat Investments like rent.",
        "check": "invest_rate",
    },
    {
        "id": "conscious_spending",
        "name": "Conscious Spending",
        "origin": "Used by high earners who still enjoy life (Ramit-style)",
        "rule": "Fix Needs + Investments first, then spend guilt-free inside Discretionary — never raid Investments for wants.",
        "check": "discretionary_cap",
    },
    {
        "id": "no_lifestyle_inflation",
        "name": "Cap Lifestyle Inflation",
        "origin": "Common among people who actually grow net worth after raises",
        "rule": "When income rises, raise investing first; keep lifestyle growth slower than income growth.",
        "check": "lifestyle_vs_income",
    },
    {
        "id": "never_finance_wants",
        "name": "Never Finance Wants",
        "origin": "Wealthy household default — cash/save for toys, credit only for assets if ever",
        "rule": "Save for goals from Discretionary/Buffer. EMI on lifestyle purchases is a silent wealth killer.",
        "check": "goals_cash",
    },
    {
        "id": "automate_on_payday",
        "name": "Automate on Payday",
        "origin": "How disciplined investors remove willpower from the equation",
        "rule": "On salary credit: auto-split → Investments SIP, Buffer top-up, Goal pot — leftover is play money.",
        "check": "auto_allocate",
    },
]


def calibrate_bucket_pcts_for_spend(framework: dict[str, Any]) -> dict[str, float]:
    """
    Personal targets from this month's shape:
    - Needs stays generous (you under-spend Needs)
    - Investments: reachable step toward pay-yourself-first
    - Discretionary: tightened vs your Shopping/Subs spike
    - Buffer: capped — fuels goals without swallowing the plan
    """
    income = float(framework.get("income_base") or 0) or 1.0
    actual = framework.get("actual") or {}
    needs_pct = float(actual.get("Needs") or 0) / income * 100
    disc_pct = float(actual.get("Discretionary") or 0) / income * 100
    inv_pct = float(actual.get("Investments") or 0) / income * 100

    needs = round(min(40.0, max(32.0, needs_pct + 14.0)), 1)
    inv = round(min(27.0, max(22.0, inv_pct + 4.0)), 1)
    disc = round(min(15.0, max(12.0, disc_pct * 0.55)), 1)
    buffer = round(100.0 - needs - inv - disc, 1)
    if buffer > 18.0:
        excess = buffer - 18.0
        buffer = 18.0
        # Prefer parking excess in Needs (you run lean) then Investments
        add_needs = min(42.0 - needs, round(excess * 0.6, 1))
        needs = round(needs + add_needs, 1)
        inv = round(min(27.0, inv + (excess - add_needs)), 1)
        buffer = round(100.0 - needs - inv - disc, 1)
    if buffer < 8.0:
        # Steal a little from Needs if buffer too thin
        shift = min(needs - 30.0, 8.0 - buffer)
        if shift > 0:
            needs = round(needs - shift, 1)
            buffer = round(buffer + shift, 1)
    return {
        "Needs": needs,
        "Investments": inv,
        "Discretionary": disc,
        "Buffer": buffer,
    }


def _merchant_cut_priority(name: str) -> int:
    lower = name.lower()
    for i, needle in enumerate(_CUT_PRIORITY_NEEDLES):
        if needle in lower:
            return i
    return 100


def _is_protected_merchant(name: str) -> bool:
    lower = name.lower()
    return any(p in lower for p in _PROTECTED_CUT_MERCHANTS)


def format_name_list(names: list[str], *, max_items: int = 2, fallback: str = "") -> str:
    cleaned = [str(n).strip() for n in names if n and str(n).strip()][:max_items]
    if not cleaned:
        return fallback
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"


def top_lifestyle_merchant_names(
    analytics: dict[str, Any] | None,
    *,
    limit: int = 2,
    exclude_protected: bool = True,
) -> list[str]:
    out: list[str] = []
    for row in (analytics or {}).get("merchants") or []:
        name = str(row.get("merchant") or row.get("name") or "").strip()
        if not name:
            continue
        if exclude_protected and _is_protected_merchant(name):
            continue
        out.append(name)
        if len(out) >= limit:
            break
    return out


def top_discretionary_category_labels(
    analytics: dict[str, Any] | None,
    *,
    limit: int = 2,
) -> list[str]:
    disc = {"Shopping", "Entertainment", "Subscriptions", "Other"}
    rows = (analytics or {}).get("by_category_lifestyle") or (analytics or {}).get("by_category") or []
    out: list[str] = []
    for row in rows:
        name = str(row.get("name") or "").strip()
        if name in disc and float(row.get("debit") or 0) > 0:
            out.append(name)
        if len(out) >= limit:
            break
    return out


def temptation_label(
    *,
    profile: dict[str, Any] | None = None,
    analytics: dict[str, Any] | None = None,
    merchants: list[dict[str, Any]] | None = None,
    transactions: Collection | None = None,
    category_map: dict[str, str] | None = None,
) -> str:
    """Soft spot if trained; else top discretionary merchant/category from live data."""
    soft = (profile or {}).get("soft_spot")
    if soft:
        return str(soft).strip()
    if merchants:
        for m in merchants:
            if not m.get("protected"):
                name = str(m.get("name") or "").strip()
                if name:
                    return name
    if transactions is not None:
        now = _now()
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        live = load_discretionary_merchants(
            transactions,
            start,
            now,
            category_map=category_map or DEFAULT_CATEGORY_BUCKETS,
            limit=4,
        )
        for m in live:
            if not m.get("protected"):
                name = str(m.get("name") or "").strip()
                if name:
                    return name
    merch = top_lifestyle_merchant_names(analytics, limit=1)
    if merch:
        return merch[0]
    cats = top_discretionary_category_labels(analytics, limit=1)
    if cats:
        return cats[0]
    return "impulse spend"


def build_calibration_personalization_note(
    merchants: list[dict[str, Any]] | None,
) -> str:
    cut_names = [str(m["name"]) for m in (merchants or []) if not m.get("protected")][:2]
    prot_names = [str(m["name"]) for m in (merchants or []) if m.get("protected")][:2]
    disc_cats = sorted(
        {str(m.get("category") or "Shopping") for m in (merchants or []) if not m.get("protected")}
    )[:2]
    disc_part = format_name_list(disc_cats, fallback="Discretionary")
    cut_part = format_name_list(cut_names, fallback="discretionary one-offs")
    prot_part = format_name_list(prot_names, fallback="SIPs and fixed subscriptions")
    return (
        f"Personal plan from your spend: lean Needs, step-up Investments, "
        f"tighter {disc_part} ({cut_part}), Buffer funds goals — {prot_part} protected."
    )


def build_merchant_personalization_note(
    merchants: list[dict[str, Any]] | None,
) -> str:
    cut_names = [str(m["name"]) for m in (merchants or []) if not m.get("protected")][:2]
    prot_names = [str(m["name"]) for m in (merchants or []) if m.get("protected")][:2]
    cut_part = format_name_list(cut_names, fallback="discretionary merchants")
    prot_part = format_name_list(prot_names, fallback="SIPs on payday")
    return f"Tuned to your merchants — trim {cut_part} first; keep {prot_part} protected."


def build_cut_first_rule(merchants: list[dict[str, Any]] | None) -> str:
    prot = format_name_list(
        [str(m["name"]) for m in (merchants or []) if m.get("protected")][:2],
        fallback="SIPs",
    )
    cut = format_name_list(
        [str(m["name"]) for m in (merchants or []) if not m.get("protected")][:1],
        fallback="discretionary one-offs",
    )
    return f"{prot} stay — cut {cut} first."


def load_discretionary_merchants(
    transactions: Collection,
    start: datetime,
    end: datetime,
    *,
    category_map: dict[str, str],
    limit: int = 12,
) -> list[dict[str, Any]]:
    """Top Discretionary-bucket merchants this month (for cut coaching)."""
    from collections import defaultdict

    totals: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"amount": 0.0, "count": 0.0, "category": "Shopping"}
    )
    disc_cats = {c for c, b in category_map.items() if b == "Discretionary"}
    match = {
        "type": "debit",
        "card_type": {"$ne": "wallet"},
        "received_at": {"$gte": start, "$lte": end},
        "category": {"$in": list(disc_cats) or ["Shopping", "Entertainment", "Subscriptions", "Other"]},
    }
    for doc in transactions.find(match, {"merchant": 1, "raw_text": 1, "amount": 1, "category": 1}):
        label = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text"))
        if not label or "(Family)" in label:
            continue
        if label.lower().startswith("siv3sh"):
            continue
        totals[label]["amount"] += float(doc.get("amount") or 0)
        totals[label]["count"] += 1
        if doc.get("category"):
            totals[label]["category"] = str(doc.get("category"))

    ranked = sorted(totals.items(), key=lambda kv: -kv[1]["amount"])
    return [
        {
            "name": name,
            "amount": round(vals["amount"], 2),
            "count": int(vals["count"]),
            "category": vals.get("category") or "Shopping",
            "protected": _is_protected_merchant(name),
        }
        for name, vals in ranked[:limit]
        if vals["amount"] > 0
    ]


def build_cut_to_unlock(
    framework: dict[str, Any],
    *,
    primary_goal_name: str | None = None,
    merchants: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Concrete merchant + category cuts that restore surplus for goals."""
    disc_row = next((c for c in framework["comparison"] if c["bucket"] == "Discretionary"), None)
    overshoot = float(framework.get("disc_overshoot") or 0)
    unlock = float(framework.get("surplus_if_on_plan") or 0)
    available = float(framework.get("available_surplus") or 0)
    cats = list((disc_row or {}).get("categories") or [])

    cuts: list[dict[str, Any]] = []
    remaining = overshoot

    # 1) Merchant-level first (your real spend)
    merch = [m for m in (merchants or []) if not m.get("protected")]
    merch.sort(key=lambda m: (_merchant_cut_priority(str(m.get("name") or "")), -float(m.get("amount") or 0)))
    for m in merch:
        if remaining <= 0:
            break
        amt = float(m.get("amount") or 0)
        if amt < 150:
            continue
        # Prefer skipping the whole hit for big one-offs, else trim ~60%
        cut = round(min(amt if amt >= 1500 else amt * 0.6, remaining), 0)
        if cut < 100:
            continue
        name = str(m.get("name") or "Merchant")
        cuts.append(
            {
                "category": str(m.get("category") or "Shopping"),
                "merchant": name,
                "current_spend": amt,
                "cut_by": cut,
                "action": (
                    f"Skip/reduce {name} (₹{amt:,.0f} this month) — cut ₹{cut:,.0f}"
                ),
            }
        )
        remaining = round(remaining - cut, 2)

    # 2) Category fill if still short
    for cat in cats:
        if remaining <= 0:
            break
        # Don't pile generic Subscriptions if Cursor-heavy — already protected at merchant
        amt = float(cat.get("amount") or 0)
        if amt <= 0:
            continue
        already = sum(c["cut_by"] for c in cuts if c.get("category") == cat["category"])
        room = max(0.0, amt - already)
        cut = round(min(room * 0.4, remaining), 0)
        if cut < 150:
            continue
        cuts.append(
            {
                "category": cat["category"],
                "merchant": None,
                "current_spend": amt,
                "cut_by": cut,
                "action": f"Trim {cat['category']} by ₹{cut:,.0f} more",
            }
        )
        remaining = round(remaining - cut, 2)

    goal_bit = f" for {primary_goal_name}" if primary_goal_name else " for your goals"
    top_m = next((c.get("merchant") for c in cuts if c.get("merchant")), None)
    if available > 0 and overshoot <= 0:
        headline = (
            f"You already have ₹{available:,.0f}/mo surplus{goal_bit}. "
            "Protect Investments and keep Discretionary inside its cap."
        )
        status = "ready"
    elif overshoot > 0 and top_m:
        headline = (
            f"Your Discretionary is ₹{overshoot:,.0f} over — mainly {top_m} and similar. "
            f"Cut that pattern → unlock ~₹{unlock:,.0f}/mo{goal_bit}."
        )
        status = "blocked"
    elif overshoot > 0:
        headline = (
            f"Discretionary is ₹{overshoot:,.0f} over plan. "
            f"Cut that overshoot → unlock ~₹{unlock:,.0f}/mo{goal_bit}."
        )
        status = "blocked"
    else:
        headline = (
            f"On plan this month — about ₹{unlock or available:,.0f}/mo can fund goals "
            "without touching Investments."
        )
        status = "on_track"

    steps = [c["action"] for c in cuts[:4]]
    if unlock > 0 and overshoot > 0:
        steps = [f"{s} → toward ₹{unlock:,.0f}/mo{goal_bit}" for s in steps]
    if not steps and overshoot > 0:
        steps = [f"Reduce Discretionary spend by ₹{overshoot:,.0f} this month"]

    keep = [m for m in (merchants or []) if m.get("protected")]
    keep_note = None
    if keep:
        names = ", ".join(str(m["name"]) for m in keep[:3])
        keep_note = f"Keeping {names} — treated as work/invest tools, not lifestyle cuts."

    return {
        "status": status,
        "headline": headline,
        "overshoot_inr": overshoot,
        "unlock_surplus_inr": unlock,
        "available_surplus_inr": available,
        "cuts": cuts[:5],
        "steps": steps[:5],
        "keep": [{"name": m["name"], "amount": m["amount"]} for m in keep[:4]],
        "keep_note": keep_note,
        "primary_goal_name": primary_goal_name,
        "spend_snapshot": {
            "top_discretionary": [
                {"name": m["name"], "amount": m["amount"], "protected": bool(m.get("protected"))}
                for m in (merchants or [])[:8]
            ],
        },
    }


def build_salary_day_allocation(
    framework: dict[str, Any],
    *,
    goals: list[dict[str, Any]],
    liquid: float,
) -> dict[str, Any]:
    """Payday auto-split suggestion — Investments first, then buffer, then goals."""
    income = float(framework.get("income_base") or 0)
    template = framework.get("template") or {}
    actual = framework.get("actual") or {}
    invest_target = float(template.get("Investments") or 0)
    invest_done = float(actual.get("Investments") or 0)
    invest_gap = round(max(0.0, invest_target - invest_done), 2)
    buffer_target = float(template.get("Buffer") or 0)
    # Proposed monthly goal pot = surplus if on plan (or current surplus)
    goal_pot = float(framework.get("available_surplus") or 0)
    if goal_pot <= 0:
        goal_pot = float(framework.get("surplus_if_on_plan") or 0)

    active = [g for g in goals if (g.get("status") or "active") == "active"]
    active.sort(key=lambda g: int(g.get("priority") or 100))
    goal_splits: list[dict[str, Any]] = []
    pot_left = goal_pot
    for g in active:
        gid = str(g.get("id") or g.get("_id") or "")
        name = str(g.get("name") or "Goal")
        rem = float(g.get("remaining") if g.get("remaining") is not None else max(
            0.0,
            float(g.get("target_price") or 0) - float(g.get("saved_amount") or 0),
        ))
        take = round(min(pot_left, rem) if rem > 0 else 0.0, 2)
        if take <= 0 and pot_left > 0 and rem > 0:
            take = pot_left
        goal_splits.append(
            {
                "goal_id": gid,
                "name": name,
                "monthly": take,
                "lump_from_buffer": round(min(liquid if g == active[0] else 0, rem), 2) if active and g == active[0] else 0.0,
            }
        )
        pot_left = round(max(0.0, pot_left - take), 2)

    play_money = round(
        max(
            0.0,
            float(template.get("Discretionary") or 0) - float(actual.get("Discretionary") or 0),
        ),
        2,
    )

    return {
        "title": "Salary-day auto-split",
        "subtitle": "Copy how disciplined investors remove willpower — split on payday, before shopping.",
        "income_base": income,
        "steps": [
            {
                "order": 1,
                "label": "Investments (pay yourself first)",
                "amount": invest_gap if invest_gap > 0 else invest_target,
                "note": (
                    f"₹{invest_gap:,.0f} still needed to hit this month’s Investments target"
                    if invest_gap > 0
                    else f"Investments target ₹{invest_target:,.0f} — keep SIPs running"
                ),
                "protected": True,
            },
            {
                "order": 2,
                "label": "Buffer top-up",
                "amount": round(max(0.0, buffer_target - float(actual.get("Buffer") or 0)), 2),
                "note": "Emergency/buffer pot — not for shopping",
                "protected": True,
            },
            {
                "order": 3,
                "label": "Goal pot",
                "amount": goal_pot,
                "note": "Only from Discretionary + Buffer room — never from Investments",
                "protected": False,
                "splits": goal_splits,
            },
            {
                "order": 4,
                "label": "Guilt-free Discretionary left",
                "amount": play_money if float(framework.get("disc_overshoot") or 0) <= 0 else 0.0,
                "note": (
                    "Spend freely inside this — you’re on plan"
                    if float(framework.get("disc_overshoot") or 0) <= 0
                    else "No play money until Discretionary is back under its cap"
                ),
                "protected": False,
            },
        ],
    }


def _name(profile: dict[str, Any]) -> str:
    n = str(profile.get("preferred_name") or "you").strip()
    return n if n else "you"


def build_advisor_voice(
    *,
    profile: dict[str, Any],
    unlock: dict[str, Any],
    focus: dict[str, Any] | None,
    invest_rate: float,
    invest_target_pct: float,
    invest_gap: float,
    advisor_severity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Emotional coach copy — warm when earned, strict when needed.

    Mood prefers deterministic advisor_severity when provided.
    """
    name = _name(profile)
    tone = str(profile.get("coach_tone") or "").lower()
    soft = profile.get("soft_spot")
    deal = profile.get("dealbreaker")
    why = profile.get("why_money")
    pride = profile.get("pride")
    strict_on = profile.get("strict_on")
    motivation = profile.get("motivation") or (focus or {}).get("name")
    status = unlock.get("status") or "on_track"
    overshoot = float(unlock.get("overshoot_inr") or 0)
    unlock_amt = float(unlock.get("unlock_surplus_inr") or 0)
    top = next((c.get("merchant") for c in (unlock.get("cuts") or []) if c.get("merchant")), None)
    goal = (focus or {}).get("name") or motivation or "your goal"

    # Mood — prefer global severity calculator when present
    sev_level = (advisor_severity or {}).get("level")
    if sev_level == "strict":
        mood = "strict"
        intensity = "high"
    elif sev_level == "concerned":
        mood = "firm"
        intensity = "medium"
    elif sev_level == "informational" and status == "ready":
        mood = "proud"
        intensity = "low"
    elif sev_level == "informational":
        mood = "steady"
        intensity = "low"
    elif status == "blocked" and overshoot >= 2500:
        mood = "strict"
        intensity = "high"
    elif status == "blocked":
        mood = "firm"
        intensity = "medium"
    elif invest_rate + 1 < invest_target_pct:
        mood = "firm"
        intensity = "medium"
    elif status == "ready":
        mood = "proud"
        intensity = "low"
    else:
        mood = "steady"
        intensity = "low"

    # Opening — soul
    if mood == "strict":
        opener = (
            f"Hey {name} — I’m not going to soften this. "
            f"Discretionary is ₹{overshoot:,.0f} over"
            + (f", and {top} is staring at both of us" if top else "")
            + f". That money was supposed to walk toward {goal}."
        )
        if deal:
            opener += f" You told me your dealbreaker is “{deal}” — this is that moment."
        elif soft:
            opener += f" You already named your soft spot: {soft}. We’re in it."
    elif mood == "firm":
        opener = (
            f"{name}, I care about where you’re going — so I’m being direct. "
        )
        if overshoot > 0:
            opener += (
                f"You’re ₹{overshoot:,.0f} over Discretionary"
                + (f" (hello, {top})" if top else "")
                + f". Fix it and you unlock ~₹{unlock_amt:,.0f}/mo for {goal}."
            )
        elif invest_gap > 0:
            opener += (
                f"Investments are still ₹{invest_gap:,.0f} short of your pay-yourself-first target. "
                f"SIPs before shopping — always."
            )
        if why:
            opener += f" Remember why this matters to you: {why}."
    elif mood == "proud":
        opener = (
            f"{name}, this is the version of you I respect — surplus is open and Investments are protected."
        )
        if pride:
            opener += f" Keep leaning on what you’re proud of: {pride}."
        opener += f" Now feed {goal} like it has a deadline."
    else:
        opener = (
            f"{name}, we’re steady. Stay boring with money — boring builds wealth."
        )
        if motivation:
            opener += f" Every quiet month is a brick toward {motivation}."

    # Strict line
    if mood in {"strict", "firm"}:
        drag = strict_on or soft or top or "discretionary spend"
        if "no-nonsense" in tone or "strict" in tone:
            strict_line = (
                f"No debate: finish the salary-day split before chasing {drag}. "
                f"If {drag} calls, you hang up."
            )
        else:
            strict_line = (
                f"I’m saying this as your coach, not your critic: "
                f"pause {strict_on or soft or 'that spend'} this week. "
                f"{goal} needs you more than another bag or gadget hit."
            )
    else:
        strict_line = (
            f"Stay strict with yourself on payday — Invest → Buffer → {goal} → then play. "
            "That’s how people who actually get rich behave, not how influencers talk."
        )

    # Heart line
    if why and motivation:
        heart = f"You said money is about {why}. Picture {motivation} — that’s the feeling we’re buying with discipline, not EMI."
    elif why:
        heart = f"Hold onto this: {why}. Numbers are just how we protect that."
    elif motivation:
        heart = f"Every cut is a love letter to future-you holding {motivation}."
    else:
        heart = (
            "Train me — tell me your soft spot, your why, and what you’re proud of. "
            "The more I know you, the less I’ll sound like a spreadsheet."
        )

    # Closing push
    if mood == "strict":
        closer = (
            f"Do the cut list today, {name}. Not “when I feel like it.” Today. "
            f"Then put ₹{unlock_amt:,.0f}/mo on rails for {goal}."
        )
    elif mood == "proud":
        closer = f"Log a contribution while the feeling is clean. Momentum is a gift — don’t waste it."
    else:
        closer = f"Small, boring actions this week. I’ll be proud of quiet discipline."

    training_nudge = None
    if float(profile.get("completeness") or 0) < 50:
        training_nudge = (
            "I only know you halfway. Answer the training questions so I can stop sounding generic "
            "and start sounding like *your* advisor."
        )
    elif float(profile.get("completeness") or 0) < 100:
        training_nudge = (
            f"I know you ~{profile.get('completeness')}%. Finish training and I’ll get sharper — "
            "stricter where you asked, softer where you’ve earned it."
        )

    return {
        "mood": mood,
        "intensity": intensity,
        "tone": tone,
        "opener": opener,
        "strict_line": strict_line,
        "heart": heart,
        "closer": closer,
        "training_nudge": training_nudge,
        "address_as": name,
    }


def build_advisor(
    framework: dict[str, Any],
    *,
    goals: list[dict[str, Any]],
    liquid: float,
    settings: dict[str, Any],
    merchants: list[dict[str, Any]] | None = None,
    personalization_note: str | None = None,
    learned_facts: Collection | None = None,
    persona_settings: Collection | None = None,
) -> dict[str, Any]:
    """Money-planning advisor briefing: coach + methods + payday plan."""
    income = float(framework.get("income_base") or 0)
    template = framework.get("template") or {}
    actual = framework.get("actual") or {}
    profile = advisor_profile_from_facts(learned_facts)
    invest_rate = (
        round(float(actual.get("Investments") or 0) / income * 100, 1) if income else 0.0
    )
    invest_target_pct = float((framework.get("bucket_pcts") or {}).get("Investments") or 27)
    invest_gap = round(max(0.0, float(template.get("Investments") or 0) - float(actual.get("Investments") or 0)), 2)
    lifestyle = float(actual.get("Needs") or 0) + float(actual.get("Discretionary") or 0)
    lifestyle_pct = round(lifestyle / income * 100, 1) if income else 0.0

    active = [g for g in goals if (g.get("status") or "active") == "active"]
    primary = active[0] if active else None
    primary_name = str(primary.get("name") or "") if primary else None
    # Prefer trained motivation name for emotional hooks
    if not primary_name and profile.get("motivation"):
        primary_name = str(profile.get("motivation"))

    unlock = build_cut_to_unlock(
        framework,
        primary_goal_name=primary_name,
        merchants=merchants,
    )
    payday = build_salary_day_allocation(framework, goals=goals, liquid=liquid)

    shop = next((m for m in (merchants or []) if not m.get("protected")), None)
    soft = str(profile.get("soft_spot") or "").lower()

    methods_out = []
    for m in WEALTH_METHODS:
        check = m["check"]
        if check == "invest_rate":
            ok = invest_rate >= invest_target_pct - 2
            verdict = (
                f"You’re investing ~{invest_rate}% of take-home (target {invest_target_pct}%). "
                f"INDmoney/MF SIPs count — keep them on salary day."
                if income
                else "Set income profile so we can score this."
            )
            if not ok and income:
                verdict += f" Add ₹{max(invest_gap, 0):,.0f} more this month."
        elif check == "discretionary_cap":
            over = float(framework.get("disc_overshoot") or 0)
            ok = over <= 0
            if ok:
                verdict = "Discretionary is inside its cap — guilt-free spend zone is open."
            elif shop:
                verdict = (
                    f"Discretionary is ₹{over:,.0f} over — {shop['name']} alone is "
                    f"₹{float(shop['amount']):,.0f}. That’s the main goal blocker."
                )
                if soft and shop:
                    sn = str(shop.get("name") or "").lower()
                    sc = str(shop.get("category") or "").lower()
                    if soft in sn or sn in soft or soft in sc:
                        verdict += f" You warned me about “{profile.get('soft_spot')}” — this is it."
            else:
                verdict = f"Discretionary is ₹{over:,.0f} over — that’s why goal surplus is blocked."
        elif check == "lifestyle_vs_income":
            ok = lifestyle_pct <= 70
            leak_cats = sorted(
                {str(m.get("category") or "") for m in (merchants or []) if not m.get("protected")}
            )[:2]
            leak_part = format_name_list(leak_cats, fallback="discretionary categories")
            verdict = (
                f"Needs + Discretionary are ~{lifestyle_pct}% of income — "
                f"structurally fine; the leak is {leak_part}, not rent-level Needs."
            )
        elif check == "goals_cash":
            ok = True
            if primary:
                oc = (primary.get("opportunity_cost") or {}).get("interest_avoided_approx")
                verdict = (
                    f"Save cash for {primary_name} (₹{float(primary.get('target') or primary.get('target_price') or 0):,.0f}) "
                    f"instead of EMI — avoids ~₹{float(oc or 0):,.0f} finance charges."
                    if oc
                    else f"Keep funding {primary_name} from surplus — never EMI a want."
                )
            else:
                verdict = "Add a goal and we’ll show the EMI interest you’d avoid by saving first."
        else:  # auto_allocate
            ok = float(framework.get("available_surplus") or 0) > 0 or float(framework.get("disc_overshoot") or 0) <= 0
            drag = temptation_label(profile=profile, merchants=merchants)
            verdict = (
                f"On payday: Invest → Buffer → goal pot → then {drag}. "
                "Finish the split before discretionary spend."
            )
        methods_out.append(
            {
                **m,
                "on_track": ok,
                "verdict": verdict,
            }
        )

    # Advisor score: simple 0-100
    score = 0
    score += 25 if invest_rate >= invest_target_pct - 2 else int(min(25, invest_rate / max(invest_target_pct, 1) * 25))
    score += 25 if float(framework.get("disc_overshoot") or 0) <= 0 else 5
    score += 20 if lifestyle_pct <= 70 else 8
    score += 15 if active else 0
    score += 15 if float(framework.get("available_surplus") or 0) > 0 else (
        8 if float(framework.get("surplus_if_on_plan") or 0) > 0 else 0
    )

    if primary:
        rem = float(primary.get("remaining") or 0)
        pace = float(primary.get("effective_monthly_pace") or unlock["unlock_surplus_inr"] or 0)
        months = round(rem / pace, 1) if pace > 0 else None
        focus = {
            "goal_id": primary.get("id"),
            "name": primary_name,
            "progress_pct": primary.get("progress_pct") or 0,
            "saved": primary.get("saved_amount") or 0,
            "target": primary.get("target_price") or 0,
            "remaining": rem,
            "status_line": primary.get("status_line"),
            "months_at_unlocked_pace": months,
            "unlocked_monthly": unlock["unlock_surplus_inr"] or unlock["available_surplus_inr"],
            "opportunity_message": (primary.get("opportunity_cost") or {}).get("message"),
            "streak_months": primary.get("streak_months") or 0,
            "funding": primary.get("funding"),
        }
    else:
        focus = None

    next_actions = list(unlock.get("steps") or [])[:4]
    if invest_rate < invest_target_pct - 2 and income and invest_gap > 0:
        next_actions.insert(
            0,
            f"Pay yourself first on salary day: invest ₹{invest_gap:,.0f} more (INDmoney/MF) before shopping",
        )
    if not active:
        next_actions.append("Pick one primary goal so surplus has a job — and so I have something to protect with you")

    try:
        from advisor_persona import compute_advisor_severity, get_advisor_persona_settings

        sens = 50
        if persona_settings is not None:
            sens = int(get_advisor_persona_settings(persona_settings)["strictness_sensitivity"])
        advisor_severity = compute_advisor_severity(
            planning_advisor={"cut_to_unlock": unlock},
            goal_docs=goals,
            sensitivity=sens,
        )
    except Exception:  # noqa: BLE001
        advisor_severity = {
            "level": "informational",
            "reasons": [],
            "context_line": "tone: informational",
        }

    voice = build_advisor_voice(
        profile=profile,
        unlock=unlock,
        focus=focus,
        invest_rate=invest_rate,
        invest_target_pct=invest_target_pct,
        invest_gap=invest_gap,
        advisor_severity=advisor_severity,
    )

    return {
        "score": min(100, score),
        "score_label": (
            "Strong discipline" if score >= 75 else "Building habits" if score >= 45 else "Needs a reset"
        ),
        "headline": voice["opener"],
        "voice": voice,
        "advisor_severity": advisor_severity,
        "profile": {
            "preferred_name": profile.get("preferred_name"),
            "coach_tone": profile.get("coach_tone"),
            "soft_spot": profile.get("soft_spot"),
            "dealbreaker": profile.get("dealbreaker"),
            "why_money": profile.get("why_money"),
            "pride": profile.get("pride"),
            "strict_on": profile.get("strict_on"),
            "motivation": profile.get("motivation"),
            "completeness": profile.get("completeness"),
            "trained_keys": profile.get("trained_keys"),
        },
        "focus_goal": focus,
        "cut_to_unlock": unlock,
        "salary_day": payday,
        "methods": methods_out,
        "next_actions": next_actions[:5],
        "rules": [
            "Never reduce the Investments bucket to fund a want.",
            "Goals only draw from Discretionary + Buffer room.",
            "On salary day: Invest → Buffer → Goals → then spend.",
            build_cut_first_rule(merchants),
        ],
        "personalization_note": personalization_note,
        "your_spend": {
            "income_base": income,
            "discretionary_merchants": [
                {
                    "name": m["name"],
                    "amount": m["amount"],
                    "protected": bool(m.get("protected")),
                    "category": m.get("category"),
                }
                for m in (merchants or [])[:8]
            ],
        },
    }


def estimate_liquid_buffer(
    analytics: dict[str, Any],
    settings: dict[str, Any],
) -> float:
    if settings.get("liquid_buffer_override") is not None:
        return round(float(settings["liquid_buffer_override"]), 2)
    # Heuristic: leftover Buffer template this month + small cash proxy from overview
    framework = build_budget_framework(analytics, settings)
    leftover = max(
        0.0,
        framework["template"]["Buffer"] - framework["actual"]["Buffer"],
    )
    o = analytics.get("overview") or {}
    # If net worth / cash isn't split, use leftover buffer only
    return round(leftover, 2)


# ── Goals ────────────────────────────────────────────────────────────────────


def serialize_goal(doc: dict[str, Any], *, enrich: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {
        "id": str(doc["_id"]),
        "name": doc.get("name"),
        "target_price": float(doc.get("target_price") or 0),
        "manual_price": doc.get("manual_price"),
        "saved_amount": float(doc.get("saved_amount") or 0),
        "monthly_contribution": float(doc.get("monthly_contribution") or 0),
        "target_date": doc.get("target_date"),
        "priority": int(doc.get("priority") or 100),
        "status": doc.get("status") or "active",
        "price_lookup": doc.get("price_lookup"),
        "timing_note": doc.get("timing_note"),
        "contribution_months": list(doc.get("contribution_months") or []),
        "streak_months": int(doc.get("streak_months") or 0),
        "created_at": (
            doc["created_at"].isoformat()
            if isinstance(doc.get("created_at"), datetime)
            else doc.get("created_at")
        ),
        "updated_at": (
            doc["updated_at"].isoformat()
            if isinstance(doc.get("updated_at"), datetime)
            else doc.get("updated_at")
        ),
        "completed_at": (
            doc["completed_at"].isoformat()
            if isinstance(doc.get("completed_at"), datetime)
            else doc.get("completed_at")
        ),
        "completion_txn_id": doc.get("completion_txn_id"),
    }
    if enrich:
        out.update(enrich)
    return out


PRICE_LOOKUP_SYSTEM = (
    "You estimate current retail prices in India (INR) for consumer products. "
    "Use well-known Indian retailers when possible (Amazon.in, Flipkart, Croma, "
    "Reliance Digital, official brand store). "
    "Respond with JSON only. Never invent a specific URL you are unsure of — "
    "cite retailer names as sources. "
    "If you know a recurring sale season for this category (Amazon Great Indian Festival, "
    "Flipkart Big Billion Days, Republic Day sales, etc.), include timing_note; "
    "otherwise set timing_note to null. Do not invent sale events."
)


def lookup_goal_price(goal_name: str, *, provider_name: str | None = None) -> dict[str, Any]:
    """LLM (+ optional Gemini Google Search) approximate price lookup — on demand only."""
    provider = get_provider(provider_name)
    user = (
        f'Product / goal: "{goal_name}"\n'
        "Return JSON:\n"
        "{\n"
        '  "approx_price_inr": number,\n'
        '  "currency": "INR",\n'
        '  "sources": [{"retailer": string, "note": string}],\n'
        '  "confidence": "low"|"medium"|"high",\n'
        '  "timing_note": string|null,\n'
        '  "summary": string\n'
        "}\n"
        "timing_note only if you have genuine category sale-season knowledge; else null."
    )

    text = ""
    # Prefer Gemini with Google Search grounding when available
    if provider.name == "gemini":
        text = _gemini_complete_with_search(PRICE_LOOKUP_SYSTEM, user)
    if not text:
        text = provider.complete(PRICE_LOOKUP_SYSTEM, user, temperature=0.2)

    data = extract_json(text) or {}
    if not isinstance(data, dict):
        data = {}

    price = data.get("approx_price_inr") or data.get("price") or data.get("approx_price")
    try:
        price_f = float(price)
    except (TypeError, ValueError):
        price_f = 0.0

    sources = data.get("sources") or []
    if isinstance(sources, list):
        sources = [
            {
                "retailer": str(s.get("retailer") or s.get("name") or "Retailer"),
                "note": str(s.get("note") or ""),
            }
            for s in sources
            if isinstance(s, dict)
        ][:5]
    else:
        sources = []

    timing = data.get("timing_note")
    if timing is not None:
        timing = str(timing).strip() or None

    return {
        "approx_price_inr": round(price_f, 2),
        "currency": "INR",
        "sources": sources,
        "confidence": str(data.get("confidence") or "low"),
        "timing_note": timing,
        "summary": str(data.get("summary") or "").strip(),
        "looked_up_at": _now().isoformat(),
        "provider": provider.name,
        "raw": data,
    }


def _gemini_complete_with_search(system: str, user: str) -> str:
    """Best-effort Gemini call with google_search tool; empty string on failure."""
    import os

    import httpx

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    if not api_key:
        return ""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2},
    }
    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(url, json=payload)
            if r.status_code >= 400:
                return ""
            data = r.json()
            parts = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [])
            )
            return "".join(str(p.get("text") or "") for p in parts).strip()
    except Exception:
        return ""


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


def _projected_date(months_needed: float | None) -> str | None:
    if months_needed is None or months_needed <= 0:
        return None
    now = _now()
    whole = int(math.ceil(months_needed))
    y, m = _add_months(now.year, now.month, whole)
    last = calendar.monthrange(y, m)[1]
    return f"{y:04d}-{m:02d}-{last:02d}"


def compute_goal_funding(
    goal: dict[str, Any],
    *,
    allocated_monthly: float,
    liquid_available: float,
    settings: dict[str, Any],
) -> dict[str, Any]:
    target = float(goal.get("target_price") or goal.get("manual_price") or 0)
    if goal.get("manual_price") is not None:
        try:
            target = float(goal["manual_price"])
        except (TypeError, ValueError):
            pass
    saved = float(goal.get("saved_amount") or 0)
    remaining = max(0.0, target - saved)
    monthly = max(0.0, float(allocated_monthly or 0))
    contrib = float(goal.get("monthly_contribution") or 0)
    # Prefer explicit user contribution if set and within allocation
    pace = contrib if contrib > 0 else monthly
    if monthly > 0 and contrib > monthly:
        pace = monthly

    months_needed = None
    if remaining <= 0:
        months_needed = 0.0
    elif pace > 0:
        months_needed = round(remaining / pace, 1)

    projected = _projected_date(months_needed)
    target_date = goal.get("target_date")
    status_line = ""
    behind = False
    suggested_monthly = pace

    if remaining <= 0:
        status_line = "Goal fully funded — ready to purchase"
    elif pace <= 0:
        status_line = "No surplus available this month — wait or free Discretionary/Buffer spend"
        behind = True
    elif target_date:
        try:
            td = datetime.fromisoformat(str(target_date)[:10]).replace(tzinfo=timezone.utc)
            months_left = max(
                1,
                (td.year - _now().year) * 12 + (td.month - _now().month),
            )
            needed = remaining / months_left
            if pace + 1e-6 < needed:
                behind = True
                suggested_monthly = round(needed, 0)
                status_line = (
                    f"Behind pace — this month's ₹{pace:,.0f} won't hit {target_date}; "
                    f"you need about ₹{suggested_monthly:,.0f}/mo"
                )
            else:
                status_line = (
                    f"On track — ₹{pace:,.0f}/mo points to {projected or target_date}"
                )
        except ValueError:
            status_line = f"On track for {projected}" if projected else "Building toward your goal"
    elif projected:
        status_line = f"On track for {projected}"
    else:
        status_line = "Building toward your goal"

    # Funding suggestion: use some liquid now, top up monthly
    lump = min(liquid_available, remaining)
    after_lump = max(0.0, remaining - lump)
    monthly_needed = round(after_lump / months_needed, 2) if months_needed and months_needed > 0 else (
        round(after_lump, 2) if after_lump else 0.0
    )
    if months_needed and months_needed > 0 and after_lump > 0:
        monthly_needed = round(after_lump / max(months_needed, 1), 2)

    # If using lump, recompute months at allocated pace
    months_with_lump = None
    if after_lump <= 0:
        months_with_lump = 0.0
    elif pace > 0:
        months_with_lump = round(after_lump / pace, 1)

    progress_pct = round(min(100.0, saved / target * 100), 1) if target > 0 else 0.0
    oc = opportunity_cost_emi(
        remaining,
        annual_rate=float(settings.get("emi_annual_rate") or DEFAULT_EMI_ANNUAL_RATE),
        tenure_months=int(settings.get("emi_tenure_months") or DEFAULT_EMI_TENURE_MONTHS),
    )

    return {
        "target_price": round(target, 2),
        "saved_amount": round(saved, 2),
        "remaining": round(remaining, 2),
        "progress_pct": progress_pct,
        "allocated_monthly": round(monthly, 2),
        "effective_monthly_pace": round(pace, 2),
        "months_needed": months_needed,
        "projected_date": projected,
        "status_line": status_line,
        "behind_pace": behind,
        "suggested_monthly": round(suggested_monthly, 2),
        "funding": {
            "lump_sum_available": round(lump, 2),
            "monthly_needed_after_lump": monthly_needed,
            "months_with_lump": months_with_lump,
            "note": (
                "Lump sum draws from estimated liquid/buffer only — "
                "never from the Investments bucket."
            ),
        },
        "opportunity_cost": {
            "interest_avoided_approx": oc["interest_approx"],
            "message": (
                f"Saving up instead of buying on EMI/credit avoids approximately "
                f"₹{oc['interest_approx']:,.0f} in interest/finance charges"
                if oc["interest_approx"] > 0
                else "Saving up keeps you clear of EMI finance charges."
            ),
            **oc,
        },
        "milestones": [25, 50, 75, 100],
        "streak_months": int(goal.get("streak_months") or 0),
    }


def allocate_surplus_by_priority(
    goals: list[dict[str, Any]],
    available_surplus: float,
) -> dict[str, float]:
    """Split surplus across active goals by priority order (lower priority # = first)."""
    active = [g for g in goals if (g.get("status") or "active") == "active"]
    active.sort(key=lambda g: (int(g.get("priority") or 100), str(g.get("name") or "")))
    remaining_pool = max(0.0, float(available_surplus or 0))
    allocations: dict[str, float] = {}

    for g in active:
        gid = str(g["_id"])
        target = float(g.get("manual_price") if g.get("manual_price") is not None else g.get("target_price") or 0)
        saved = float(g.get("saved_amount") or 0)
        need = max(0.0, target - saved)
        user_contrib = float(g.get("monthly_contribution") or 0)
        want = user_contrib if user_contrib > 0 else need  # uncapped want → take what's left for pace
        # Cap request at remaining need; if no explicit contrib, give full remaining pool share greedily
        if user_contrib > 0:
            take = min(remaining_pool, user_contrib, need)
        else:
            take = min(remaining_pool, need) if need > 0 else 0.0
            # If need is huge, still allocate remaining pool to top priority fully
            if need > remaining_pool:
                take = remaining_pool
        take = round(max(0.0, take), 2)
        allocations[gid] = take
        remaining_pool = round(remaining_pool - take, 2)
        if remaining_pool <= 0:
            # Zero out the rest
            for rest in active[active.index(g) + 1 :]:
                allocations.setdefault(str(rest["_id"]), 0.0)
            break

    for g in active:
        allocations.setdefault(str(g["_id"]), 0.0)
    return allocations


def list_goals_enriched(
    goals_col: Collection,
    *,
    analytics: dict[str, Any],
    settings: dict[str, Any],
    merchants: list[dict[str, Any]] | None = None,
    personalization_note: str | None = None,
    learned_facts: Collection | None = None,
    persona_settings: Collection | None = None,
) -> dict[str, Any]:
    framework = build_budget_framework(analytics, settings)
    liquid = estimate_liquid_buffer(analytics, settings)
    docs = list(goals_col.find({"status": {"$ne": "deleted"}}).sort([("priority", 1), ("created_at", 1)]))
    active_docs = [d for d in docs if (d.get("status") or "active") == "active"]
    allocations = allocate_surplus_by_priority(active_docs, framework["available_surplus"])

    # Split liquid across priorities similarly for display (first goal gets first claim)
    liquid_left = liquid
    enriched = []
    for d in docs:
        gid = str(d["_id"])
        alloc = allocations.get(gid, 0.0) if (d.get("status") or "active") == "active" else 0.0
        lump_claim = 0.0
        if (d.get("status") or "active") == "active" and liquid_left > 0:
            target = float(
                d.get("manual_price")
                if d.get("manual_price") is not None
                else d.get("target_price")
                or 0
            )
            rem = max(0.0, target - float(d.get("saved_amount") or 0))
            lump_claim = min(liquid_left, rem)
            liquid_left = round(liquid_left - lump_claim, 2)
        funding = compute_goal_funding(
            d,
            allocated_monthly=alloc,
            liquid_available=lump_claim,
            settings=settings,
        )
        enriched.append(serialize_goal(d, enrich=funding))

    # Detect if priority split is needed
    desired = 0.0
    for d in active_docs:
        target = float(
            d.get("manual_price") if d.get("manual_price") is not None else d.get("target_price") or 0
        )
        rem = max(0.0, target - float(d.get("saved_amount") or 0))
        contrib = float(d.get("monthly_contribution") or 0)
        if contrib > 0:
            desired += contrib
        elif rem > 0 and d.get("target_date"):
            try:
                td = datetime.fromisoformat(str(d["target_date"])[:10])
                months_left = max(1, (td.year - _now().year) * 12 + (td.month - _now().month))
                desired += rem / months_left
            except ValueError:
                desired += rem / 6.0
        elif rem > 0:
            desired += rem / 6.0  # assume 6-mo default pace for conflict check

    shortfall = desired > framework["available_surplus"] + 1e-6 and len(active_docs) > 1

    return {
        "framework": framework,
        "liquid_buffer_estimate": liquid,
        "goals": enriched,
        "allocations": allocations,
        "priority_conflict": shortfall,
        "priority_note": (
            "Available surplus can't fund all goals at their target pace — "
            "surplus is split by priority order (drag to reorder)."
            if shortfall
            else None
        ),
        "advisor": build_advisor(
            framework,
            goals=enriched,
            liquid=liquid,
            settings=settings,
            merchants=merchants,
            personalization_note=personalization_note,
            learned_facts=learned_facts,
            persona_settings=persona_settings,
        ),
    }


def record_contribution_month(goal_doc: dict[str, Any], amount: float) -> dict[str, Any]:
    """Update streak when user logs a monthly contribution."""
    now = _now()
    ym = f"{now.year:04d}-{now.month:02d}"
    months = list(goal_doc.get("contribution_months") or [])
    if ym not in months:
        months.append(ym)
    months = sorted(set(months))[-24:]

    # Streak: consecutive months ending at current or previous month
    streak = 0
    y, m = now.year, now.month
    for _ in range(24):
        key = f"{y:04d}-{m:02d}"
        if key in months:
            streak += 1
            y, m = _add_months(y, m, -1)
        else:
            # allow missing current month if contributing early for prior
            if streak == 0 and key == ym:
                y, m = _add_months(y, m, -1)
                continue
            break

    return {
        "saved_amount": round(float(goal_doc.get("saved_amount") or 0) + max(0.0, amount), 2),
        "contribution_months": months,
        "streak_months": streak,
        "updated_at": now,
    }


def complete_goal_as_liability_txn(
    *,
    transactions: Collection,
    goal: dict[str, Any],
    amount: float | None = None,
) -> dict[str, Any]:
    """Log purchase as liability-classified Shopping spend in the main ledger."""
    now = _now()
    price = float(
        amount
        if amount is not None
        else (
            goal.get("manual_price")
            if goal.get("manual_price") is not None
            else goal.get("target_price")
            or goal.get("saved_amount")
            or 0
        )
    )
    name = clean_merchant_label(str(goal.get("name") or "Goal purchase"))
    doc = {
        "type": "debit",
        "amount": round(price, 2),
        "merchant": name,
        "raw_text": f"Money Planning goal completed: {goal.get('name')}",
        "category": "Shopping",
        "category_source": "planning_goal",
        "mcc": None,
        "wealth_class": "liability",
        "planning_goal_id": str(goal["_id"]),
        "source": "planning",
        "bank": None,
        "card_type": None,
        "received_at": now,
        "created_at": now,
    }
    res = transactions.insert_one(doc)
    doc["_id"] = res.inserted_id
    return {
        "transaction_id": str(res.inserted_id),
        "amount": doc["amount"],
        "category": doc["category"],
        "wealth_class": "liability",
        "merchant": name,
    }


def build_planning_summary(
    *,
    transactions: Collection,
    goals_col: Collection,
    settings_col: Collection,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    learned_facts: Collection | None = None,
    persona_settings: Collection | None = None,
    year: int | None = None,
    month: int | None = None,
    apply_personal_calibration: bool = True,
) -> dict[str, Any]:
    if year is None or month is None:
        start, end, year, month = _current_month_bounds()
    else:
        start, end = _month_bounds(year, month)

    settings = get_planning_settings(settings_col)
    analytics = build_analytics(
        transactions,
        date_from=start,
        date_to=end,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities,
        budgets=budgets,
        learned_facts=learned_facts,
    )

    # First pass framework (for calibration)
    base_framework = build_budget_framework(analytics, settings)
    personalization_note = settings.get("personalization_note")

    merchants = load_discretionary_merchants(
        transactions,
        start,
        end,
        category_map=settings["category_buckets"],
    )

    if apply_personal_calibration and not settings.get("personal_plan_locked"):
        doc = settings_col.find_one({"_id": SETTINGS_ID}) or {}
        # Calibrate once from live spend unless user locked percentages
        if not doc.get("calibrated_at"):
            calibrated = calibrate_bucket_pcts_for_spend(base_framework)
            settings = save_planning_settings(
                settings_col,
                bucket_pcts=calibrated,
            )
            note = build_calibration_personalization_note(merchants)
            settings_col.update_one(
                {"_id": SETTINGS_ID},
                {"$set": {"personalization_note": note, "calibrated_at": _now()}},
            )
            settings = get_planning_settings(settings_col)
            personalization_note = note
            settings = {**settings, "personalization_note": note}
        elif not personalization_note:
            personalization_note = doc.get("personalization_note")

    packed = list_goals_enriched(
        goals_col,
        analytics=analytics,
        settings=settings,
        merchants=merchants,
        personalization_note=personalization_note
        or build_merchant_personalization_note(merchants),
        learned_facts=learned_facts,
        persona_settings=persona_settings if persona_settings is not None else settings_col,
    )
    return {
        "month": f"{year:04d}-{month:02d}",
        "label": datetime(year, month, 1).strftime("%B %Y"),
        "settings": {
            "bucket_pcts": settings["bucket_pcts"],
            "category_buckets": settings["category_buckets"],
            "emi_annual_rate": settings["emi_annual_rate"],
            "emi_tenure_months": settings["emi_tenure_months"],
            "liquid_buffer_override": settings.get("liquid_buffer_override"),
            "personalization_note": personalization_note,
        },
        **packed,
    }
