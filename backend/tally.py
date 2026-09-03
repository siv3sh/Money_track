"""Money sense-check — do the numbers tell a coherent story? (+ AI explanation)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from pymongo.collection import Collection

from ai_insights import _compact, build_finance_context
from llm import LLMError, extract_json, get_provider
from parser import credit_card_noise_mongo_clause
from cc_payment_pairing import CC_PAY_RE

TALLY_SYSTEM = (
    "Task: sense-check whether income, spend, investments, transfers, "
    "merchants, and card activity tell a coherent story for one Indian user (INR). "
    "This is NOT a bookkeeping reconcile. Respond with JSON only. "
    "Never ask for OTP, passwords, or full account numbers."
)

# Back-compat alias
_CC_PAY_RE = CC_PAY_RE


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _match(
    date_from: datetime | None,
    date_to: datetime | None,
    *,
    user_id: Any = None,
) -> dict[str, Any]:
    if user_id is None:
        raise ValueError("user_id is required for tally")
    match: dict[str, Any] = {
        "user_id": user_id,
        "card_type": {"$ne": "wallet"},
        **credit_card_noise_mongo_clause(),
    }
    if date_from or date_to:
        rng: dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        match["received_at"] = rng
    return match


def _iso_day(received: Any) -> str | None:
    if not isinstance(received, datetime):
        return None
    utc = _as_utc(received)
    return utc.date().isoformat() if utc else None


def _latest_balances(transactions: Collection, *, user_id: Any = None) -> list[dict[str, Any]]:
    match: dict[str, Any] = {"balance": {"$ne": None}, "card_type": {"$ne": "wallet"}}
    if user_id is not None:
        match["user_id"] = user_id
    rows = list(
        transactions.aggregate(
            [
                {"$match": match},
                {"$sort": {"received_at": -1, "_id": -1}},
                {
                    "$group": {
                        "_id": {"bank": "$bank", "last4": "$account_last4"},
                        "balance": {"$first": "$balance"},
                        "as_of": {"$first": "$received_at"},
                        "source": {"$first": {"$ifNull": ["$source", "sms"]}},
                    }
                },
            ]
        )
    )
    out = []
    for r in rows:
        key = r.get("_id") or {}
        out.append(
            {
                "bank": key.get("bank") or "Unknown",
                "account_last4": key.get("last4"),
                "balance": round(float(r.get("balance") or 0), 2),
                "as_of": _iso_day(r.get("as_of")),
                "source": r.get("source") or "sms",
            }
        )
    out.sort(key=lambda x: -x["balance"])
    return out[:8]


def compute_tally(
    transactions: Collection,
    *,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    user_id: Any = None,
) -> dict[str, Any]:
    """Build a sense-check pack: totals, mix, outliers, and story flags."""
    match = _match(date_from, date_to, user_id=user_id)
    docs = list(
        transactions.find(
            match,
            {
                "type": 1,
                "amount": 1,
                "bank": 1,
                "category": 1,
                "card_type": 1,
                "merchant": 1,
                "raw_text": 1,
                "balance": 1,
                "account_last4": 1,
                "received_at": 1,
            },
        )
    )

    total_debit = 0.0
    total_credit = 0.0
    debit_count = 0
    credit_count = 0
    by_bank: dict[str, dict[str, float]] = defaultdict(
        lambda: {"debit": 0.0, "credit": 0.0, "count": 0}
    )
    by_category: dict[str, dict[str, float]] = defaultdict(
        lambda: {"debit": 0.0, "credit": 0.0, "count": 0}
    )
    by_card: dict[str, dict[str, float]] = defaultdict(
        lambda: {"debit": 0.0, "credit": 0.0, "count": 0}
    )
    merchant_debit: dict[str, dict[str, float]] = defaultdict(
        lambda: {"amount": 0.0, "count": 0}
    )
    other_debits: list[dict[str, Any]] = []
    cc_spends: list[dict[str, Any]] = []
    likely_cc_payments: list[dict[str, Any]] = []
    largest_debits: list[dict[str, Any]] = []
    by_day_debit: dict[str, float] = defaultdict(float)

    for d in docs:
        amt = float(d.get("amount") or 0)
        if amt <= 0:
            continue
        typ = d.get("type") or "debit"
        bank = str(d.get("bank") or "Unknown")
        cat = str(d.get("category") or "Other") or "Other"
        card = str(d.get("card_type") or "bank_account")
        merchant = str(d.get("merchant") or "")[:60]
        raw = str(d.get("raw_text") or "")[:120]
        received = d.get("received_at")
        day = _iso_day(received)

        bucket_b = by_bank[bank]
        bucket_c = by_category[cat]
        bucket_k = by_card[card]
        bucket_b["count"] += 1
        bucket_c["count"] += 1
        bucket_k["count"] += 1

        if typ == "credit":
            total_credit += amt
            credit_count += 1
            bucket_b["credit"] += amt
            bucket_c["credit"] += amt
            bucket_k["credit"] += amt
            continue

        total_debit += amt
        debit_count += 1
        bucket_b["debit"] += amt
        bucket_c["debit"] += amt
        bucket_k["debit"] += amt
        if day:
            by_day_debit[day] += amt

        label = merchant or "Unknown"
        merchant_debit[label]["amount"] += amt
        merchant_debit[label]["count"] += 1

        largest_debits.append(
            {
                "amount": round(amt, 2),
                "merchant": label,
                "category": cat,
                "bank": bank,
                "card_type": card,
                "date": day,
            }
        )

        if cat == "Other" and len(other_debits) < 12:
            other_debits.append(
                {
                    "amount": round(amt, 2),
                    "merchant": label,
                    "bank": bank,
                    "date": day,
                }
            )
        if card == "credit_card" and len(cc_spends) < 10:
            cc_spends.append(
                {
                    "amount": round(amt, 2),
                    "merchant": label,
                    "date": day,
                }
            )
        blob = f"{merchant} {raw}"
        if card != "credit_card" and _CC_PAY_RE.search(blob) and len(likely_cc_payments) < 12:
            likely_cc_payments.append(
                {
                    "amount": round(amt, 2),
                    "merchant": label,
                    "bank": bank,
                    "category": cat,
                    "date": day,
                }
            )

    largest_debits.sort(key=lambda x: -x["amount"])
    largest_debits = largest_debits[:8]
    top_merchants = [
        {"merchant": name, "amount": round(v["amount"], 2), "count": int(v["count"])}
        for name, v in sorted(merchant_debit.items(), key=lambda kv: -kv[1]["amount"])[:10]
    ]

    lifestyle = 0.0
    investments = float(by_category.get("Investments", {}).get("debit") or 0)
    transfers = float(by_category.get("Transfers", {}).get("debit") or 0)
    other_amt = float(by_category.get("Other", {}).get("debit") or 0)
    income_cat = float(by_category.get("Income", {}).get("credit") or 0)

    for name, vals in by_category.items():
        if name in {"Transfers", "Investments", "Income"}:
            continue
        lifestyle += float(vals.get("debit") or 0)

    cc_spend = float(by_card.get("credit_card", {}).get("debit") or 0)
    cc_payment_sum = round(sum(p["amount"] for p in likely_cc_payments), 2)
    cc_gap = round(cc_spend - cc_payment_sum, 2)

    category_debit_sum = round(sum(float(v.get("debit") or 0) for v in by_category.values()), 2)
    split_gap = round(total_debit - category_debit_sum, 2)
    net = round(total_credit - total_debit, 2)
    explained = round(lifestyle + investments + transfers + other_amt, 2)
    unexplained_outflow = round(total_debit - explained, 2)

    peak_day = None
    peak_day_amt = 0.0
    for day, amt in by_day_debit.items():
        if amt > peak_day_amt:
            peak_day_amt = amt
            peak_day = day

    sense_flags: list[dict[str, Any]] = []
    if debit_count + credit_count == 0:
        sense_flags.append(
            {
                "code": "empty",
                "severity": "alert",
                "title": "No activity",
                "message": "Nothing in this range — pick a broader date range.",
            }
        )
    if total_credit > 0 and lifestyle > total_credit * 1.15:
        sense_flags.append(
            {
                "code": "lifestyle_above_income",
                "severity": "warning",
                "title": "Lifestyle above credits",
                "message": (
                    f"Lifestyle spend ₹{lifestyle:,.0f} is higher than credits ₹{total_credit:,.0f} — "
                    "possible credit-card float, prior savings, or miscategorised income."
                ),
            }
        )
    if total_debit > 0 and transfers > total_debit * 0.45:
        sense_flags.append(
            {
                "code": "transfers_heavy",
                "severity": "info",
                "title": "Transfers dominate outflow",
                "message": (
                    f"Transfers are {transfers / total_debit * 100:.0f}% of debits — "
                    "self-transfers can make spend look bigger than real lifestyle."
                ),
            }
        )
    if total_debit > 0 and other_amt >= max(500.0, total_debit * 0.08):
        sense_flags.append(
            {
                "code": "other_heavy",
                "severity": "warning",
                "title": "Lots of uncategorised spend",
                "message": (
                    f"₹{other_amt:,.0f} sits in Other — hard to judge if the story makes sense until labelled."
                ),
            }
        )
    if largest_debits and total_debit > 0 and largest_debits[0]["amount"] >= max(5000.0, total_debit * 0.2):
        top = largest_debits[0]
        sense_flags.append(
            {
                "code": "one_huge_debit",
                "severity": "info",
                "title": "One large debit stands out",
                "message": (
                    f"₹{top['amount']:,.0f} to {top['merchant']} ({top['category']}) on {top.get('date') or '—'} "
                    "— check if that was a planned transfer, rent, or one-off."
                ),
            }
        )
    if income_cat > 0 and lifestyle > 0:
        ratio = lifestyle / income_cat
        if ratio > 0.85:
            sense_flags.append(
                {
                    "code": "thin_savings",
                    "severity": "info",
                    "title": "Thin margin after lifestyle",
                    "message": (
                        f"Lifestyle is {ratio * 100:.0f}% of Income-category credits — "
                        "little room left before investments/transfers."
                    ),
                }
            )
    if cc_spend > 0 and abs(cc_gap) >= max(500.0, cc_spend * 0.25):
        sense_flags.append(
            {
                "code": "cc_story",
                "severity": "info",
                "title": "Card spend vs payments",
                "message": (
                    f"Card spend ₹{cc_spend:,.0f} vs likely payments ₹{cc_payment_sum:,.0f} "
                    f"(gap ₹{cc_gap:,.0f}) — fine if dues span months; odd if you always clear in full."
                ),
            }
        )

    if not docs:
        status = "odd"
    elif any(f["severity"] == "alert" for f in sense_flags):
        status = "odd"
    elif any(f["severity"] == "warning" for f in sense_flags):
        status = "mostly"
    elif sense_flags:
        status = "mostly"
    else:
        status = "makes_sense"

    balances = _latest_balances(transactions, user_id=user_id)
    balance_total = round(sum(b["balance"] for b in balances), 2)

    issues = [
        {
            "code": f["code"],
            "severity": f["severity"],
            "title": f["title"],
            "message": f["message"],
            "amount": 0,
        }
        for f in sense_flags
    ]

    return {
        "range": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
        "status": status,
        "overview": {
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "net": net,
            "debit_count": debit_count,
            "credit_count": credit_count,
            "txn_count": debit_count + credit_count,
        },
        "identity": {
            "credits_minus_debits": net,
            "lifestyle_debit": round(lifestyle, 2),
            "investments_debit": round(investments, 2),
            "transfers_debit": round(transfers, 2),
            "other_debit": round(other_amt, 2),
            "income_credit": round(income_cat, 2),
            "explained_outflow": explained,
            "outflow_gap": unexplained_outflow,
            "category_debit_sum": category_debit_sum,
            "split_gap": split_gap,
            "lifestyle_to_credit_pct": round(lifestyle / total_credit * 100, 1) if total_credit else None,
            "invest_to_credit_pct": round(investments / total_credit * 100, 1) if total_credit else None,
        },
        "credit_card": {
            "spend": round(cc_spend, 2),
            "likely_payments": cc_payment_sum,
            "gap": cc_gap,
            "sample_spends": cc_spends,
            "sample_payments": likely_cc_payments[:8],
        },
        "peak_spend_day": {"date": peak_day, "amount": round(peak_day_amt, 2)} if peak_day else None,
        "largest_debits": largest_debits,
        "top_merchants": top_merchants,
        "by_bank": [
            {
                "name": name,
                "debit": round(v["debit"], 2),
                "credit": round(v["credit"], 2),
                "net": round(v["credit"] - v["debit"], 2),
                "count": int(v["count"]),
            }
            for name, v in sorted(
                by_bank.items(), key=lambda kv: -(kv[1]["debit"] + kv[1]["credit"])
            )
        ],
        "by_category": [
            {
                "name": name,
                "debit": round(v["debit"], 2),
                "credit": round(v["credit"], 2),
                "count": int(v["count"]),
            }
            for name, v in sorted(by_category.items(), key=lambda kv: -kv[1]["debit"])
            if v["debit"] > 0 or v["credit"] > 0
        ][:16],
        "uncategorized_samples": other_debits,
        "balances": balances,
        "sms_liquid_total": balance_total,
        "sense_flags": sense_flags,
        "issues": issues,
    }


def run_ai_tally(
    pack: dict[str, Any],
    *,
    analytics: dict[str, Any] | None = None,
    provider_name: str | None = None,
    settings: Any = None,
    learned_facts: Any = None,
    goals_col: Any = None,
) -> dict[str, Any]:
    """Ask the LLM: does this money story make sense?"""
    provider = get_provider(provider_name)
    finance = build_finance_context(analytics) if analytics else None
    slim = {
        "sense_status_hint": pack.get("status"),
        "overview": pack.get("overview"),
        "money_mix": pack.get("identity"),
        "credit_card": {
            "spend": (pack.get("credit_card") or {}).get("spend"),
            "likely_payments": (pack.get("credit_card") or {}).get("likely_payments"),
            "gap": (pack.get("credit_card") or {}).get("gap"),
        },
        "peak_spend_day": pack.get("peak_spend_day"),
        "largest_debits": pack.get("largest_debits"),
        "top_merchants": pack.get("top_merchants"),
        "by_bank": pack.get("by_bank"),
        "by_category": (pack.get("by_category") or [])[:12],
        "sense_flags": pack.get("sense_flags") or pack.get("issues"),
        "uncategorized_samples": pack.get("uncategorized_samples"),
        "sms_liquid_total": pack.get("sms_liquid_total"),
        "balances": pack.get("balances"),
        "range": pack.get("range"),
        "extra_analytics": {
            "salary_total": ((finance or {}).get("totals") or {}).get("salary_total"),
            "lifestyle_to_salary_pct": ((finance or {}).get("totals") or {}).get("lifestyle_to_salary_pct"),
            "investment_to_income_pct": ((finance or {}).get("totals") or {}).get("investment_to_income_pct"),
            "mom": (finance or {}).get("mom"),
            "alerts_preview": (finance or {}).get("alerts_preview"),
            "learned_about_you": (finance or {}).get("learned_about_you"),
            "recurring": (finance or {}).get("recurring"),
        }
        if finance
        else None,
    }
    try:
        from advisor_persona import build_persona_system_prompt, severity_from_analytics_bundle

        severity = severity_from_analytics_bundle(
            analytics,
            settings=settings,
            learned_facts=learned_facts,
            goals_col=goals_col,
        )
        system = build_persona_system_prompt(
            TALLY_SYSTEM + " Respond with JSON only.",
            settings=settings,
            learned_facts=learned_facts,
            severity=severity,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: tally persona fallback: {exc}")
        severity = {"level": "informational", "context_line": "tone: informational"}
        system = TALLY_SYSTEM + " Respond with JSON only."

    user = (
        "Sense-check this person's money for the selected period "
        "(Federal Bank + one ICICI credit card).\n"
        "Ask yourself: would a real person look at this and say \"yeah, that fits my life\" "
        "or \"wait, that doesn't add up / something feels off\"?\n"
        "Focus on coherence of the STORY: income vs lifestyle, whether transfers inflate spend, "
        "whether big merchants/debits look intentional, whether Investments vs lifestyle mix is plausible, "
        "whether Other is muddying the picture, and any odd spikes.\n"
        "Do NOT treat this as double-entry accounting or demand credits == debits.\n"
        "Return JSON only:\n"
        "{\n"
        '  "verdict": "makes_sense" | "mostly" | "odd",\n'
        '  "headline": "one short sentence a friend would say",\n'
        '  "summary": "2-4 sentences: what looks normal, what looks odd, why",\n'
        '  "checks": [{"label":"...","ok":true|false,"detail":"..."}],\n'
        '  "actions": ["up to 4 concrete next steps to clarify the story"]\n'
        "}\n"
        "Checks should be sense questions, e.g. \"Lifestyle fits income?\", "
        "\"Big debits look planned?\", \"Categories clear enough?\", \"Transfers vs real spend?\".\n"
        f"Advisor severity (match tone): {severity.get('context_line')}\n"
        f"Pack:\n{_compact(slim)}"
    )
    raw = provider.complete(system, user, temperature=0.25)
    try:
        parsed = extract_json(raw)
        if not isinstance(parsed, dict):
            raise LLMError("Expected JSON object")
    except LLMError:
        return {
            "verdict": pack.get("status") or "mostly",
            "headline": "Numbers are ready; AI sense-check failed.",
            "summary": (raw or "Could not parse AI response.")[:800],
            "checks": [],
            "actions": [
                str(i.get("message") or "")
                for i in (pack.get("sense_flags") or pack.get("issues") or [])
            ][:4],
            "provider": provider.name,
            "raw": raw,
            "advisor_severity": severity,
        }

    verdict = str(parsed.get("verdict") or pack.get("status") or "mostly").strip().lower()
    if verdict in {"tallies", "sensible", "yes", "ok"}:
        verdict = "makes_sense"
    elif verdict in {"gaps", "off", "weird", "no"}:
        verdict = "odd"
    if verdict not in {"makes_sense", "mostly", "odd"}:
        hint = str(pack.get("status") or "mostly")
        if hint == "tallies":
            verdict = "makes_sense"
        elif hint == "gaps":
            verdict = "odd"
        else:
            verdict = hint if hint in {"makes_sense", "mostly", "odd"} else "mostly"

    checks = parsed.get("checks") if isinstance(parsed.get("checks"), list) else []
    actions = parsed.get("actions") if isinstance(parsed.get("actions"), list) else []
    clean_checks = []
    for c in checks[:8]:
        if not isinstance(c, dict):
            continue
        clean_checks.append(
            {
                "label": str(c.get("label") or "")[:80],
                "ok": bool(c.get("ok")),
                "detail": str(c.get("detail") or "")[:220],
            }
        )

    return {
        "verdict": verdict,
        "headline": str(parsed.get("headline") or "")[:160],
        "summary": str(parsed.get("summary") or "")[:1200],
        "checks": clean_checks,
        "actions": [str(a)[:200] for a in actions[:4] if a],
        "provider": provider.name,
        "raw": raw[:4000] if isinstance(raw, str) else raw,
        "advisor_severity": severity,
    }
