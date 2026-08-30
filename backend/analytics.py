"""Analytics aggregations for the premium dashboard modules."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from merchant_label import clean_merchant_label, is_salary_source
from parser import credit_card_noise_mongo_clause
from cc_payment_pairing import cc_payoff_lifestyle_exclusion

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


def _clean_merchant_label(name: str | None, raw_text: str | None = None) -> str:
    """Collapse statement narrations into a stable merchant label."""
    return clean_merchant_label(name, fallback=raw_text)


def _instrument_for(merchant: str | None, raw_text: str | None) -> tuple[str, str]:
    """Return (instrument name, asset class) for an investment transaction."""
    blob = f"{merchant or ''} {raw_text or ''}".lower().replace("\n", " ")
    for keyword, instrument, asset_class in INSTRUMENT_RULES:
        if keyword in blob:
            return instrument, asset_class
    label = _clean_merchant_label(merchant, raw_text)
    return label, "Other Investments"


# Debits that move money but are not lifestyle consumption
NON_LIFESTYLE_CATEGORIES = frozenset({"Transfers", "Investments", "Income"})


def _match_range(
    date_from: datetime | None,
    date_to: datetime | None,
    banks: list[str] | None = None,
    categories: list[str] | None = None,
    user_id: Any = None,
) -> dict[str, Any]:
    # Wallet/FASTag debits are excluded from all money totals — the bank was
    # already debited at recharge time, counting the wallet spend double-counts.
    # CC statement / payment-received SMS mis-ingested as spend are also excluded
    # until an approved backfill removes them.
    match: dict[str, Any] = {"card_type": {"$ne": "wallet"}, **credit_card_noise_mongo_clause()}
    if user_id is not None:
        match["user_id"] = user_id
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
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    learned_facts: Collection | None = None,
    user_id: Any = None,
    lite: bool = False,
) -> dict[str, Any]:
    match = _match_range(date_from, date_to, banks=banks, user_id=user_id)
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
                            "$dateToString": {
                                "format": "%Y-%m",
                                "date": "$received_at",
                                "timezone": "Asia/Kolkata",
                            }
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
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": "$received_at",
                                "timezone": "Asia/Kolkata",
                            }
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

    # Weekday / day-of-month — skip on lite (charts don't use them)
    weekday_rows: list[dict[str, Any]] = []
    day_of_month: list[dict[str, Any]] = []
    if not lite:
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
                                    "timezone": "Asia/Kolkata",
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
                                    "timezone": "Asia/Kolkata",
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
    merchant_rows: list[dict[str, Any]] = []
    recurring_amount = 0.0
    onetime_amount = 0.0
    recurring_merchants: list[dict[str, Any]] = []
    if not lite:
        merchant_totals: dict[str, dict[str, float]] = defaultdict(
            lambda: {"amount": 0.0, "count": 0.0}
        )
        for doc in transactions.find(
            {**match, "type": "debit", "merchant": {"$nin": [None, ""]}},
            {"merchant": 1, "raw_text": 1, "amount": 1},
        ):
            label = _clean_merchant_label(doc.get("merchant"), doc.get("raw_text"))
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

    # Investments — prefer manual portfolio; only scan SMS invests when needed
    inv_match = {**match, "category": "Investments"}
    inv_base = [{"$match": inv_match}]
    holdings: list[dict[str, Any]] = []
    total_invested = 0.0
    total_current = 0.0
    total_pnl = 0.0
    inv_note = "Current value equals cost basis until you add market prices."
    inv_monthly_rows: list[dict[str, Any]] = []

    manual: list[dict[str, Any]] = []
    if portfolio is not None:
        try:
            manual = list(portfolio.find())
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load portfolio: {exc}")
            manual = []

    if manual:
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
    else:
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
        total_invested = sum(v["invested"] for v in instrument_totals.values())
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

    if not lite or not manual:
        inv_monthly = list(
            transactions.aggregate(
                inv_base
                + [
                    {
                        "$group": {
                            "_id": {
                                "$dateToString": {
                                    "format": "%Y-%m",
                                    "date": "$received_at",
                                    "timezone": "Asia/Kolkata",
                                }
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

    by_asset: dict[str, float] = defaultdict(float)
    for h in holdings:
        by_asset[h["asset_class"]] += h["current_value"]
    asset_allocation = [
        {"name": k, "value": v} for k, v in sorted(by_asset.items(), key=lambda x: -x[1])
    ]

    # Income sources (credits by normalized merchant)
    income_rows: list[dict[str, Any]] = []
    salary_total = 0.0
    salary_count = 0
    salary_needles: list[str] = []
    if learned_facts is not None:
        try:
            from learned_facts import salary_needles_from_facts

            salary_needles = salary_needles_from_facts(learned_facts)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load salary keywords: {exc}")
    if not lite:
        income_totals: dict[str, dict[str, float]] = defaultdict(
            lambda: {"amount": 0.0, "count": 0.0, "salary": 0.0}
        )
        for doc in transactions.find(
            {**match, "type": "credit"},
            {"merchant": 1, "raw_text": 1, "category": 1, "amount": 1},
        ):
            label = (
                _clean_merchant_label(doc.get("merchant"), doc.get("raw_text"))
                if doc.get("merchant")
                else str(doc.get("category") or "Other income")
            )
            amount = float(doc.get("amount") or 0)
            income_totals[label]["amount"] += amount
            income_totals[label]["count"] += 1
            if is_salary_source(
                label, doc.get("merchant"), doc.get("raw_text"), extra_needles=salary_needles
            ):
                income_totals[label]["salary"] = 1.0
                salary_total += amount
                salary_count += 1
        income_rows = [
            {
                "name": name,
                "amount": vals["amount"],
                "count": int(vals["count"]),
                "is_salary": bool(vals["salary"]),
            }
            for name, vals in sorted(income_totals.items(), key=lambda kv: -kv[1]["amount"])[:12]
        ]
        salary_total = round(salary_total, 2)
    other_income_total = round(total_credit - salary_total, 2)

    by_category = group_breakdown("category")
    by_card_type = group_breakdown("card_type")
    transfers_debit = next(
        (float(r["debit"]) for r in by_category if r.get("name") == "Transfers"), 0.0
    )
    investments_debit = next(
        (float(r["debit"]) for r in by_category if r.get("name") == "Investments"), 0.0
    )
    credit_card_spend = next(
        (float(r["debit"]) for r in by_card_type if r.get("name") == "credit_card"), 0.0
    )
    upi_spend = next(
        (float(r["debit"]) for r in by_card_type if r.get("name") == "upi"), 0.0
    )
    debit_card_spend = next(
        (float(r["debit"]) for r in by_card_type if r.get("name") == "debit_card"), 0.0
    )
    bank_account_spend = next(
        (float(r["debit"]) for r in by_card_type if r.get("name") == "bank_account"), 0.0
    )

    # Credit-card purchases (merchants) — kept separate from bank/UPI lifestyle
    credit_card_merchants: list[dict[str, Any]] = []
    cc_count = 0
    if not lite:
        cc_merchants: dict[str, dict[str, float]] = defaultdict(
            lambda: {"amount": 0.0, "count": 0.0}
        )
        for doc in transactions.find(
            {**match, "type": "debit", "card_type": "credit_card"},
            {"merchant": 1, "raw_text": 1, "amount": 1, "category": 1},
        ):
            label = _clean_merchant_label(doc.get("merchant"), doc.get("raw_text"))
            amt = float(doc.get("amount") or 0)
            cc_merchants[label]["amount"] += amt
            cc_merchants[label]["count"] += 1
            cc_count += 1
        credit_card_merchants = [
            {
                "merchant": name,
                "amount": round(vals["amount"], 2),
                "count": int(vals["count"]),
                "share": round(vals["amount"] / credit_card_spend * 100, 1)
                if credit_card_spend
                else 0.0,
            }
            for name, vals in sorted(cc_merchants.items(), key=lambda kv: -kv[1]["amount"])[:15]
        ]
    else:
        cc_count = int(
            next(
                (r.get("count") for r in by_card_type if r.get("name") == "credit_card"),
                0,
            )
            or 0
        )

    # Lifestyle excludes Transfers/Investments/Income AND paired bank→card payoffs
    lifestyle_match = {**match, **cc_payoff_lifestyle_exclusion()}
    lifestyle_base = [{"$match": lifestyle_match}]
    lifestyle_by_cat = list(
        transactions.aggregate(lifestyle_base + [_dc_group("category"), {"$sort": {"debit": -1}}])
    )
    lifestyle_cat_rows = _rows_from_group(lifestyle_by_cat, total_debit)
    lifestyle_rows = [
        r
        for r in lifestyle_cat_rows
        if r.get("name") not in NON_LIFESTYLE_CATEGORIES and float(r.get("debit") or 0) > 0
    ]
    lifestyle_spend = round(sum(float(r["debit"]) for r in lifestyle_rows), 2)
    # Bank/UPI lifestyle = total lifestyle minus credit-card purchases (so card spend stays separate)
    bank_upi_spend = round(max(lifestyle_spend - credit_card_spend, 0.0), 2)

    # Paired payoff totals (informational — still in total_debit, not in lifestyle)
    payoff_agg = list(
        transactions.aggregate(
            [
                {"$match": {**match, "type": "debit", "cc_payoff": True}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
            ]
        )
    )
    cc_payoff_total = float((payoff_agg[0] if payoff_agg else {}).get("total") or 0)
    cc_payoff_count = int((payoff_agg[0] if payoff_agg else {}).get("count") or 0)
    ambiguous_payoffs = (
        0
        if lite
        else transactions.count_documents(
            {**match, "type": "debit", "cc_payoff_status": "ambiguous"}
        )
    )

    lifestyle_category_monthly = []
    for row in category_monthly_rows:
        filtered = {"month": row["month"]}
        for k, v in row.items():
            if k == "month" or k in NON_LIFESTYLE_CATEGORIES:
                continue
            filtered[k] = v
        lifestyle_category_monthly.append(filtered)

    # Wallet / FASTag spends — informational only, excluded from all totals above
    wallet_total = 0.0
    wallet_count = 0
    wallet_recent: list[dict[str, Any]] = []
    if not lite:
        wallet_match = {**match, "card_type": "wallet"}
        for doc in (
            transactions.find(
                {**wallet_match, "type": "debit"},
                {"merchant": 1, "raw_text": 1, "amount": 1, "received_at": 1},
            )
            .sort("received_at", -1)
            .limit(200)
        ):
            amt = float(doc.get("amount") or 0)
            wallet_total += amt
            wallet_count += 1
            if len(wallet_recent) < 10:
                ts = doc.get("received_at")
                wallet_recent.append(
                    {
                        "merchant": _clean_merchant_label(doc.get("merchant"), doc.get("raw_text")),
                        "amount": amt,
                        "received_at": ts.isoformat() if isinstance(ts, datetime) else None,
                    }
                )

    # MoM change for KPIs
    mom = _mom_change(monthly_rows)

    active_days = len(daily_rows)
    # Bank filter list — distinct is far cheaper than scanning every doc
    bank_q: dict[str, Any] = {}
    if user_id is not None:
        bank_q["user_id"] = user_id
    try:
        banks_list = sorted(
            str(b) for b in transactions.distinct("bank", bank_q) if b
        )
    except Exception:  # noqa: BLE001
        banks_list = sorted(
            {
                str(doc.get("bank") or "Unknown")
                for doc in transactions.find(bank_q, {"bank": 1})
            }
        )

    net_worth_estimate = liquid_total + total_current
    liabilities_total = 0.0
    liability_rows: list[dict[str, Any]] = []
    if liabilities is not None:
        try:
            for doc in liabilities.find().sort("outstanding", -1):
                amt = float(doc.get("outstanding") or 0)
                liabilities_total += amt
                updated = doc.get("updated_at") or doc.get("last_updated")
                liability_rows.append(
                    {
                        "id": str(doc["_id"]),
                        "name": str(doc.get("name") or "Liability"),
                        "type": str(doc.get("type") or "other"),
                        "outstanding": amt,
                        "due_date": doc.get("due_date"),
                        "available_limit": float(doc["available_limit"])
                        if doc.get("available_limit") is not None
                        else None,
                        "source": doc.get("source") or "manual",
                        "bank": doc.get("bank"),
                        "last4": doc.get("last4"),
                        "updated_at": updated.isoformat()
                        if isinstance(updated, datetime)
                        else updated,
                    }
                )
            liabilities_total = round(liabilities_total, 2)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load liabilities: {exc}")

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
                    # Prefer INDmoney assets, then subtract manual liabilities if tracked
                    net_worth_estimate = indmoney_snapshot["total_networth"]
                # Prefer savings/liquid from snapshot investments SA bucket if present
                for row in snap.get("investments") or []:
                    if row.get("asset_type") == "SA":
                        liquid_total = float(row.get("current_value") or liquid_total)
                        liquid_source = "indmoney"
                        break
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load networth snapshot: {exc}")

    # Assets − liabilities (manual liabilities always reduce displayed net worth)
    assets_total = round(liquid_total + total_current, 2)
    if liabilities_total > 0:
        if indmoney_snapshot and indmoney_snapshot.get("total_networth"):
            # INDmoney NW already nets its own liabilities; only subtract manual app liabilities
            # (exclude SMS-synced credit_cards rows that are often already in INDmoney).
            manual_only = round(
                sum(
                    float(r.get("outstanding") or 0)
                    for r in liability_rows
                    if (r.get("source") or "manual") == "manual"
                ),
                2,
            )
            net_worth_estimate = round(float(indmoney_snapshot["total_networth"]) - manual_only, 2)
        else:
            net_worth_estimate = round(assets_total - liabilities_total, 2)

    budget_map: dict[str, float] = {}
    if budgets is not None:
        try:
            for doc in budgets.find():
                cat = str(doc.get("category") or "").strip()
                amt = float(doc.get("amount") or 0)
                if cat and amt > 0:
                    budget_map[cat] = amt
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load budgets: {exc}")

    one_off_fps: set[str] = set()
    income_profile: dict[str, Any] = {}
    if learned_facts is not None:
        try:
            from learned_facts import (
                budget_targets_from_facts,
                income_profile_from_facts,
                one_off_fingerprints,
            )

            # Learned budget targets fill gaps; explicit budgets_col wins on conflict
            learned_budgets = budget_targets_from_facts(learned_facts)
            for cat, amt in learned_budgets.items():
                budget_map.setdefault(cat, amt)
            one_off_fps = one_off_fingerprints(learned_facts)
            income_profile = income_profile_from_facts(learned_facts)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not load learned facts for analytics: {exc}")

    # Freshness timestamps
    freshness: dict[str, Any] = {
        "last_sms_at": None,
        "last_statement_at": None,
        "last_portfolio_at": None,
        "last_indmoney_at": indmoney_snapshot.get("captured_at") if indmoney_snapshot else None,
    }
    if not lite:
        try:
            sms_doc = transactions.find_one(
                {"source": "sms"}, sort=[("received_at", -1)], projection={"received_at": 1}
            )
            if sms_doc and isinstance(sms_doc.get("received_at"), datetime):
                freshness["last_sms_at"] = sms_doc["received_at"].isoformat()
            stmt_doc = transactions.find_one(
                {"source": "statement"},
                sort=[("received_at", -1)],
                projection={"received_at": 1},
            )
            if stmt_doc and isinstance(stmt_doc.get("received_at"), datetime):
                freshness["last_statement_at"] = stmt_doc["received_at"].isoformat()
            if portfolio is not None:
                port_doc = portfolio.find_one(
                    sort=[("updated_at", -1)],
                    projection={"updated_at": 1, "import_date": 1},
                )
                if port_doc:
                    ts = port_doc.get("updated_at") or port_doc.get("import_date")
                    if isinstance(ts, datetime):
                        freshness["last_portfolio_at"] = ts.isoformat()
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not compute freshness: {exc}")

    # Alerts / insights (rebuild with budgets) — expensive; skip on lite chart loads
    alerts: list[dict[str, Any]] = []
    if not lite:
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
            budgets=budget_map,
            one_off_fingerprints=one_off_fps,
        )

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
            "bank_upi_spend": bank_upi_spend,
            "transfers_debit": round(transfers_debit, 2),
            "investments_debit": round(investments_debit, 2),
            "credit_card_spend": round(credit_card_spend, 2),
            "credit_card_count": cc_count,
            "debit_card_spend": round(debit_card_spend, 2),
            "upi_spend": round(upi_spend, 2),
            "bank_account_spend": round(bank_account_spend, 2),
            "salary_total": salary_total,
            "salary_count": salary_count,
            "other_income_total": other_income_total,
            "lifestyle_to_salary": round(lifestyle_spend / salary_total * 100, 1)
            if salary_total
            else 0.0,
            "expected_net_monthly": float(income_profile.get("expected_net_monthly") or 0) or None,
            "ctc_lpa": float(income_profile["ctc_lpa"])
            if income_profile.get("ctc_lpa") is not None
            else None,
            "employer": income_profile.get("employer"),
            "avg_daily_lifestyle": round(lifestyle_spend / active_days, 2)
            if active_days
            else 0.0,
            "liquid_total": liquid_total,
            "sms_liquid_total": round(sms_liquid_total, 2),
            "liquid_source": liquid_source,
            "total_invested": total_invested,
            "liabilities_total": liabilities_total,
            "assets_total": assets_total,
            "net_worth_estimate": net_worth_estimate,
            "investment_to_income": round(total_invested / total_credit * 100, 1)
            if total_credit
            else 0.0,
        },
        "indmoney_snapshot": indmoney_snapshot,
        "liabilities": liability_rows,
        "budgets": budget_map,
        "freshness": freshness,
        "mom": mom,
        "monthly": monthly_rows,
        "daily": daily_rows,
        "weekday": weekday_rows,
        "day_of_month": day_of_month,
        "by_bank": group_breakdown("bank"),
        "by_card_type": by_card_type,
        "wallet": {
            "total": round(wallet_total, 2),
            "count": wallet_count,
            "recent": wallet_recent,
            "note": "Wallet/FASTag debits — excluded from spend totals (recharge already counted)",
        },
        "credit_card": {
            "total": round(credit_card_spend, 2),
            "count": cc_count,
            "merchants": credit_card_merchants,
            "payoffs": {
                "paired_total": round(cc_payoff_total, 2),
                "paired_count": cc_payoff_count,
                "ambiguous_count": int(ambiguous_payoffs),
                "note": (
                    "Paired bank→card bill pays are Transfers (excluded from lifestyle). "
                    "Ambiguous candidates are flagged only."
                ),
            },
        },
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
        "income_profile": {
            k: v for k, v in income_profile.items() if not str(k).startswith("_")
        },
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
    budgets: dict[str, float] | None = None,
    one_off_fingerprints: set[str] | None = None,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    skip_fps = one_off_fingerprints or set()

    # Budget vs actual — user-defined targets, else soft defaults
    default_budgets = {
        "Food & Dining": 8000,
        "Shopping": 10000,
        "Subscriptions": 3000,
        "Travel & Transport": 5000,
        "Groceries": 6000,
        "Entertainment": 3000,
    }
    active_budgets = {**default_budgets, **(budgets or {})}
    # Drop zeroed-out user overrides (explicitly disabled)
    if budgets is not None:
        for cat, amt in budgets.items():
            if amt <= 0:
                active_budgets.pop(cat, None)

    cat_map = {r["name"]: r["debit"] for r in by_category}
    for cat, budget in active_budgets.items():
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
                "user_defined": bool(budgets and cat in budgets),
            }
        )

    # Unusual spends (> 3× average debit) — skip learned one-offs
    if avg_debit > 0:
        threshold = avg_debit * 3
        unusual = list(
            transactions.find(
                {**match, "type": "debit", "amount": {"$gte": threshold}},
                {"amount": 1, "merchant": 1, "raw_text": 1, "received_at": 1, "category": 1},
            )
            .sort("amount", -1)
            .limit(8)
        )
        for u in unusual:
            merch = _clean_merchant_label(u.get("merchant"), u.get("raw_text"))
            amt = float(u.get("amount") or 0)
            fp = f"{merch.lower()}|{int(amt)}"
            if fp in skip_fps or str(u.get("_id")) in skip_fps:
                continue
            alerts.append(
                {
                    "type": "anomaly",
                    "severity": "alert",
                    "title": "Unusual spend",
                    "message": f"{merch}: ₹{amt:,.0f} (avg debit ₹{avg_debit:,.0f})",
                    "amount": amt,
                    "avg": round(avg_debit, 2),
                    "merchant": merch,
                    "category": u.get("category"),
                }
            )
            if sum(1 for a in alerts if a.get("type") == "anomaly") >= 5:
                break

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
