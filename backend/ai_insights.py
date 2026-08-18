"""AI insights — chat, categorize, monthly summary, anomaly explanations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from categorizer import CATEGORIES, categorize
from llm import LLMError, extract_json, get_provider

SYSTEM = (
    "Task: careful personal-finance help for one user in India (INR). "
    "If data is missing, say so. Be concise and practical. "
    "Never ask for account numbers, OTP, or passwords."
)


def _persona_system(
    base: str,
    *,
    settings: Any = None,
    learned_facts: Any = None,
    analytics: dict[str, Any] | None = None,
    goals_col: Any = None,
    planning_advisor: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Return (system_prompt, severity_dict). Severity is deterministic."""
    try:
        from advisor_persona import build_persona_system_prompt, severity_from_analytics_bundle

        severity = severity_from_analytics_bundle(
            analytics,
            settings=settings,
            learned_facts=learned_facts,
            planning_advisor=planning_advisor,
            goals_col=goals_col,
        )
        prompt = build_persona_system_prompt(
            base,
            settings=settings,
            learned_facts=learned_facts,
            severity=severity,
        )
        return prompt, severity
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: advisor persona fallback: {exc}")
        return base, {
            "level": "informational",
            "reasons": ["persona_unavailable"],
            "context_line": "tone: informational",
        }


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
            "lifestyle_spend": o.get("lifestyle_spend"),
            "transfers_debit": o.get("transfers_debit"),
            "investments_debit": o.get("investments_debit"),
            "salary_total": o.get("salary_total"),
            "other_income_total": o.get("other_income_total"),
            "lifestyle_to_salary_pct": o.get("lifestyle_to_salary"),
            "debit_count": o.get("debit_count"),
            "credit_count": o.get("credit_count"),
            "avg_daily_debit": o.get("avg_daily_debit"),
            "avg_daily_lifestyle": o.get("avg_daily_lifestyle"),
            "liquid_total": o.get("liquid_total"),
            "sms_liquid_total": o.get("sms_liquid_total"),
            "liquid_source": o.get("liquid_source"),
            "net_worth_estimate": o.get("net_worth_estimate"),
            "investment_to_income_pct": o.get("investment_to_income"),
        },
        "mom": analytics.get("mom"),
        "by_category": [
            {"name": r["name"], "debit": r["debit"], "credit": r["credit"], "count": r["count"]}
            for r in (analytics.get("by_category") or [])[:15]
        ],
        "by_category_lifestyle": [
            {"name": r["name"], "debit": r["debit"], "credit": r["credit"], "count": r["count"]}
            for r in (analytics.get("by_category_lifestyle") or [])[:12]
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
        "smart": _smart_context(analytics.get("smart")),
        "learned_about_you": analytics.get("learned_about_you") or [],
    }


def _smart_context(smart: Any) -> dict[str, Any] | None:
    if not isinstance(smart, dict):
        return None
    sip = smart.get("sip") or {}
    drift = smart.get("drift") or {}
    creep = smart.get("subscription_creep") or {}
    forecast = smart.get("spend_forecast") or {}
    return {
        "sip_flagged": [
            {"name": s.get("name"), "status": s.get("status"), "message": s.get("message")}
            for s in (sip.get("sips") or [])
            if s.get("status") not in {"ok", "marked"}
        ][:8],
        "drift": drift.get("drifts") or [],
        "subscription_issues": [
            {"merchant": i.get("merchant"), "status": i.get("status"), "message": i.get("message")}
            for i in (creep.get("items") or [])
            if i.get("status") != "ok"
        ][:8],
        "spend_forecast": forecast or None,
    }


