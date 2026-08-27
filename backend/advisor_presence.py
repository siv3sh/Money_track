"""System-wide Money Advisor presence — chat, nudges, decision interjections.

Severity stays deterministic. LLM narrates with persona + memories + real numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pymongo.collection import Collection

from advisor_memory import (
    append_memory,
    list_memories,
    mark_nudge_answered,
    maybe_append_from_severity,
    maybe_append_goal_milestone,
    memories_for_prompt,
    is_nudge_answered,
    open_asks,
)
from advisor_persona import (
    build_chat_system_prompt,
    get_advisor_persona_settings,
    severity_from_analytics_bundle,
    system_briefing,
)
from ai_insights import _compact
from learned_facts import advisor_profile_from_facts, facts_for_ai_context, trained_profile_fields, upsert_fact
from llm import LLMError, get_chat_provider
from merchant_label import is_salary_source
from planning import temptation_label

# Lifestyle spend worth a "why this much?" probe
SPEND_PROBE_INR = 800.0
# Unexplained credits worth a "where from?" ask
CREDIT_ASK_INR = 500.0
MONTH_START_DAYS = 3
SALARY_WINDOW_DAYS = 10


def _message_excluded_from_llm(msg: dict[str, Any]) -> bool:
    """Template nudges / acks stay in the widget transcript but must not steer the LLM."""
    meta = msg.get("meta") or {}
    if meta.get("exclude_from_llm"):
        return True
    # Legacy rows written before exclude_from_llm existed
    if meta.get("nudge") or meta.get("nudge_ack"):
        return True
    return False


def _llm_history_lines(messages: list[dict[str, Any]], *, limit: int = 6) -> list[str]:
    included = [m for m in messages if not _message_excluded_from_llm(m)]
    return [
        f"{m.get('role', 'user').upper()}: {m.get('content', '')}"
        for m in included[-limit:]
    ]


def build_compact_chat_user_state(
    analytics: dict[str, Any],
    *,
    severity: dict[str, Any],
    profile: dict[str, Any],
    goals: list[dict[str, Any]],
    memory_lines: list[str],
    learned_facts: Collection | None,
    just_remembered: str | None = None,
) -> dict[str, Any]:
    """Compact UserState for advisor chat — aggregates only, capped lists."""
    o = analytics.get("overview") or {}
    inv = analytics.get("investments") or {}
    mom = analytics.get("mom") or {}

    profile_bits = trained_profile_fields(profile)

    facts: list[dict[str, str]] = []
    if learned_facts is not None:
        for row in facts_for_ai_context(learned_facts)[:8]:
            if row.get("type") == "advisor_profile":
                continue
            facts.append(
                {
                    "type": str(row.get("type") or ""),
                    "summary": str(row.get("summary") or ""),
                }
            )

    totals = {
        k: o[k]
        for k in (
            "total_debit",
            "total_credit",
            "net",
            "lifestyle_spend",
            "bank_upi_spend",
            "credit_card_spend",
            "salary_total",
            "other_income_total",
            "transfers_debit",
            "investments_debit",
            "lifestyle_to_salary",
            "net_worth_estimate",
            "liquid_total",
            "liabilities_total",
        )
        if o.get(k) is not None
    }

    state: dict[str, Any] = {
        "period": analytics.get("range"),
        "totals": totals,
        "mom": {k: mom[k] for k in ("net_pct", "debit_pct", "credit_pct") if mom.get(k) is not None},
        "top_categories": [
            {"name": r["name"], "debit": r["debit"]}
            for r in (analytics.get("by_category_lifestyle") or analytics.get("by_category") or [])[:5]
            if float(r.get("debit") or 0) > 0
        ],
        "top_merchants": [
            {"merchant": m["merchant"], "amount": m["amount"]}
            for m in (analytics.get("merchants") or [])[:5]
        ],
        "investments": {
            k: inv.get(k) for k in ("total_invested", "total_current", "pnl") if inv.get(k) is not None
        },
        "goals": goals[:3],
        "severity": {
            "level": severity.get("level"),
            "reasons": (severity.get("reasons") or [])[:4],
        },
        "profile": profile_bits,
        "facts": facts,
        "memory": memory_lines[:8],
        "just_remembered": just_remembered,
        "alerts": [
            {"type": a.get("type"), "title": a.get("title")}
            for a in (analytics.get("alerts") or [])[:4]
        ],
    }
    return {k: v for k, v in state.items() if v not in (None, [], {})}


CHAT_USER_SUFFIX = (
    "Answer using UserState and conversation only. "
    "If the data is not there, say what is missing instead of guessing."
)

DecisionAction = Literal[
    "liability_txn",
    "category_change",
    "sip_mark_invested",
    "goal_contribute",
    "goal_complete",
    "drift_dismiss",
    "learn_question",
]

CREDIT_ANSWER_ALIASES = {
    "salary / payroll": "salary",
    "salary": "salary",
    "payroll": "salary",
    "refund": "refund",
    "family": "family",
    "other": "other",
}

SPEND_ANSWER_ALIASES = {
    "planned treat": "planned",
    "planned": "planned",
    "impulse — my bad": "impulse",
    "impulse": "impulse",
    "necessary": "necessary",
}


def _normalize_credit_answer(raw: str) -> str:
    t = (raw or "").strip()
    low = t.lower()
    # Exact / button labels first
    if low in CREDIT_ANSWER_ALIASES:
        return CREDIT_ANSWER_ALIASES[low]
    for key, val in CREDIT_ANSWER_ALIASES.items():
        if low == key or low == val:
            return val
    # Short phrase that is clearly one of the labels
    if low in {"salary / payroll", "salary leftover"}:
        return "salary"
    # Free text — keep the human wording
    return t[:120] if t else "other"


def _normalize_spend_answer(raw: str) -> str:
    t = (raw or "").strip()
    low = t.lower()
    if low in SPEND_ANSWER_ALIASES:
        return SPEND_ANSWER_ALIASES[low]
    for key, val in SPEND_ANSWER_ALIASES.items():
        if low == key or low == val:
            return val
    if low.startswith("plan") or "planned" in low:
        return "planned" if len(t) < 24 else t[:120]
    if "impulse" in low or low in {"my bad", "oops"}:
        return "impulse" if len(t) < 24 else t[:120]
    if "necessary" in low or low.startswith("need"):
        return "necessary" if len(t) < 24 else t[:120]
    return t[:120] if t else "other"


def answer_lifecycle_nudge(
    *,
    memories: Collection,
    learned_facts: Collection | None,
    kind: str,
    nudge_id: str,
    answer: str,
    free_text: str | None = None,
    sessions: Collection | None = None,
) -> dict[str, Any]:
    """Persist a credit/spend explanation so future chats remember it like a human would."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    kind_n = (kind or "").strip().lower()
    text = (free_text or answer or "").strip()
    if not text:
        raise ValueError("answer is required")
    if not nudge_id:
        raise ValueError("nudge_id is required")

    ask = memories.find_one({"dedupe_key": nudge_id}) or {}
    meta = dict(ask.get("meta") or {})
    merchant = str(meta.get("merchant") or "that source")
    amount = meta.get("amount")
    category = meta.get("category")
    ym = _now().strftime("%Y-%m")
    fact = None
    remembered = ""

    if kind_n == "credit_source":
        label = _normalize_credit_answer(text)
        remembered = (
            f"{name} told me: ₹{float(amount):,.0f} credit from {merchant} was {label}."
            if amount
            else f"{name} told me: credit from {merchant} was {label}."
        )
        if learned_facts is not None:
            fact = upsert_fact(
                learned_facts,
                fact_type="income_profile",
                key=f"credit_from:{merchant.lower()[:60]}",
                value=label,
                source="user_answered",
                plain_language=f"Credits from {merchant} are usually {label}",
                meta={
                    "nudge_id": nudge_id,
                    "amount": amount,
                    "merchant": merchant,
                    "answer_raw": text[:200],
                },
            )
            upsert_fact(
                learned_facts,
                fact_type="one_off_context",
                key=f"{merchant}|credit|{int(float(amount or 0))}|{ym}",
                value=label,
                source="user_answered",
                plain_language=(
                    f"₹{float(amount):,.0f} from {merchant} ({ym}) was {label}"
                    if amount
                    else f"Credit from {merchant} was {label}"
                ),
                meta={"nudge_id": nudge_id, "merchant": merchant, "amount": amount},
            )
        mark_nudge_answered(
            memories,
            dedupe_key=nudge_id,
            answer=label,
            summary=remembered,
            meta={"kind": "credit_source", "merchant": merchant, "amount": amount},
        )
    elif kind_n == "spend_probe":
        label = _normalize_spend_answer(text)
        remembered = (
            f"{name} told me: ₹{float(amount):,.0f} at {merchant} was {label}."
            if amount
            else f"{name} told me: spend at {merchant} was {label}."
        )
        if learned_facts is not None:
            fact = upsert_fact(
                learned_facts,
                fact_type="spending_intent",
                key=f"{ym}|{merchant.lower()[:40]}",
                value=label,
                source="user_answered",
                plain_language=(
                    f"{merchant} spend in {ym} was {label}"
                    + (f" (₹{float(amount):,.0f})" if amount else "")
                ),
                meta={
                    "nudge_id": nudge_id,
                    "amount": amount,
                    "merchant": merchant,
                    "category": category,
                    "answer_raw": text[:200],
                },
            )
        mark_nudge_answered(
            memories,
            dedupe_key=nudge_id,
            answer=label,
            summary=remembered,
            meta={
                "kind": "spend_probe",
                "merchant": merchant,
                "amount": amount,
                "category": category,
            },
        )
    else:
        label = text[:120]
        remembered = f"{name} told me: {label}"
        mark_nudge_answered(
            memories,
            dedupe_key=nudge_id,
            answer=label,
            summary=remembered,
            meta={"kind": kind_n},
        )

    ack = (
        f"Got it — I'll remember that"
        + (f" the ₹{float(amount):,.0f}" if amount else "")
        + (f" from {merchant}" if merchant and merchant != "that source" else "")
        + f" was {label}. I'll keep that in mind next time something similar shows up."
    )
    session = None
    if sessions is not None:
        session = get_or_create_session(sessions, period="week")
        append_session_message(
            sessions,
            session["session_key"],
            role="user",
            content=text,
            meta={"nudge_answer": True, "nudge_id": nudge_id, "kind": kind_n},
        )
        session = append_session_message(
            sessions,
            session["session_key"],
            role="advisor",
            content=ack,
            meta={"nudge_ack": True, "kind": kind_n, "remembered": True, "exclude_from_llm": True},
        )

    return {
        "ok": True,
        "kind": kind_n,
        "nudge_id": nudge_id,
        "answer": label,
        "remembered": remembered,
        "ack": ack,
        "fact": fact,
        "session": session,
    }


