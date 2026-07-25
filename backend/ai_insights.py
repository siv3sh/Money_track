"""AI insights — chat, categorize, monthly summary, anomaly explanations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from categorizer import CATEGORIES, categorize
from llm import LLMError, extract_json, get_provider

SYSTEM = (
    "You are a careful personal-finance assistant for a single user in India (INR). "
    "Use only the structured context provided. Do not invent numbers. "
    "If data is missing, say so. Be concise and practical. "
    "Never ask for account numbers, OTP, or passwords."
)


def build_finance_context(analytics: dict[str, Any]) -> dict[str, Any]:
    """Strip to aggregated fields — no raw SMS / full account numbers."""
    o = analytics.get("overview") or {}
    inv = analytics.get("investments") or {}
    return {
        "period": analytics.get("range"),
        "totals": {
            "debit": o.get("total_debit"),
            "credit": o.get("total_credit"),
            "net": o.get("net"),
            "debit_count": o.get("debit_count"),
            "credit_count": o.get("credit_count"),
            "avg_daily_debit": o.get("avg_daily_debit"),
            "liquid_total": o.get("liquid_total"),
            "net_worth_estimate": o.get("net_worth_estimate"),
            "investment_to_income_pct": o.get("investment_to_income"),
        },
        "mom": analytics.get("mom"),
        "by_category": [
            {"name": r["name"], "debit": r["debit"], "credit": r["credit"], "count": r["count"]}
            for r in (analytics.get("by_category") or [])[:15]
        ],
        "by_bank": [
            {"name": r["name"], "debit": r["debit"], "credit": r["credit"], "net": r["net"]}
            for r in (analytics.get("by_bank") or [])[:10]
        ],
        "top_merchants": [
            {"merchant": m["merchant"], "amount": m["amount"], "count": m["count"]}
            for m in (analytics.get("merchants") or [])[:10]
        ],
        "monthly": (analytics.get("monthly") or [])[-6:],
        "investments": {
            "total_invested": inv.get("total_invested"),
            "total_current": inv.get("total_current"),
            "pnl": inv.get("pnl"),
            "allocation": inv.get("asset_allocation"),
            "holdings": [
                {
                    "name": h["name"],
                    "asset_class": h["asset_class"],
                    "invested": h["invested"],
                    "current_value": h["current_value"],
                    "pnl": h["pnl"],
                    "pnl_pct": h["pnl_pct"],
                }
                for h in (inv.get("holdings") or [])[:12]
            ],
        },
        "alerts_preview": [
            {"type": a.get("type"), "title": a.get("title"), "message": a.get("message")}
            for a in (analytics.get("alerts") or [])[:8]
        ],
        "recurring": {
            "recurring_amount": (analytics.get("recurring") or {}).get("recurring_amount"),
            "onetime_amount": (analytics.get("recurring") or {}).get("onetime_amount"),
            "top": (analytics.get("recurring") or {}).get("merchants", [])[:5],
        },
    }


def ask(
    question: str,
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    context = build_finance_context(analytics)
    user = (
        "Structured finance context (JSON):\n"
        f"{_compact(context)}\n\n"
        f"Question: {question.strip()}\n\n"
        "Answer in clear prose with INR figures from the context. "
        "If the question cannot be answered from context, say what is missing."
    )
    answer = provider.complete(SYSTEM, user, temperature=0.25)
    return {
        "answer": answer,
        "provider": provider.name,
        "context_keys": list(context.keys()),
    }


def monthly_summary(
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    context = build_finance_context(analytics)
    user = (
        "Write a monthly personal finance briefing from this JSON context.\n"
        f"{_compact(context)}\n\n"
        "Cover: (1) income vs spend and savings rate, (2) biggest category shifts, "
        "(3) investment performance snapshot, (4) 2–3 actionable tips. "
        "Use short paragraphs or bullets. No markdown tables."
    )
    text = provider.complete(SYSTEM, user, temperature=0.3)
    return {"summary": text, "provider": provider.name}


def explain_anomalies(
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    alerts = analytics.get("alerts") or []
    context = {
        "alerts": [
            {
                "type": a.get("type"),
                "severity": a.get("severity"),
                "title": a.get("title"),
                "message": a.get("message"),
                "category": a.get("category"),
                "pct": a.get("pct"),
            }
            for a in alerts
        ],
        "mom": analytics.get("mom"),
        "top_merchants": (analytics.get("merchants") or [])[:5],
        "totals": {
            "debit": (analytics.get("overview") or {}).get("total_debit"),
            "credit": (analytics.get("overview") or {}).get("total_credit"),
        },
    }
    if not alerts:
        return {
            "insights": ["No unusual activity flagged in the current period."],
            "provider": provider.name,
            "raw": "",
        }
    user = (
        "Explain these finance alerts in plain language for the user. "
        "Return JSON: {\"insights\": [\"...\"]} with 3–6 short sentences.\n"
        f"{_compact(context)}"
    )
    raw = provider.complete(SYSTEM + " Respond with JSON only.", user, temperature=0.2)
    try:
        parsed = extract_json(raw)
        insights = parsed.get("insights") if isinstance(parsed, dict) else parsed
        if not isinstance(insights, list):
            insights = [str(raw)]
    except LLMError:
        insights = [raw]
    return {"insights": insights, "provider": provider.name, "raw": raw}


def categorize_batch(
    transactions_col: Any,
    *,
    limit: int = 40,
    use_llm: bool = True,
    provider_name: str | None = None,
) -> dict[str, Any]:
    """Categorize uncategorized / Other transactions. Rules first, LLM for leftovers."""
    query = {
        "$or": [
            {"category": {"$exists": False}},
            {"category": None},
            {"category": ""},
            {"category": "Other"},
        ],
        "category_source": {"$ne": "manual"},
    }
    docs = list(transactions_col.find(query).sort("received_at", -1).limit(limit))
    updated = 0
    suggestions: list[dict[str, Any]] = []
    leftovers: list[dict[str, Any]] = []

    for doc in docs:
        result = categorize(
            merchant=doc.get("merchant"),
            raw_text=doc.get("raw_text"),
            txn_type=doc.get("type"),
        )
        if result["category"] != "Other":
            transactions_col.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "category": result["category"],
                        "mcc": result.get("mcc"),
                        "category_source": result["source"],
                    }
                },
            )
            updated += 1
            suggestions.append(
                {
                    "id": str(doc["_id"]),
                    "category": result["category"],
                    "source": result["source"],
                    "merchant": doc.get("merchant"),
                }
            )
        else:
            leftovers.append(doc)

    llm_applied = 0
    if use_llm and leftovers:
        try:
            provider = get_provider(provider_name)
            batch = [
                {
                    "id": str(d["_id"]),
                    "type": d.get("type"),
                    "amount": d.get("amount"),
                    "merchant": (d.get("merchant") or "")[:40],
                    "snippet": (d.get("raw_text") or "")[:80],
                }
                for d in leftovers[:25]
            ]
            user = (
                f"Assign each transaction one category from this list: {CATEGORIES}.\n"
                "Return JSON array: [{\"id\":\"...\",\"category\":\"...\",\"reason\":\"...\"}].\n"
                f"Transactions:\n{_compact(batch)}"
            )
            raw = provider.complete(
                SYSTEM + " Respond with JSON only.",
                user,
                temperature=0.1,
            )
            parsed = extract_json(raw)
            if isinstance(parsed, dict) and "items" in parsed:
                parsed = parsed["items"]
            if isinstance(parsed, list):
                by_id = {str(d["_id"]): d for d in leftovers}
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    tid = str(item.get("id") or "")
                    cat = str(item.get("category") or "").strip()
                    if tid not in by_id or cat not in CATEGORIES:
                        continue
                    transactions_col.update_one(
                        {"_id": by_id[tid]["_id"]},
                        {
                            "$set": {
                                "category": cat,
                                "category_source": f"llm:{provider.name}",
                            }
                        },
                    )
                    llm_applied += 1
                    updated += 1
                    suggestions.append(
                        {
                            "id": tid,
                            "category": cat,
                            "source": f"llm:{provider.name}",
                            "merchant": by_id[tid].get("merchant"),
                            "reason": item.get("reason"),
                        }
                    )
        except LLMError as exc:
            return {
                "scanned": len(docs),
                "updated": updated,
                "llm_applied": 0,
                "suggestions": suggestions,
                "llm_error": str(exc),
            }

    return {
        "scanned": len(docs),
        "updated": updated,
        "llm_applied": llm_applied,
        "suggestions": suggestions,
        "remaining_other": max(0, len(leftovers) - llm_applied),
    }


def _compact(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))