def ask(
    question: str,
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
    settings: Any = None,
    learned_facts: Any = None,
    goals_col: Any = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    context = build_finance_context(analytics)
    system, severity = _persona_system(
        SYSTEM,
        settings=settings,
        learned_facts=learned_facts,
        analytics=analytics,
        goals_col=goals_col,
    )
    user = (
        "Structured finance context (JSON):\n"
        f"{_compact(context)}\n\n"
        f"Question: {question.strip()}\n\n"
        "Answer as their trained Money Advisor — use their name, soft spots, and goals "
        "from the system prompt when relevant. Cite INR figures from the context only. "
        "If the question cannot be answered from context, say what is missing."
    )
    answer = provider.complete(system, user, temperature=0.25)
    return {
        "answer": answer,
        "provider": provider.name,
        "context_keys": list(context.keys()),
        "advisor_severity": severity,
    }


def monthly_summary(
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
    settings: Any = None,
    learned_facts: Any = None,
    goals_col: Any = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    context = build_finance_context(analytics)
    system, severity = _persona_system(
        SYSTEM,
        settings=settings,
        learned_facts=learned_facts,
        analytics=analytics,
        goals_col=goals_col,
    )
    user = (
        "Write a monthly personal finance briefing from this JSON context.\n"
        f"{_compact(context)}\n\n"
        "Speak as their trained Money Advisor (same voice as the Advisor page) — "
        "use their name, soft spots, and stated goals when relevant. "
        "Cover: (1) income vs spend and savings rate, (2) biggest category shifts, "
        "(3) investment performance snapshot, (4) 2–3 actionable tips. "
        "Use short paragraphs or bullets. No markdown tables."
    )
    text = provider.complete(system, user, temperature=0.3)
    return {"summary": text, "provider": provider.name, "advisor_severity": severity}


def explain_anomalies(
    analytics: dict[str, Any],
    *,
    provider_name: str | None = None,
    settings: Any = None,
    learned_facts: Any = None,
    goals_col: Any = None,
) -> dict[str, Any]:
    provider = get_provider(provider_name)
    alerts = analytics.get("alerts") or []
    system, severity = _persona_system(
        SYSTEM + " Respond with JSON only.",
        settings=settings,
        learned_facts=learned_facts,
        analytics=analytics,
        goals_col=goals_col,
    )
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
        "advisor_severity": severity,
    }
    if not alerts:
        return {
            "insights": ["No unusual activity flagged in the current period."],
            "provider": provider.name,
            "raw": "",
            "advisor_severity": severity,
        }
    user = (
        "Explain these finance alerts in plain language for the user. "
        "Return JSON: {\"insights\": [\"...\"]} with 3–6 short sentences.\n"
        f"{_compact(context)}"
    )
    raw = provider.complete(system, user, temperature=0.2)
    try:
        parsed = extract_json(raw)
        insights = parsed.get("insights") if isinstance(parsed, dict) else parsed
        if not isinstance(insights, list):
            insights = [str(raw)]
    except LLMError:
        insights = [raw]
    return {
        "insights": insights,
        "provider": provider.name,
        "raw": raw,
        "advisor_severity": severity,
    }


def categorize_batch(
    transactions_col: Any,
    *,
    limit: int = 40,
    use_llm: bool = True,
    provider_name: str | None = None,
    merchant_memory: dict[str, str] | None = None,
    settings: Any = None,
    learned_facts: Any = None,
) -> dict[str, Any]:
    """Categorize uncategorized / Other transactions. Memory → rules → LLM leftovers."""
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
    memory_applied = 0

    for doc in docs:
        result = categorize(
            merchant=doc.get("merchant"),
            raw_text=doc.get("raw_text"),
            txn_type=doc.get("type"),
            merchant_memory=merchant_memory,
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
            if result["source"] == "memory":
                memory_applied += 1
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
            cat_base = SYSTEM + " Respond with JSON only. Reasons stay short and factual."
            try:
                from advisor_persona import build_persona_system_prompt, compute_advisor_severity

                sev = compute_advisor_severity(force="informational")
                system = build_persona_system_prompt(
                    cat_base,
                    settings=settings,
                    learned_facts=learned_facts,
                    severity=sev,
                )
            except Exception:
                system = cat_base
            raw = provider.complete(
                system,
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
                "memory_applied": memory_applied,
                "suggestions": suggestions,
                "llm_error": str(exc),
            }

    return {
        "scanned": len(docs),
        "updated": updated,
        "llm_applied": llm_applied,
        "memory_applied": memory_applied,
        "suggestions": suggestions,
        "remaining_other": max(0, len(leftovers) - llm_applied),
    }


def disambiguate_transfers(
    candidates: list[dict[str, Any]],
    *,
    known_accounts: list[str] | None = None,
    provider_name: str | None = None,
    settings: Any = None,
    learned_facts: Any = None,
) -> dict[str, Any]:
    """LLM classifies ambiguous debits as self-transfer vs spend. Suggestions only."""
    if not candidates:
        return {"suggestions": [], "provider": None}

    provider = get_provider(provider_name)
    payload = {
        "known_accounts_banks": known_accounts or [],
        "candidates": [
            {
                "id": c["id"],
                "amount": c["amount"],
                "merchant": c["merchant"],
                "bank": c.get("bank"),
                "snippet": c.get("raw_snippet"),
                "heuristic_reasons": c.get("reasons"),
                "current_category": c.get("category"),
            }
            for c in candidates[:30]
        ],
    }
    user = (
        "Classify each candidate debit as either self_transfer (internal money movement "
        "between the user's own accounts/cards/wallets) or actual_spend (lifestyle expense).\n"
        "Ground your decision in the merchant name, narration snippet, round amounts, "
        "and known_accounts_banks list — do not invent account names.\n"
        "If learned preferences mark a merchant as planned/family, bias toward actual_spend "
        "with the category they already use — do not invent new stories.\n"
        "Return JSON: {\"items\":[{\"id\":\"...\",\"label\":\"self_transfer\"|\"actual_spend\","
        "\"confidence\":0-1,\"suggested_category\":\"Transfers\"|\"Other\"|a spend category,"
        "\"reason\":\"...\"}]}.\n"
        f"Context:\n{_compact(payload)}"
    )
    cat_base = SYSTEM + " Respond with JSON only. Reasons stay short and in advisor voice."
    try:
        from advisor_persona import build_persona_system_prompt, compute_advisor_severity

        sev = compute_advisor_severity(force="informational")
        system = build_persona_system_prompt(
            cat_base,
            settings=settings,
            learned_facts=learned_facts,
            severity=sev,
        )
    except Exception:
        system = cat_base
    raw = provider.complete(system, user, temperature=0.1)
    parsed = extract_json(raw)
    items = parsed.get("items") if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        items = []

    by_id = {c["id"]: c for c in candidates}
    suggestions: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or "")
        if tid not in by_id:
            continue
        label = str(item.get("label") or "").strip()
        if label not in {"self_transfer", "actual_spend"}:
            continue
        suggested = str(item.get("suggested_category") or "").strip()
        if label == "self_transfer":
            suggested = "Transfers"
        elif suggested not in CATEGORIES:
            suggested = by_id[tid].get("category") or "Other"
        suggestions.append(
            {
                **{k: by_id[tid].get(k) for k in ("id", "amount", "merchant", "bank", "received_at", "reasons")},
                "label": label,
                "confidence": float(item.get("confidence") or 0),
                "suggested_category": suggested,
                "reason": str(item.get("reason") or "")[:200],
                "provider": provider.name,
            }
        )
    return {"suggestions": suggestions, "provider": provider.name, "raw": raw}


def _compact(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))