def capture_open_nudge_from_chat(
    *,
    message: str,
    memories: Collection,
    learned_facts: Collection | None,
) -> dict[str, Any] | None:
    """If the user is clearly answering an open credit/spend ask in free chat, persist it."""
    text = (message or "").strip()
    if len(text) < 2:
        return None
    asks = open_asks(memories, limit=6)
    if not asks:
        return None

    low = text.lower()
    # Prefer matching when they mention merchant / amount, else take most recent matching kind
    credit_hits = ("refund", "family", "salary", "payroll", "mom", "dad", "parents", "gift", "side", "freelance", "client", "came from", "it was", "that was", "from my")
    spend_hits = ("planned", "impulse", "necessary", "treat", "needed", "my bad", "accident", "worth it")

    chosen = None
    if any(h in low for h in credit_hits):
        chosen = next((a for a in asks if a.get("kind") == "credit_source"), None)
    if chosen is None and any(h in low for h in spend_hits):
        chosen = next((a for a in asks if a.get("kind") == "spend_probe"), None)
    # One open ask + short non-question reply → treat as the answer
    if chosen is None and len(asks) == 1 and len(text) <= 100 and not text.rstrip().endswith("?"):
        starters = ("what", "how", "why", "can you", "should i", "help", "tell me", "show", "hi", "hello")
        if not any(low.startswith(s) for s in starters):
            chosen = asks[0]

    if not chosen:
        return None
    nudge_id = chosen.get("dedupe_key")
    if not nudge_id:
        return None
    try:
        return answer_lifecycle_nudge(
            memories=memories,
            learned_facts=learned_facts,
            kind=str(chosen.get("kind") or ""),
            nudge_id=str(nudge_id),
            answer=text,
            free_text=text,
            sessions=None,
        )
    except ValueError:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _week_key(dt: datetime | None = None) -> str:
    d = dt or _now()
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _day_key(dt: datetime | None = None) -> str:
    d = dt or _now()
    return d.strftime("%Y-%m-%d")


