"""Analytics aggregations for the premium dashboard modules."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

# Canonical instrument names for investment vehicles
INSTRUMENT_RULES: list[tuple[str, str, str]] = [
    # (keyword, instrument, asset class)
    ("digital gold", "Digital Gold (Neosie)", "Digital Gold"),
    ("gold in", "Digital Gold (Neosie)", "Digital Gold"),
    ("neosie", "Digital Gold (Neosie)", "Digital Gold"),
    ("groww", "Groww", "Equity / Brokerage"),
    ("zerodha", "Zerodha", "Equity / Brokerage"),
    ("upstox", "Upstox", "Equity / Brokerage"),
    ("indmoney", "INDmoney", "Equity / Brokerage"),
    ("indstocks", "INDmoney (INDstocks)", "Equity / Brokerage"),
    ("finzoomers", "INDmoney", "Equity / Brokerage"),
    ("kuvera", "Kuvera", "Mutual Funds"),
    ("mutual fund", "Mutual Funds", "Mutual Funds"),
    ("indian clearing", "Mutual Funds (via ICCL)", "Mutual Funds"),
    ("nse", "NSE", "Equity / Brokerage"),
]

# Long alphanumeric transaction references (NEFT/UPI ids) that make merchants unique per txn
_REF_RUN = re.compile(r"\b[A-Z]*\d{6,}[A-Z0-9]*\b")
_TXN_PREFIX = re.compile(
    r"^(?:NFT|NEFT|IMPS|RTGS|UPIOUT|UPI\s*IN|TO\s+ECM|POS|ACHDR|INTL\.?\s*ECM\s*MRK)\b[/ :-]*",
    re.IGNORECASE,
)

# Known merchants → friendly display names (checked against the cleaned lowercase label)
_PRETTY_RULES: list[tuple[str, str]] = [
    ("digital gold", "Digital Gold"),
    ("indian clearing", "Indian Clearing Corp (MF)"),
    ("appleservices", "Apple Services"),
    ("cursor", "Cursor"),
    ("spotify", "Spotify"),
    ("netflix", "Netflix"),
    ("swiggy", "Swiggy"),
    ("zomato", "Zomato"),
    ("myntra", "Myntra"),
    ("amazon", "Amazon"),
    ("makemytrip", "MakeMyTrip"),
    ("redbus", "Redbus"),
    ("groww", "Groww"),
    ("indmoney", "INDmoney"),
    ("indstocks", "INDmoney (INDstocks)"),
    ("finzoomers", "INDmoney"),
]


def _clean_merchant_label(name: str | None) -> str:
    """Collapse statement narrations into a stable merchant label."""
    s = re.sub(r"\s+", " ", (name or "").replace("\n", " ")).strip()
    if not s:
        return "Unknown"
    s = _TXN_PREFIX.sub("", s)

    # UPI VPAs: keep only the handle and repair OCR spaces inside it
    if "@" in s:
        for segment in s.split("/"):
            if "@" in segment:
                s = re.sub(r"\s+", "", segment)
                break

    s = _REF_RUN.sub("", s)
    s = re.sub(r"[/\\]+[A-Za-z]{0,2}$", "", s)  # trailing "/S", "//" remnants
    s = re.sub(r"\s+", " ", s).strip(" /\\-_.,")
    if not s:
        return "Unknown"

    lower = s.lower()
    for keyword, pretty in _PRETTY_RULES:
        if keyword in lower:
            return pretty
    return s


def _instrument_for(merchant: str | None, raw_text: str | None) -> tuple[str, str]:
    """Return (instrument name, asset class) for an investment transaction."""
    blob = f"{merchant or ''} {raw_text or ''}".lower().replace("\n", " ")
    for keyword, instrument, asset_class in INSTRUMENT_RULES:
        if keyword in blob:
            return instrument, asset_class
    label = _clean_merchant_label(merchant)
    return label, "Other Investments"


# Debits that move money but are not lifestyle consumption
NON_LIFESTYLE_CATEGORIES = frozenset({"Transfers", "Investments", "Income"})


def _match_range(
    date_from: datetime | None,
    date_to: datetime | None,
    banks: list[str] | None = None,
    categories: list[str] | None = None,
) -> dict[str, Any]:
    match: dict[str, Any] = {}
    if date_from or date_to:
        received: dict[str, Any] = {}
        if date_from:
            received["$gte"] = date_from
        if date_to:
            received["$lte"] = date_to
        match["received_at"] = received
    if banks:
        match["bank"] = {"$in": banks}
    if categories:
        match["category"] = {"$in": categories}
    return match


def _dc_group(field: str) -> dict[str, Any]:
    return {
        "$group": {
            "_id": f"${field}",
            "debit": {"$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}},
            "credit": {"$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}},
            "count": {"$sum": 1},
        }
    }


def _rows_from_group(rows: list[dict[str, Any]], total_debit: float) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        debit = float(r.get("debit") or 0)
        credit = float(r.get("credit") or 0)
        out.append(
            {
                "name": str(r["_id"] or "Unknown"),
                "debit": debit,
                "credit": credit,
                "net": credit - debit,
                "count": int(r.get("count") or 0),
                "debit_share": round(debit / total_debit * 100, 1) if total_debit else 0.0,
            }
        )
    return out


def build_analytics(
    transactions: Collection,
    *,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    banks: list[str] | None = None,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
) -> dict[str, Any]:
    match = _match_range(date_from, date_to, banks=banks)
    base = [{"$match": match}] if match else []

    # Totals
    totals_rows = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": "$type",
                        "total": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                        "avg": {"$avg": "$amount"},
                        "max": {"$max": "$amount"},
                    }
                }
            ]
        )
    )
    by_type = {r["_id"]: r for r in totals_rows}
    debit = by_type.get("debit", {})
    credit = by_type.get("credit", {})
    total_debit = float(debit.get("total") or 0)
    total_credit = float(credit.get("total") or 0)
    debit_count = int(debit.get("count") or 0)
    credit_count = int(credit.get("count") or 0)

    def group_breakdown(field: str) -> list[dict[str, Any]]:
        rows = list(
            transactions.aggregate(base + [_dc_group(field), {"$sort": {"debit": -1}}])
        )
        return _rows_from_group(rows, total_debit)

    # Monthly cashflow
    monthly = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {"format": "%Y-%m", "date": "$received_at"}
                        },
                        "debit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}
                        },
                        "credit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    monthly_rows = []
    running = 0.0
    for r in monthly:
        if not r.get("_id"):
            continue
        d = float(r.get("debit") or 0)
        c = float(r.get("credit") or 0)
        running += c - d
        monthly_rows.append(
            {
                "month": r["_id"],
                "debit": d,
                "credit": c,
                "net": c - d,
                "count": int(r.get("count") or 0),
                "running_net": round(running, 2),
            }
        )

    # Daily
    daily = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {"format": "%Y-%m-%d", "date": "$received_at"}
                        },
                        "debit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}
                        },
                        "credit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    daily_rows = [
        {
            "date": r["_id"],
            "debit": float(r.get("debit") or 0),
            "credit": float(r.get("credit") or 0),
            "net": float(r.get("credit") or 0) - float(r.get("debit") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in daily
        if r.get("_id")
    ]

    # Weekday
    weekday_map = {
        1: "Sun",
        2: "Mon",
        3: "Tue",
        4: "Wed",
        5: "Thu",
        6: "Fri",
        7: "Sat",
    }
    weekday = list(
        transactions.aggregate(
            base
            + [
                {"$match": {"type": "debit"}},
                {
                    "$group": {
                        "_id": {"$dayOfWeek": "$received_at"},
                        "amount": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    weekday_rows = [
        {
            "day": weekday_map.get(int(r["_id"]), str(r["_id"])),
            "dow": int(r["_id"]),
            "amount": float(r.get("amount") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in weekday
        if r.get("_id") is not None
    ]

    # Day of month heatmap (1-31)
    dom = list(
        transactions.aggregate(
            base
            + [
                {"$match": {"type": "debit"}},
                {
                    "$group": {
                        "_id": {"$dayOfMonth": "$received_at"},
                        "amount": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    day_of_month = [
        {
            "day": int(r["_id"]),
            "amount": float(r.get("amount") or 0),
            "count": int(r.get("count") or 0),
        }
        for r in dom
        if r.get("_id") is not None
    ]

    # Category × month (for stacked area)
    cat_month = list(
        transactions.aggregate(
            base
            + [
                {"$match": {"type": "debit"}},
                {
                    "$group": {
                        "_id": {
                            "month": {
                                "$dateToString": {
                                    "format": "%Y-%m",
                                    "date": "$received_at",
                                }
                            },
                            "category": {"$ifNull": ["$category", "Other"]},
                        },
                        "amount": {"$sum": "$amount"},
                        "count": {"$sum": 1},
                    }
                },
            ]
        )
    )
    category_monthly: dict[str, dict[str, float]] = defaultdict(dict)
    for r in cat_month:
        key = r.get("_id") or {}
        month = key.get("month")
        cat = key.get("category") or "Other"
        if month:
            category_monthly[month][cat] = float(r.get("amount") or 0)
    category_monthly_rows = [
        {"month": m, **vals} for m, vals in sorted(category_monthly.items())
    ]

    # Bank (source) × month
    bank_month = list(
        transactions.aggregate(
            base
            + [
                {
                    "$group": {
                        "_id": {
                            "month": {
                                "$dateToString": {
                                    "format": "%Y-%m",
                                    "date": "$received_at",
                                }
                            },
                            "bank": {"$ifNull": ["$bank", "Unknown"]},
                        },
                        "debit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}
                        },
                        "credit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}
                        },
                        "count": {"$sum": 1},
                    }
                },
            ]
        )
    )
    source_monthly = []
    for r in bank_month:
        key = r.get("_id") or {}
        month = key.get("month")
        bank = key.get("bank") or "Unknown"
        if not month:
            continue
        d = float(r.get("debit") or 0)
        c = float(r.get("credit") or 0)
        source_monthly.append(
            {
                "month": month,
                "source": bank,
                "debit": d,
                "credit": c,
                "net": c - d,
                "count": int(r.get("count") or 0),
            }
        )
    source_monthly.sort(key=lambda x: (x["month"], x["source"]))

    # Merchants + recurring, grouped by normalized label so statement
    # reference numbers don't split one merchant into many
    merchant_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"amount": 0.0, "count": 0.0}
    )
    for doc in transactions.find(
        {**match, "type": "debit", "merchant": {"$nin": [None, ""]}},
        {"merchant": 1, "amount": 1},
    ):
        label = _clean_merchant_label(doc.get("merchant"))
        merchant_totals[label]["amount"] += float(doc.get("amount") or 0)
        merchant_totals[label]["count"] += 1

    merchant_sorted = sorted(
        merchant_totals.items(), key=lambda kv: -kv[1]["amount"]
    )
    merchant_rows = [
        {
            "merchant": name,
            "amount": vals["amount"],
            "count": int(vals["count"]),
            "avg": round(vals["amount"] / max(vals["count"], 1), 2),
            "share": round(vals["amount"] / total_debit * 100, 1) if total_debit else 0.0,
        }
        for name, vals in merchant_sorted[:15]
    ]

    # Recurring vs one-time (merchant appears ≥3 times = recurring)
    recurring_amount = 0.0
    onetime_amount = 0.0
    recurring_merchants = []
    for name, vals in merchant_sorted:
        amt = vals["amount"]
        cnt = int(vals["count"])
        if cnt >= 3:
            recurring_amount += amt
            recurring_merchants.append(
                {
                    "merchant": name,
                    "amount": amt,
                    "count": cnt,
                    "avg": round(amt / cnt, 2),
                }
            )
        else:
            onetime_amount += amt
    recurring_merchants.sort(key=lambda x: -x["amount"])

    # Account balances (latest non-null balance per bank+last4)
    bal_pipeline = [
        {"$match": {"balance": {"$ne": None}}},
        {"$sort": {"received_at": -1}},
        {
            "$group": {
                "_id": {
                    "bank": {"$ifNull": ["$bank", "Unknown"]},
                    "last4": {"$ifNull": ["$account_last4", "????"]},
                },
                "balance": {"$first": "$balance"},
                "as_of": {"$first": "$received_at"},
            }
        },
    ]
    accounts = []
    for r in transactions.aggregate(bal_pipeline):
        key = r.get("_id") or {}
        as_of = r.get("as_of")
        bank = str(key.get("bank") or "Unknown")
        last4 = str(key.get("last4") or "????")
        incomplete = bank.lower() == "unknown" or last4 in {"????", "", "none", "null"}
        accounts.append(
            {
                "bank": bank,
                "account_last4": last4,
                "balance": float(r.get("balance") or 0),
                "as_of": as_of.isoformat() if isinstance(as_of, datetime) else None,
                "source": "sms",
                "incomplete": incomplete,
                "note": (
                    "Last balance from SMS — may be incomplete or stale"
                    if incomplete
                    else "Last balance parsed from SMS"
                ),
            }
        )
    accounts.sort(key=lambda x: -x["balance"])
    sms_liquid_total = sum(a["balance"] for a in accounts)
    liquid_total = sms_liquid_total
    liquid_source = "sms"

    # Investments inferred — group by canonical instrument, not raw narration
    inv_match = {**match, "category": "Investments"}
    inv_base = [{"$match": inv_match}]
    instrument_totals: dict[str, dict[str, Any]] = {}
    for doc in transactions.find(
        {**inv_match, "type": "debit"}, {"merchant": 1, "raw_text": 1, "amount": 1}
    ):
        instrument, asset_class = _instrument_for(doc.get("merchant"), doc.get("raw_text"))
        bucket = instrument_totals.setdefault(
            instrument,
            {"asset_class": asset_class, "invested": 0.0, "count": 0},
        )
        bucket["invested"] += float(doc.get("amount") or 0)
        bucket["count"] += 1

    inv_monthly = list(
        transactions.aggregate(
            inv_base
            + [
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {"format": "%Y-%m", "date": "$received_at"}
                        },
                        "invested": {
                            "$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}
                        },
                        "returned": {
                            "$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}
                        },
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    total_invested = sum(v["invested"] for v in instrument_totals.values())
    # Inferred holdings from transactions (cost basis, P&L 0)
    holdings = [
        {
            "name": name,
            "asset_class": vals["asset_class"],
            "invested": vals["invested"],
            "current_value": vals["invested"],
            "pnl": 0.0,
            "pnl_pct": 0.0,
            "count": vals["count"],
        }
        for name, vals in sorted(
            instrument_totals.items(), key=lambda kv: -kv[1]["invested"]
        )
    ]
    total_current = total_invested
    total_pnl = 0.0
    inv_note = "Current value equals cost basis until you add market prices."

    # If a manual portfolio exists (market values from broker apps), it wins
    if portfolio is not None:
        manual = list(portfolio.find())
        if manual:
            holdings = []
            for doc in manual:
                invested = float(doc.get("invested") or 0)
                current = float(doc.get("current_value") or 0)
                pnl = current - invested
                holdings.append(
                    {
                        "name": str(doc.get("name") or "Unknown"),
                        "asset_class": str(doc.get("asset_class") or "Other Investments"),
                        "invested": invested,
                        "current_value": current,
                        "pnl": round(pnl, 2),
                        "pnl_pct": round(pnl / invested * 100, 2) if invested else 0.0,
                        "count": 0,
                    }
                )
            holdings.sort(key=lambda h: -h["current_value"])
            total_invested = sum(h["invested"] for h in holdings)
            total_current = sum(h["current_value"] for h in holdings)
            total_pnl = round(total_current - total_invested, 2)
            inv_note = "Market values from your portfolio — update them on this page."

    by_asset: dict[str, float] = defaultdict(float)
    for h in holdings:
        by_asset[h["asset_class"]] += h["current_value"]
    asset_allocation = [
        {"name": k, "value": v} for k, v in sorted(by_asset.items(), key=lambda x: -x[1])
    ]
    inv_monthly_rows = []
    inv_running = 0.0
    for r in inv_monthly:
        if not r.get("_id"):
            continue
        invested = float(r.get("invested") or 0)
        returned = float(r.get("returned") or 0)
        inv_running += invested - returned
        inv_monthly_rows.append(
            {
                "month": r["_id"],
                "invested": invested,
                "returned": returned,
                "cumulative": round(inv_running, 2),
            }
        )

    # Income sources (credits by normalized merchant)
    income_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"amount": 0.0, "count": 0.0}
    )
    for doc in transactions.find(
        {**match, "type": "credit"}, {"merchant": 1, "category": 1, "amount": 1}
    ):
        label = _clean_merchant_label(doc.get("merchant")) if doc.get("merchant") else str(
            doc.get("category") or "Other income"
        )
        income_totals[label]["amount"] += float(doc.get("amount") or 0)
        income_totals[label]["count"] += 1
    income_rows = [
        {"name": name, "amount": vals["amount"], "count": int(vals["count"])}
        for name, vals in sorted(income_totals.items(), key=lambda kv: -kv[1]["amount"])[:12]
    ]

    by_category = group_breakdown("category")
    transfers_debit = next(
        (float(r["debit"]) for r in by_category if r.get("name") == "Transfers"), 0.0
    )
    investments_debit = next(
        (float(r["debit"]) for r in by_category if r.get("name") == "Investments"), 0.0
    )
    lifestyle_rows = [
        r
        for r in by_category
        if r.get("name") not in NON_LIFESTYLE_CATEGORIES and float(r.get("debit") or 0) > 0
    ]
    lifestyle_spend = round(sum(float(r["debit"]) for r in lifestyle_rows), 2)
    lifestyle_category_monthly = []
    for row in category_monthly_rows:
        filtered = {"month": row["month"]}
        for k, v in row.items():
            if k == "month" or k in NON_LIFESTYLE_CATEGORIES:
                continue
            filtered[k] = v
        lifestyle_category_monthly.append(filtered)

    # Alerts / insights
    alerts = _build_alerts(
        transactions,
        match,
        total_debit=total_debit,
        debit_count=debit_count,
        avg_debit=float(debit.get("avg") or 0),
        by_category=by_category,
        recurring_merchants=recurring_merchants[:8],
        monthly_rows=monthly_rows,
        total_credit=total_credit,
        total_invested=total_invested,
    )

    # MoM change for KPIs
    mom = _mom_change(monthly_rows)

    active_days = len(daily_rows)
    # Always expose full bank list for the filter UI (unscoped)
    banks_list = sorted(
        {
            str(doc.get("bank") or "Unknown")
            for doc in transactions.find({}, {"bank": 1})
        }
    )

    net_worth_estimate = liquid_total + total_current
    indmoney_snapshot = None
    if networth_snapshots is not None:
        try:
            snap = networth_snapshots.find_one(sort=[("captured_at", -1)])
            if snap:
                indmoney_snapshot = {
                    "total_networth": float(snap.get("total_networth") or 0),
                    "total_invested": float(snap.get("total_invested") or 0),
                    "total_current_value": float(snap.get("total_current_value") or 0),
                    "liabilities": float((snap.get("liabilities") or 0) if not isinstance(snap.get("liabilities"), dict) else (snap.get("liabilities") or {}).get("total") or 0),
                    "captured_at": snap.get("captured_at").isoformat()
                    if isinstance(snap.get("captured_at"), datetime)
                    else snap.get("captured_at"),
                    "source": snap.get("source"),
                }
                if indmoney_snapshot["total_networth"] > 0:
                    net_worth_estimate = indmoney_snapshot["total_networth"]
                # Prefer savings/liquid from snapshot investments SA bucket if present
                for row in snap.get("investments") or []:
                    if row.get("asset_type") == "SA":
                        liquid_total = float(row.get("current_value") or liquid_total)
                        liquid_source = "indmoney"
                        break
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load networth snapshot: {exc}")

    return {
        "range": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
        "overview": {
            "total_debit": total_debit,
            "total_credit": total_credit,
            "net": total_credit - total_debit,
            "count": debit_count + credit_count,
            "debit_count": debit_count,
            "credit_count": credit_count,
            "avg_debit": round(float(debit.get("avg") or 0), 2),
            "avg_credit": round(float(credit.get("avg") or 0), 2),
            "max_debit": float(debit.get("max") or 0),
            "max_credit": float(credit.get("max") or 0),
            "active_days": active_days,
            "avg_daily_debit": round(total_debit / active_days, 2) if active_days else 0.0,
            "lifestyle_spend": lifestyle_spend,
            "transfers_debit": round(transfers_debit, 2),
            "investments_debit": round(investments_debit, 2),
            "avg_daily_lifestyle": round(lifestyle_spend / active_days, 2)
            if active_days
            else 0.0,
            "liquid_total": liquid_total,
            "sms_liquid_total": round(sms_liquid_total, 2),
            "liquid_source": liquid_source,
            "total_invested": total_invested,
            "net_worth_estimate": net_worth_estimate,
            "investment_to_income": round(total_invested / total_credit * 100, 1)
            if total_credit
            else 0.0,
        },
        "indmoney_snapshot": indmoney_snapshot,
        "mom": mom,
        "monthly": monthly_rows,
        "daily": daily_rows,
        "weekday": weekday_rows,
        "day_of_month": day_of_month,
        "by_bank": group_breakdown("bank"),
        "by_card_type": group_breakdown("card_type"),
        "by_source": group_breakdown("source"),
        "by_category": by_category,
        "by_category_lifestyle": lifestyle_rows,
        "category_monthly": category_monthly_rows,
        "lifestyle_category_monthly": lifestyle_category_monthly,
        "source_monthly": source_monthly,
        "merchants": merchant_rows,
        "recurring": {
            "recurring_amount": recurring_amount,
            "onetime_amount": onetime_amount,
            "merchants": recurring_merchants[:15],
        },
        "accounts": accounts,
        "income_sources": income_rows,
        "investments": {
            "total_invested": total_invested,
            "total_current": total_current,
            "pnl": total_pnl,
            "holdings": holdings,
            "asset_allocation": asset_allocation,
            "monthly": inv_monthly_rows,
            "note": inv_note,
        },
        "alerts": alerts,
        "filters": {"banks": banks_list},
    }


def _mom_change(monthly_rows: list[dict[str, Any]]) -> dict[str, Any]:
    if len(monthly_rows) < 2:
        return {
            "net_pct": None,
            "debit_pct": None,
            "credit_pct": None,
            "savings_pct": None,
        }

    cur = monthly_rows[-1]
    prev = monthly_rows[-2]

    def pct(a: float, b: float) -> Optional[float]:
        if b == 0:
            return None if a == 0 else 100.0
        return round((a - b) / abs(b) * 100, 1)

    return {
        "net_pct": pct(cur["net"], prev["net"]),
        "debit_pct": pct(cur["debit"], prev["debit"]),
        "credit_pct": pct(cur["credit"], prev["credit"]),
        "savings_pct": pct(cur["net"], prev["net"]),
        "current_month": cur["month"],
        "previous_month": prev["month"],
        "current_net": cur["net"],
        "current_debit": cur["debit"],
        "current_credit": cur["credit"],
    }


def _build_alerts(
    transactions: Collection,
    match: dict[str, Any],
    *,
    total_debit: float,
    debit_count: int,
    avg_debit: float,
    by_category: list[dict[str, Any]],
    recurring_merchants: list[dict[str, Any]],
    monthly_rows: list[dict[str, Any]],
    total_credit: float,
    total_invested: float,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    # Budget vs actual — soft defaults for expense categories
    default_budgets = {
        "Food & Dining": 8000,
        "Shopping": 10000,
        "Subscriptions": 3000,
        "Travel & Transport": 5000,
        "Groceries": 6000,
        "Entertainment": 3000,
    }
    cat_map = {r["name"]: r["debit"] for r in by_category}
    for cat, budget in default_budgets.items():
        actual = cat_map.get(cat, 0)
        if actual <= 0 and budget:
            continue
        pct = round(actual / budget * 100, 1) if budget else 0
        alerts.append(
            {
                "type": "budget",
                "severity": "warning" if pct >= 90 else "info",
                "title": f"{cat} budget",
                "message": f"Spent ₹{actual:,.0f} of ₹{budget:,.0f} ({pct}%)",
                "category": cat,
                "budget": budget,
                "actual": actual,
                "pct": pct,
            }
        )

    # Unusual spends (> 3× average debit)
    if avg_debit > 0:
        threshold = avg_debit * 3
        unusual = list(
            transactions.find(
                {**match, "type": "debit", "amount": {"$gte": threshold}},
                {"amount": 1, "merchant": 1, "received_at": 1, "category": 1},
            )
            .sort("amount", -1)
            .limit(5)
        )
        for u in unusual:
            merch = u.get("merchant") or "Unknown"
            amt = float(u.get("amount") or 0)
            alerts.append(
                {
                    "type": "anomaly",
                    "severity": "alert",
                    "title": "Unusual spend",
                    "message": f"{merch}: ₹{amt:,.0f} (avg debit ₹{avg_debit:,.0f})",
                    "amount": amt,
                    "merchant": merch,
                }
            )

    # Subscription renewals (recurring in Subscriptions / Entertainment)
    for m in recurring_merchants:
        name = m["merchant"]
        lower = name.lower()
        if any(
            k in lower
            for k in (
                "spotify",
                "netflix",
                "apple",
                "cursor",
                "prime",
                "youtube",
                "adobe",
                "icloud",
            )
        ) or m["count"] >= 4:
            alerts.append(
                {
                    "type": "subscription",
                    "severity": "info",
                    "title": "Recurring charge",
                    "message": f"{name}: ~₹{m['avg']:,.0f} × {m['count']} times",
                    "merchant": name,
                    "avg": m["avg"],
                    "count": m["count"],
                }
            )

    # MoM spend spike
    if len(monthly_rows) >= 2:
        cur = monthly_rows[-1]["debit"]
        prev = monthly_rows[-2]["debit"]
        if prev > 0 and cur > prev * 1.25:
            alerts.append(
                {
                    "type": "trend",
                    "severity": "warning",
                    "title": "Spend up month-over-month",
                    "message": f"Debits rose {((cur - prev) / prev * 100):.0f}% vs previous month",
                }
            )

    if total_credit > 0 and total_invested / total_credit < 0.1:
        alerts.append(
            {
                "type": "insight",
                "severity": "info",
                "title": "Low investment rate",
                "message": f"Only {total_invested / total_credit * 100:.0f}% of income went to investments",
            }
        )

    # Cap and stamp
    for a in alerts:
        a.setdefault("created_at", now.isoformat())
    return alerts[:20]