def get_or_create_session(
    sessions: Collection,
    *,
    period: str = "week",
) -> dict[str, Any]:
    key = _week_key() if period == "week" else _day_key()
    doc = sessions.find_one({"session_key": key})
    if doc:
        return _ser_session(doc)
    now = _now()
    fresh = {
        "session_key": key,
        "period": period,
        "messages": [],
        "created_at": now,
        "updated_at": now,
    }
    res = sessions.insert_one(fresh)
    fresh["_id"] = res.inserted_id
    return _ser_session(fresh)


def _ser_session(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    for key in ("created_at", "updated_at"):
        val = out.get(key)
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    msgs = []
    for m in out.get("messages") or []:
        mm = dict(m)
        if isinstance(mm.get("at"), datetime):
            mm["at"] = mm["at"].isoformat()
        msgs.append(mm)
    out["messages"] = msgs
    return out


def append_session_message(
    sessions: Collection,
    session_key: str,
    *,
    role: str,
    content: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    msg = {
        "role": role,
        "content": content.strip()[:4000],
        "at": _now(),
        "meta": meta or {},
    }
    sessions.update_one(
        {"session_key": session_key},
        {
            "$push": {"messages": {"$each": [msg], "$slice": -80}},
            "$set": {"updated_at": _now()},
        },
    )
    doc = sessions.find_one({"session_key": session_key})
    return _ser_session(doc or {"_id": session_key, "session_key": session_key, "messages": [msg]})


def _load_analytics_bundle(
    *,
    transactions: Collection,
    portfolio: Collection | None,
    networth_snapshots: Collection | None,
    liabilities: Collection | None,
    budgets: Collection | None,
    sip_overrides: Collection | None,
    settings: Collection | None,
    learned_facts: Collection | None,
    goals_col: Collection | None,
) -> dict[str, Any]:
    from analytics import build_analytics
    from smart_insights import attach_smart_insights

    analytics = build_analytics(
        transactions,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities,
        budgets=budgets,
        learned_facts=learned_facts,
    )
    return attach_smart_insights(
        analytics,
        transactions,
        sip_overrides=sip_overrides,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )


def chat(
    *,
    sessions: Collection,
    memories: Collection,
    question: str,
    transactions: Collection,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    sip_overrides: Collection | None = None,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    provider_name: str | None = None,
    period: str = "week",
) -> dict[str, Any]:
    """Full-context advisor chat — same grounding as reports."""
    session = get_or_create_session(sessions, period=period)
    analytics = _load_analytics_bundle(
        transactions=transactions,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities,
        budgets=budgets,
        sip_overrides=sip_overrides,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    severity = analytics.get("advisor_severity") or severity_from_analytics_bundle(
        analytics, settings=settings, learned_facts=learned_facts, goals_col=goals_col
    )
    profile = advisor_profile_from_facts(learned_facts)
    maybe_append_from_severity(memories, severity=severity, profile=profile)

    # If they're answering an open "where from?" / "why spend?" in free text — remember it
    captured = capture_open_nudge_from_chat(
        message=question,
        memories=memories,
        learned_facts=learned_facts,
    )

    # Goal milestones → memory
    if goals_col is not None:
        for g in goals_col.find({"status": "active"}).limit(10):
            funding = g.get("funding") or {}
            pct = float(funding.get("progress_pct") or 0)
            # progress may live on goal after enrich; compute rough from saved/target
            if pct <= 0:
                target = float(g.get("manual_price") or g.get("target_price") or 0)
                saved = float(g.get("saved_amount") or 0)
                pct = round(min(100.0, saved / target * 100), 1) if target > 0 else 0.0
            maybe_append_goal_milestone(
                memories,
                goal_name=str(g.get("name") or "Goal"),
                progress_pct=pct,
                profile=profile,
            )

    mem_lines = memories_for_prompt(memories, limit=8)
    system = build_chat_system_prompt(
        learned_facts=learned_facts,
        severity=severity,
    )

    history = session.get("messages") or []
    hist_txt = "\n".join(_llm_history_lines(history, limit=6))
    goals_slim = []
    if goals_col is not None:
        for g in goals_col.find({"status": "active"}).sort("priority", 1).limit(3):
            target = float(g.get("manual_price") or g.get("target_price") or 0)
            saved = float(g.get("saved_amount") or 0)
            goals_slim.append(
                {
                    "name": g.get("name"),
                    "saved": saved,
                    "target": target,
                    "progress_pct": round(min(100.0, saved / target * 100), 1) if target else 0,
                }
            )

    user_state = build_compact_chat_user_state(
        analytics,
        severity=severity,
        profile=profile,
        goals=goals_slim,
        memory_lines=mem_lines,
        learned_facts=learned_facts,
        just_remembered=(captured or {}).get("remembered"),
    )
    remember_bit = ""
    if captured:
        remember_bit = (
            f"\nYou just saved: {captured.get('remembered')}. Acknowledge briefly.\n"
        )
    user = (
        f"Conversation (last 6 turns):\n{hist_txt or '(new session)'}\n\n"
        f"UserState (JSON):\n{_compact(user_state)}\n\n"
        f"User message: {question.strip()}\n"
        f"{remember_bit}"
        f"{CHAT_USER_SUFFIX}"
    )

    append_session_message(sessions, session["session_key"], role="user", content=question.strip())
    provider = get_chat_provider(provider_name)
    answer = provider.complete(system, user, temperature=0.3)
    session = append_session_message(
        sessions,
        session["session_key"],
        role="advisor",
        content=answer,
        meta={
            "severity": severity.get("level"),
            "provider": provider.name,
            "model": getattr(provider, "model", None),
            "captured_nudge": (captured or {}).get("nudge_id"),
        },
    )
    return {
        "answer": answer,
        "provider": provider.name,
        "model": getattr(provider, "model", None),
        "session": session,
        "advisor_severity": severity,
        "briefing": analytics.get("advisor"),
        "remembered": (captured or {}).get("remembered"),
    }


def decision_comment(
    *,
    action: DecisionAction,
    payload: dict[str, Any],
    memories: Collection | None = None,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    analytics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One-line advisor interjection for a user action — deterministic, grounded."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    motivation = profile.get("motivation") or "your goal"
    soft = profile.get("soft_spot")
    severity = (analytics or {}).get("advisor_severity") or severity_from_analytics_bundle(
        analytics,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    level = severity.get("level") or "informational"

    # Active goal snapshot
    goal_name = motivation
    progress = None
    status_line = None
    if goals_col is not None:
        g = goals_col.find_one({"status": "active"}, sort=[("priority", 1)])
        if g:
            goal_name = str(g.get("name") or motivation)
            target = float(g.get("manual_price") or g.get("target_price") or 0)
            saved = float(g.get("saved_amount") or 0)
            progress = round(min(100.0, saved / target * 100), 1) if target else None
            status_line = (g.get("funding") or {}).get("status_line")

    amount = payload.get("amount")
    merchant = payload.get("merchant") or payload.get("instrument") or payload.get("category")
    try:
        amt_s = f"₹{float(amount):,.0f}" if amount is not None else None
    except (TypeError, ValueError):
        amt_s = None

    comment = ""
    if action == "liability_txn" or action == "category_change":
        cat = str(payload.get("category") or "")
        is_liability = payload.get("wealth_class") == "liability" or cat in {
            "Shopping",
            "Food & Dining",
            "Entertainment",
        }
        if is_liability and level in {"concerned", "strict"}:
            comment = (
                f"{name}, {amt_s or 'that spend'} at {merchant or cat} hits Discretionary. "
                f"{goal_name} is still the priority"
                + (f" ({progress:.0f}% funded)" if progress is not None else "")
                + ". Confirm only if it fits the salary-day split."
            )
        elif is_liability:
            comment = (
                f"{name}, noted — {amt_s or 'this'} toward {merchant or cat}. "
                f"Fine if planned; {goal_name} still needs quiet months."
            )
        else:
            comment = f"{name}, category locked. Keep investing first."
        if soft and merchant and soft.lower().split()[0] in str(merchant).lower():
            comment += f" Soft spot ({soft}) — eyes open."

    elif action == "sip_mark_invested":
        comment = (
            f"{name}, good — {merchant or 'SIP'} marked invested. "
            f"That's the pay-yourself-first muscle that funds {goal_name}."
        )
        if memories is not None:
            from advisor_memory import append_memory

            append_memory(
                memories,
                kind="sip_recovered",
                summary=f"{name} marked SIP '{merchant}' invested.",
                meta=payload,
                dedupe_key=f"sip_mark:{merchant}:{_now().strftime('%Y-%m')}",
            )

    elif action == "goal_contribute":
        comment = (
            f"{name}, logged {amt_s or 'a contribution'} toward {payload.get('goal_name') or goal_name}. "
            f"Boring bricks beat loud tips."
        )
        if progress is not None and memories is not None:
            maybe_append_goal_milestone(
                memories,
                goal_name=str(payload.get("goal_name") or goal_name),
                progress_pct=float(payload.get("progress_pct") or progress),
                profile=profile,
            )

    elif action == "goal_complete":
        comment = (
            f"{name} — {payload.get('goal_name') or goal_name} done. "
            "Logged as Shopping liability so the ledger stays honest. Celebrate, then pick the next goal."
        )

    elif action == "drift_dismiss":
        comment = (
            f"{name}, dismissing drift is fine once — not every month. "
            "Rebalance when the gap keeps growing."
        )

    elif action == "learn_question":
        comment = (
            f"{name}, I'm asking because I want to coach you better — "
            "not to quiz you. Answer when you can."
        )
    else:
        comment = f"{name}, noted."

    if status_line and action in {"liability_txn", "category_change", "goal_contribute"}:
        comment += f" ({status_line})"

    return {
        "comment": comment.strip(),
        "advisor_severity": level,
        "goal_name": goal_name,
        "progress_pct": progress,
        "preferred_name": name,
    }


def goal_impact_for_spend(
    *,
    amount: float,
    category: str | None,
    goals_col: Collection | None,
    learned_facts: Collection | None = None,
    settings: Collection | None = None,
) -> dict[str, Any]:
    """Recompute rough time-to-goal if this discretionary spend instead went to the goal."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    if goals_col is None or amount <= 0:
        return {"comment": None, "impact": None}

    g = goals_col.find_one({"status": "active"}, sort=[("priority", 1)])
    if not g:
        return {"comment": None, "impact": None}

    goal_name = str(g.get("name") or profile.get("motivation") or "your goal")
    target = float(g.get("manual_price") or g.get("target_price") or 0)
    saved = float(g.get("saved_amount") or 0)
    remaining = max(0.0, target - saved)
    pace = float(g.get("monthly_contribution") or 0)
    if pace <= 0:
        # fallback: assume remaining/6
        pace = remaining / 6 if remaining > 0 else 0

    months_now = round(remaining / pace, 1) if pace > 0 else None
    months_if_saved = (
        round(max(0.0, remaining - amount) / pace, 1) if pace > 0 else None
    )
    delta = None
    if months_now is not None and months_if_saved is not None:
        delta = round(months_now - months_if_saved, 1)

    lifestyle_cats = {
        "Shopping",
        "Food & Dining",
        "Entertainment",
        "Travel",
        "Personal Care",
    }
    relevant = (category or "") in lifestyle_cats
    if not relevant or remaining <= 0:
        return {"comment": None, "impact": None}

    if delta and delta >= 0.1:
        comment = (
            f"{name}, ₹{amount:,.0f} here is ~{delta} month(s) on {goal_name} "
            f"at your current pace"
            + (f" ({months_now} → {months_if_saved} mo)" if months_now else "")
            + "."
        )
    elif remaining > 0 and pace > 0:
        comment = (
            f"{name}, {goal_name} still needs ~₹{remaining:,.0f} "
            f"(~{months_now} mo at ₹{pace:,.0f}/mo). This spend is fine if planned."
        )
    else:
        comment = None

    return {
        "comment": comment,
        "impact": {
            "goal_name": goal_name,
            "remaining": remaining,
            "months_now": months_now,
            "months_if_redirected": months_if_saved,
            "delta_months": delta,
            "amount": amount,
        },
        "preferred_name": name,
    }


def _as_utc(dt: Any) -> datetime | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def detect_money_mood(
    *,
    analytics: dict[str, Any] | None = None,
    transactions: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
) -> dict[str, Any]:
    """Deterministic mood layer: month_start / salary_happy / spend_curious / credit_curious."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    motivation = profile.get("motivation") or "your goal"
    soft = profile.get("soft_spot")
    now = _now()
    ym = now.strftime("%Y-%m")
    o = (analytics or {}).get("overview") or {}
    salary_total = float(o.get("salary_total") or 0)
    lifestyle = float(o.get("lifestyle_spend") or 0)

    goal_name = motivation
    if goals_col is not None:
        g = goals_col.find_one({"status": "active"}, sort=[("priority", 1)])
        if g and g.get("name"):
            goal_name = str(g["name"])

    mood = "steady"
    headline = None
    signals: dict[str, Any] = {}

    # 1) Fresh month energy (days 1–3)
    if now.day <= MONTH_START_DAYS:
        mood = "month_start"
        headline = (
            f"{name} — new month, clean slate. I'm excited for this one. "
            f"Let's lock the plan for {goal_name}: Invest → Buffer → Goals → then play. "
            "What are we protecting first this month?"
        )
        signals["month_start"] = True

    # 2) Salary landed this month — be happy
    recent_salary = None
    if transactions is not None:
        since = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        for doc in transactions.find(
            {"type": "credit", "received_at": {"$gte": since}},
            {"amount": 1, "merchant": 1, "raw_text": 1, "received_at": 1, "category": 1},
        ).sort("received_at", -1).limit(40):
            if is_salary_source(doc.get("merchant"), doc.get("raw_text"), doc.get("category")):
                recent_salary = doc
                break
            if str(doc.get("category") or "") == "Income" and float(doc.get("amount") or 0) >= 20_000:
                # Heuristic: large Income credit early in month often salary
                if now.day <= SALARY_WINDOW_DAYS:
                    recent_salary = doc
                    break

    if recent_salary is not None or (salary_total > 0 and now.day <= SALARY_WINDOW_DAYS):
        amt = float((recent_salary or {}).get("amount") or salary_total or 0)
        # Prefer salary mood over generic month_start once money is in
        mood = "salary_happy"
        drag = temptation_label(
            profile=profile,
            analytics=analytics,
            transactions=transactions,
        )
        headline = (
            f"{name}!!! Salary's in"
            + (f" — ₹{amt:,.0f}" if amt else "")
            + f". Love that for you. Pay yourself first before {drag} tempts you. "
            f"Split today → SIPs, buffer, then {goal_name}."
        )
        signals["salary"] = {"amount": amt, "merchant": (recent_salary or {}).get("merchant")}

    return {
        "mood": mood,
        "headline": headline,
        "preferred_name": name,
        "goal_name": goal_name,
        "soft_spot": soft,
        "signals": signals,
        "lifestyle_mtd": lifestyle,
        "salary_mtd": salary_total,
        "month": ym,
    }


def build_lifecycle_nudges(
    *,
    memories: Collection,
    analytics: dict[str, Any] | None = None,
    transactions: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
) -> list[dict[str, Any]]:
    """Month-start excitement, salary cheer, spend 'why?', credit 'where from?'."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    soft = profile.get("soft_spot") or temptation_label(
        profile=profile,
        analytics=analytics,
        transactions=transactions,
    )
    mood = detect_money_mood(
        analytics=analytics,
        transactions=transactions,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    ym = mood["month"]
    nudges: list[dict[str, Any]] = []
    goal_name = mood["goal_name"]

    if mood["mood"] == "month_start" and mood.get("headline"):
        append_memory(
            memories,
            kind="month_start",
            summary=f"{name}: new month energy — planning for {goal_name}.",
            meta={"month": ym},
            dedupe_key=f"month_start:{ym}",
        )
        nudges.append(
            {
                "id": f"month-start-{ym}",
                "kind": "month_start",
                "severity": "informational",
                "title": f"New month · {name}",
                "message": mood["headline"],
                "source": "lifecycle",
            }
        )

    if mood["mood"] == "salary_happy" and mood.get("headline"):
        amt = (mood.get("signals") or {}).get("salary", {}).get("amount")
        append_memory(
            memories,
            kind="salary_day",
            summary=(
                f"{name}: salary credited"
                + (f" ₹{float(amt):,.0f}" if amt else "")
                + f" — celebrate, then salary-day split for {goal_name}."
            ),
            meta={"month": ym, "amount": amt},
            dedupe_key=f"salary_day:{ym}",
        )
        nudges.append(
            {
                "id": f"salary-{ym}",
                "kind": "salary_happy",
                "severity": "informational",
                "title": "Salary day 🎉",
                "message": mood["headline"],
                "source": "lifecycle",
            }
        )

    # Probe big lifestyle spends this month
    if transactions is not None:
        since = datetime(_now().year, _now().month, 1, tzinfo=timezone.utc)
        lifestyle_cats = {
            "Shopping",
            "Food & Dining",
            "Entertainment",
            "Travel",
            "Personal Care",
        }
        for doc in transactions.find(
            {
                "type": "debit",
                "received_at": {"$gte": since},
                "category": {"$in": list(lifestyle_cats)},
            },
            {"amount": 1, "merchant": 1, "category": 1, "received_at": 1},
        ).sort("amount", -1).limit(8):
            amt = float(doc.get("amount") or 0)
            if amt < SPEND_PROBE_INR:
                continue
            merchant = str(doc.get("merchant") or doc.get("category") or "that spend")
            day = (_as_utc(doc.get("received_at")) or _now()).strftime("%Y-%m-%d")
            key = f"spend_probe:{ym}:{merchant.lower()[:40]}:{int(amt)}"
            if is_nudge_answered(memories, key):
                continue
            mem = append_memory(
                memories,
                kind="spend_probe",
                summary=f"{name} spent ₹{amt:,.0f} at {merchant} — asked why.",
                meta={"amount": amt, "merchant": merchant, "category": doc.get("category")},
                dedupe_key=key,
            )
            if not mem:
                continue
            soft_bit = f" Soft spot check ({soft})." if soft and soft.lower().split()[0] in merchant.lower() else ""
            nudges.append(
                {
                    "id": key,
                    "kind": "spend_probe",
                    "severity": "concerned",
                    "title": f"Why ₹{amt:,.0f} here?",
                    "message": (
                        f"{name}, I saw ₹{amt:,.0f} at {merchant} ({doc.get('category')}). "
                        f"What was that for — planned, or impulse?{soft_bit} "
                        f"{goal_name} is watching. Type it below if the buttons don't fit."
                    ),
                    "source": "lifecycle",
                    "ask": True,
                }
            )
            if sum(1 for n in nudges if n["kind"] == "spend_probe") >= 2:
                break

        # Unexplained credits — ask where money came from
        for doc in transactions.find(
            {
                "type": "credit",
                "received_at": {"$gte": since},
            },
            {"amount": 1, "merchant": 1, "raw_text": 1, "category": 1, "received_at": 1},
        ).sort("received_at", -1).limit(20):
            amt = float(doc.get("amount") or 0)
            if amt < CREDIT_ASK_INR:
                continue
            if is_salary_source(doc.get("merchant"), doc.get("raw_text"), doc.get("category")):
                continue
            cat = str(doc.get("category") or "")
            if cat in {"Transfers", "Investments"}:
                continue
            merchant = str(doc.get("merchant") or "unknown source")
            key = f"credit_ask:{ym}:{merchant.lower()[:40]}:{int(amt)}"
            if is_nudge_answered(memories, key):
                continue
            # If we already know this merchant's usual source, mention it — don't re-grill
            known = None
            if learned_facts is not None:
                known = learned_facts.find_one(
                    {
                        "fact_type": "income_profile",
                        "key_norm": f"credit_from:{merchant.lower()[:60]}",
                    }
                )
            mem = append_memory(
                memories,
                kind="credit_source",
                summary=(
                    f"{name}: ₹{amt:,.0f} credit from {merchant} — "
                    + (
                        f"likely {known.get('value')} (from past answer); confirmed ask soft."
                        if known
                        else "asked where it came from."
                    )
                ),
                meta={"amount": amt, "merchant": merchant, "category": cat},
                dedupe_key=key,
            )
            if not mem:
                continue
            if known and known.get("value"):
                # Soft continuity nudge — not a blank "where from?"
                nudges.append(
                    {
                        "id": key,
                        "kind": "credit_source",
                        "severity": "informational",
                        "title": "Same source?",
                        "message": (
                            f"{name}, another ₹{amt:,.0f} from {merchant}. "
                            f"Last time you said these are usually {known.get('value')} — still true, "
                            "or something different? Tap or type below; I'll remember."
                        ),
                        "source": "lifecycle",
                        "ask": True,
                        "known_answer": known.get("value"),
                    }
                )
            else:
                nudges.append(
                    {
                        "id": key,
                        "kind": "credit_source",
                        "severity": "informational",
                        "title": "Where did this come from?",
                        "message": (
                            f"{name}, ₹{amt:,.0f} just credited"
                            + (f" from {merchant}" if merchant != "unknown source" else "")
                            + ". Is that salary leftover, a refund, family, or something else? "
                            "Tap a button or type it — I'll remember for next time."
                        ),
                        "source": "lifecycle",
                        "ask": True,
                    }
                )
            if sum(1 for n in nudges if n["kind"] == "credit_source") >= 2:
                break

    return nudges


def on_new_transaction(
    *,
    txn: dict[str, Any],
    memories: Collection,
    sessions: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    transactions: Collection | None = None,
) -> dict[str, Any] | None:
    """Realtime advisor reaction when an SMS/txn is stored."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    motivation = profile.get("motivation") or "your goal"
    if goals_col is not None:
        g = goals_col.find_one({"status": "active"}, sort=[("priority", 1)])
        if g and g.get("name"):
            motivation = str(g["name"])

    typ = str(txn.get("type") or "")
    amt = float(txn.get("amount") or 0)
    merchant = str(txn.get("merchant") or "unknown")
    cat = str(txn.get("category") or "")
    ym = _now().strftime("%Y-%m")
    message = None
    kind = "note"

    if typ == "credit" and is_salary_source(txn.get("merchant"), txn.get("raw_text"), cat):
        kind = "salary_day"
        drag = temptation_label(profile=profile, transactions=transactions)
        message = (
            f"{name}!!! Salary hit — ₹{amt:,.0f}. I'm genuinely happy for you. "
            f"Do the split now: Invest → Buffer → {motivation} → then play. "
            f"Hold off on {drag} until the split is done."
        )
        append_memory(
            memories,
            kind="salary_day",
            summary=f"{name}: salary ₹{amt:,.0f} credited — celebrated + reminded salary-day split.",
            meta={"amount": amt, "merchant": merchant},
            dedupe_key=f"salary_day:{ym}",
        )
    elif typ == "credit" and amt >= CREDIT_ASK_INR and cat not in {"Transfers", "Investments"}:
        kind = "credit_source"
        key = f"credit_ask:{ym}:{merchant.lower()[:40]}:{int(amt)}"
        if is_nudge_answered(memories, key):
            return None
        known = None
        if learned_facts is not None:
            known = learned_facts.find_one(
                {
                    "fact_type": "income_profile",
                    "key_norm": f"credit_from:{merchant.lower()[:60]}",
                }
            )
        if known and known.get("value"):
            message = (
                f"{name}, ₹{amt:,.0f} from {merchant} again. "
                f"Still {known.get('value')}, or different this time?"
            )
        else:
            message = (
                f"{name}, ₹{amt:,.0f} just came in from {merchant}. "
                "Where did this money come from — refund, family, side cash, or something else? "
                "You can type it — I'll remember."
            )
        append_memory(
            memories,
            kind="credit_source",
            summary=f"{name}: asked source of ₹{amt:,.0f} credit ({merchant}).",
            meta={"amount": amt, "merchant": merchant},
            dedupe_key=key,
        )
    elif typ == "debit" and cat in {
        "Shopping",
        "Food & Dining",
        "Entertainment",
        "Travel",
        "Personal Care",
    } and amt >= SPEND_PROBE_INR:
        kind = "spend_probe"
        key = f"spend_probe:{ym}:{merchant.lower()[:40]}:{int(amt)}"
        if is_nudge_answered(memories, key):
            return None
        message = (
            f"{name}, ₹{amt:,.0f} at {merchant} ({cat}). "
            f"Why this much — planned treat, or {profile.get('soft_spot') or 'impulse'}? "
            f"{motivation} is still on the board. Tap or type — I'll remember."
        )
        append_memory(
            memories,
            kind="spend_probe",
            summary=f"{name}: probed ₹{amt:,.0f} spend at {merchant}.",
            meta={"amount": amt, "merchant": merchant, "category": cat},
            dedupe_key=key,
        )

    if not message:
        return None

    nudge_id = (
        f"credit_ask:{ym}:{merchant.lower()[:40]}:{int(amt)}"
        if kind == "credit_source"
        else f"spend_probe:{ym}:{merchant.lower()[:40]}:{int(amt)}"
        if kind == "spend_probe"
        else f"live-{kind}-{ym}-{int(amt)}"
    )
    nudge = {
        "id": nudge_id,
        "kind": kind,
        "severity": "concerned" if kind == "spend_probe" else "informational",
        "title": (
            "Salary day 🎉"
            if kind == "salary_day"
            else "Where did this come from?"
            if kind == "credit_source"
            else "Why this spend?"
        ),
        "message": message,
        "source": "live_txn",
        "ask": kind in {"credit_source", "spend_probe"},
    }
    if sessions is not None:
        session = get_or_create_session(sessions, period="week")
        append_session_message(
            sessions,
            session["session_key"],
            role="advisor",
            content=message,
            meta={"kind": kind, "nudge": True, "exclude_from_llm": True},
        )
    return nudge


def collect_nudges(
    *,
    memories: Collection,
    sessions: Collection | None = None,
    analytics: dict[str, Any] | None = None,
    transactions: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    learn_questions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Event-style nudges for the chat widget inbox."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    nudges: list[dict[str, Any]] = []
    analytics = analytics or {}
    severity = analytics.get("advisor_severity") or {}
    level = severity.get("level") or "informational"

    maybe_append_from_severity(memories, severity=severity, profile=profile)

    nudges.extend(
        build_lifecycle_nudges(
            memories=memories,
            analytics=analytics,
            transactions=transactions,
            learned_facts=learned_facts,
            goals_col=goals_col,
        )
    )

    # SIP / alert based
    for a in (analytics.get("alerts") or [])[:12]:
        atype = str(a.get("type") or "")
        if atype in {"sip_stopped", "sip_missing", "sip_lapsed"} or "sip" in atype.lower():
            nudges.append(
                {
                    "id": f"alert-{atype}-{a.get('title')}",
                    "kind": "sip_lapse",
                    "severity": a.get("advisor_severity") or level,
                    "title": a.get("title") or "SIP check",
                    "message": a.get("advisor_message") or a.get("message"),
                    "source": "alert",
                }
            )
        elif a.get("advisor_severity") in {"concerned", "strict"}:
            nudges.append(
                {
                    "id": f"alert-{a.get('type')}-{a.get('title')}",
                    "kind": "alert",
                    "severity": a.get("advisor_severity"),
                    "title": a.get("title"),
                    "message": a.get("advisor_message") or a.get("message"),
                    "source": "alert",
                }
            )

    # Goal milestones from memory (recent)
    for m in list_memories(memories, limit=8, kind="goal_milestone"):
        nudges.append(
            {
                "id": f"mem-{m.get('id')}",
                "kind": "goal_milestone",
                "severity": "informational",
                "title": "Goal milestone",
                "message": m.get("summary"),
                "source": "memory",
            }
        )

    # Learn questions as advisor asks
    for q in (learn_questions or [])[:3]:
        nudges.append(
            {
                "id": f"learn-{q.get('id')}",
                "kind": "learn_question",
                "severity": "informational",
                "title": f"{name}, quick question",
                "message": q.get("prompt") or q.get("question"),
                "source": "learn",
                "question": q,
            }
        )

    # Briefing headline — skip if salary/month energy already leads
    briefing = analytics.get("advisor") or {}
    has_happy = any(n.get("kind") in {"salary_happy", "month_start"} for n in nudges)
    if briefing.get("headline") and level in {"concerned", "strict"} and not has_happy:
        nudges.insert(
            0,
            {
                "id": f"briefing-{level}",
                "kind": "briefing",
                "severity": level,
                "title": f"Advisor · {level}",
                "message": briefing.get("headline"),
                "source": "briefing",
            },
        )

    # Dedupe by id
    seen = set()
    out = []
    for n in nudges:
        nid = n.get("id")
        if nid in seen:
            continue
        seen.add(nid)
        out.append(n)
    return out[:15]


def presence_bootstrap(
    *,
    sessions: Collection,
    memories: Collection,
    transactions: Collection,
    portfolio: Collection | None = None,
    networth_snapshots: Collection | None = None,
    liabilities: Collection | None = None,
    budgets: Collection | None = None,
    sip_overrides: Collection | None = None,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
    learn_questions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    session = get_or_create_session(sessions, period="week")
    analytics = _load_analytics_bundle(
        transactions=transactions,
        portfolio=portfolio,
        networth_snapshots=networth_snapshots,
        liabilities=liabilities,
        budgets=budgets,
        sip_overrides=sip_overrides,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    profile = advisor_profile_from_facts(learned_facts)
    severity = analytics.get("advisor_severity") or {}
    maybe_append_from_severity(memories, severity=severity, profile=profile)

    mood = detect_money_mood(
        analytics=analytics,
        transactions=transactions,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    briefing = analytics.get("advisor") or system_briefing(
        learned_facts=learned_facts,
        severity=severity,
        analytics=analytics,
    )
    # Prefer salary / month-start energy on the banner when present
    if mood.get("headline") and mood.get("mood") in {"salary_happy", "month_start"}:
        briefing = {
            **briefing,
            "headline": mood["headline"],
            "level": "informational",
            "mood": mood["mood"],
        }

    nudges = collect_nudges(
        memories=memories,
        sessions=sessions,
        analytics=analytics,
        transactions=transactions,
        learned_facts=learned_facts,
        goals_col=goals_col,
        learn_questions=learn_questions,
    )
    return {
        "session": session,
        "briefing": briefing,
        "advisor_severity": severity,
        "mood": mood,
        "nudges": nudges,
        "memories": list_memories(memories, limit=15),
        "profile": {
            "preferred_name": profile.get("preferred_name"),
            "completeness": profile.get("completeness"),
            "motivation": profile.get("motivation"),
            "soft_spot": profile.get("soft_spot"),
        },
        "settings": get_advisor_persona_settings(settings),
    }
