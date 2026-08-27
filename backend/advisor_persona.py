"""Advisor Persona — shared voice, deterministic severity, prompt grounding.

Severity is ALWAYS computed in app code from real thresholds/history.
The LLM only matches tone to the severity we pass in — it never decides seriousness.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from pymongo.collection import Collection

from learned_facts import (
    advisor_profile_from_facts,
    facts_for_ai_context,
    persona_is_trained,
    trained_profile_fields,
)

Severity = Literal["informational", "concerned", "strict"]

SETTINGS_ID = "advisor_persona"
DEFAULT_PERSONA_PATH = Path(__file__).resolve().parent / "config" / "advisor_persona.txt"

# How many consecutive months before STRICT (scaled by sensitivity 0-100)
BASE_STRICT_MONTHS = 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


def default_persona_text() -> str:
    path = DEFAULT_PERSONA_PATH
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    return (
        "You are the user's ongoing money advisor. Be direct, plainspoken, and warm "
        "without false cheer. Ground every claim in the numbers provided. Never invent figures."
    )


def get_advisor_persona_settings(settings: Collection | None) -> dict[str, Any]:
    doc: dict[str, Any] = {}
    if settings is not None:
        doc = settings.find_one({"_id": SETTINGS_ID}) or {}
    persona = (doc.get("persona_text") or "").strip() or default_persona_text()
    sensitivity = doc.get("strictness_sensitivity")
    try:
        sensitivity_n = int(sensitivity) if sensitivity is not None else 50
    except (TypeError, ValueError):
        sensitivity_n = 50
    sensitivity_n = max(0, min(100, sensitivity_n))
    return {
        "persona_text": persona,
        "strictness_sensitivity": sensitivity_n,
        "version": int(doc.get("version") or 1),
        "updated_at": (
            doc["updated_at"].isoformat()
            if isinstance(doc.get("updated_at"), datetime)
            else doc.get("updated_at")
        ),
        "using_file_default": not bool((doc.get("persona_text") or "").strip()),
    }


def save_advisor_persona_settings(
    settings: Collection,
    *,
    persona_text: str | None = None,
    strictness_sensitivity: int | None = None,
    reset_persona_to_default: bool = False,
) -> dict[str, Any]:
    current = get_advisor_persona_settings(settings)
    patch: dict[str, Any] = {"updated_at": _now()}
    if reset_persona_to_default:
        patch["persona_text"] = default_persona_text()
        patch["version"] = int(current.get("version") or 1) + 1
    elif persona_text is not None:
        cleaned = persona_text.strip()
        if cleaned and cleaned != current.get("persona_text"):
            patch["persona_text"] = cleaned
            patch["version"] = int(current.get("version") or 1) + 1
        elif cleaned:
            patch["persona_text"] = cleaned
    else:
        patch["persona_text"] = current["persona_text"]

    if strictness_sensitivity is not None:
        patch["strictness_sensitivity"] = max(0, min(100, int(strictness_sensitivity)))
    else:
        patch["strictness_sensitivity"] = current["strictness_sensitivity"]

    settings.update_one(
        {"_id": SETTINGS_ID},
        {"$set": patch, "$setOnInsert": {"_id": SETTINGS_ID}},
        upsert=True,
    )
    return get_advisor_persona_settings(settings)


def _strict_month_threshold(sensitivity: int) -> int:
    """Lower sensitivity = more patience before STRICT."""
    # sensitivity 0 → need 4 months; 50 → 2; 100 → 1
    if sensitivity >= 85:
        return 1
    if sensitivity >= 60:
        return 2
    if sensitivity >= 30:
        return 3
    return 4


def compute_advisor_severity(
    *,
    analytics: dict[str, Any] | None = None,
    planning_advisor: dict[str, Any] | None = None,
    goal_docs: list[dict[str, Any]] | None = None,
    liability_ratio_history: list[float] | None = None,
    liability_ratio_threshold: float = 0.35,
    sensitivity: int = 50,
    force: Severity | None = None,
) -> dict[str, Any]:
    """
    Deterministic severity from real app signals.

    Returns { level, reasons[], context_line, repetition_note }.
    """
    if force in {"informational", "concerned", "strict"}:
        return {
            "level": force,
            "reasons": ["forced_preview"],
            "context_line": f"tone: {force} — preview sample",
            "repetition_note": None,
            "signals": {},
        }

    smart = (analytics or {}).get("smart") or {}
    sip = smart.get("sip") or {}
    drift = smart.get("drift") or {}
    creep = smart.get("subscription_creep") or {}
    forecast = smart.get("spend_forecast") or {}
    overview = (analytics or {}).get("overview") or {}
    mom = (analytics or {}).get("mom") or {}

    reasons_strict: list[str] = []
    reasons_concerned: list[str] = []
    signals: dict[str, Any] = {}

    months_needed = _strict_month_threshold(sensitivity)

    # SIP lapses
    for s in sip.get("sips") or []:
        status = str(s.get("status") or "")
        name = s.get("name") or s.get("instrument") or "SIP"
        if status == "stopped":
            reasons_strict.append(f"SIP '{name}' appears stopped/lapsed")
            signals["sip_stopped"] = True
        elif status == "missing":
            reasons_concerned.append(f"SIP '{name}' missing this month")
            signals["sip_missing"] = True

    # Portfolio drift — first-time vs repeated hard to know; treat any as concerned
    drifts = drift.get("drifts") or []
    if drifts:
        top = drifts[0]
        reasons_concerned.append(
            f"Allocation drift: {top.get('asset_class')} "
            f"{float(top.get('delta_pp') or 0):+.1f}pp vs target"
        )
        signals["drift"] = True

    # Subscription creep
    for item in creep.get("items") or []:
        st = str(item.get("status") or "")
        if st in {"price_up", "missing"}:
            reasons_concerned.append(
                f"Subscription '{item.get('name') or item.get('merchant')}' status={st}"
            )
            signals["subscription_creep"] = True

    # Lifestyle inflation / spend pace
    pace = float(forecast.get("pace_pct") or 0)
    if forecast.get("status") == "over" or pace >= 115:
        reasons_concerned.append(
            f"Lifestyle pace ~{pace:.0f}% of usual month — inflation risk"
        )
        signals["lifestyle_pace_over"] = pace
    debit_pct = mom.get("debit_pct")
    try:
        if debit_pct is not None and float(debit_pct) >= 25:
            reasons_concerned.append(f"Debits up {float(debit_pct):+.0f}% vs prior month")
            signals["mom_debit_spike"] = float(debit_pct)
    except (TypeError, ValueError):
        pass

    # Liability / discretionary pressure from planning advisor
    unlock = (planning_advisor or {}).get("cut_to_unlock") or {}
    overshoot = float(unlock.get("overshoot_inr") or 0)
    if (planning_advisor or {}).get("voice", {}).get("mood") == "strict" or overshoot >= 2500:
        reasons_concerned.append(f"Discretionary overshoot ₹{overshoot:,.0f}")
        signals["disc_overshoot"] = overshoot
    voice_mood = ((planning_advisor or {}).get("voice") or {}).get("mood")
    if voice_mood == "strict":
        reasons_strict.append("Planning advisor already in strict mood from your spend pattern")

    # Liability ratio history (if provided)
    hist = [float(x) for x in (liability_ratio_history or []) if x is not None]
    signals["liability_ratio_history"] = hist[-6:]
    consecutive_breach = 0
    for ratio in reversed(hist):
        if ratio > liability_ratio_threshold:
            consecutive_breach += 1
        else:
            break
    if consecutive_breach >= months_needed:
        reasons_strict.append(
            f"Liability/discretionary pressure above ceiling for {consecutive_breach} consecutive months"
        )
        signals["liability_streak"] = consecutive_breach
    elif consecutive_breach == 1:
        reasons_concerned.append("First month above liability/discretionary ceiling")
        signals["liability_streak"] = 1

    # Goal contribution streaks / misses
    missed_goals = []
    for g in goal_docs or []:
        if (g.get("status") or "active") != "active":
            continue
        months = list(g.get("contribution_months") or [])
        streak = int(g.get("streak_months") or 0)
        name = g.get("name") or "Goal"
        # Missed if no contribution this month and prior month also empty while goal active
        now = _now()
        ym = f"{now.year:04d}-{now.month:02d}"
        y, m = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
        prev = f"{y:04d}-{m:02d}"
        if ym not in months and prev not in months and float(g.get("saved_amount") or 0) == 0:
            # brand new goal — not a miss
            continue
        if ym not in months and prev not in months and streak == 0 and float(g.get("target_price") or 0) > 0:
            missed_goals.append(name)
            reasons_concerned.append(f"Goal '{name}' contribution quiet for 2+ months")
        elif ym not in months and streak == 0 and float(g.get("saved_amount") or 0) > 0:
            reasons_concerned.append(f"Goal '{name}' missed this month's contribution")

    if len(missed_goals) >= 1 and consecutive_breach >= months_needed:
        reasons_strict.append("Repeated goal funding misses alongside overspend pattern")

    # Lifestyle-to-income thin savings
    try:
        lts = float(overview.get("lifestyle_to_salary") or 0)
        if lts >= 85:
            reasons_concerned.append(f"Lifestyle is {lts:.0f}% of salary credits")
            signals["lifestyle_to_salary"] = lts
    except (TypeError, ValueError):
        pass

    if reasons_strict:
        level: Severity = "strict"
        reasons = reasons_strict + reasons_concerned
    elif reasons_concerned:
        level = "concerned"
        reasons = reasons_concerned
    else:
        level = "informational"
        reasons = ["On track — routine update"]

    # Build tone line for LLM
    top = reasons[0] if reasons else "routine"
    if level == "strict":
        context_line = (
            f"tone: strict — {top}. "
            f"Reference the repetition explicitly. Stay respectful, never insulting."
        )
        repetition = top
    elif level == "concerned":
        context_line = (
            f"tone: concerned — {top}. "
            f"Matter-of-fact, clear, no alarm and no judgment — state what changed."
        )
        repetition = None
    else:
        context_line = (
            "tone: informational — warm and specific. "
            "Cite the actual number or streak. Celebrate real wins without empty praise."
        )
        repetition = None

    return {
        "level": level,
        "reasons": reasons[:8],
        "context_line": context_line,
        "repetition_note": repetition,
        "signals": signals,
        "sensitivity": sensitivity,
        "strict_month_threshold": months_needed,
    }


def _tone_instructions(level: Severity) -> str:
    if level == "strict":
        return (
            "STYLE (strict): Direct and firm. Explicitly name the repeated pattern. "
            "Still respectful — never shame or insult. End with one concrete next action."
        )
    if level == "concerned":
        return (
            "STYLE (concerned): Matter-of-fact and clear. No alarm, no judgment. "
            "State what changed and what to watch. One practical suggestion max."
        )
    return (
        "STYLE (informational): Warm and specific. Cite real numbers/streaks. "
        "No empty praise, no corporate fluff."
    )


def _profile_grounding_block(profile: dict[str, Any]) -> list[str]:
    """Inject trained persona only when the user saved training answers."""
    name = profile.get("preferred_name") or "you"
    saved = trained_profile_fields(profile)

    if not persona_is_trained(profile):
        return [
            "PERSONA:",
            f"Address them as '{name}'.",
            "Neutral, data-grounded money coach — cite UserState numbers only.",
            "Do not assume a strict-friend, hype-coach, or casual-buddy voice until coach_tone is in UserState profile.",
        ]

    lines = [
        "IDENTITY:",
        f"You ARE their ongoing Money Advisor. Address them as '{name}'.",
        "Use their saved training answers from UserState profile — not a generic chatbot.",
    ]
    if saved.get("coach_tone"):
        lines.append(f"Match their coach tone: {saved['coach_tone']}.")
    bits: list[str] = []
    for key, label in (
        ("preferred_name", "Name"),
        ("coach_tone", "Coach tone"),
        ("soft_spot", "Soft spot (temptation)"),
        ("dealbreaker", "Dealbreaker"),
        ("why_money", "Why money matters"),
        ("pride", "Proud of"),
        ("strict_on", "Be strict about"),
        ("motivation", "Motivation / goal feeling"),
    ):
        val = saved.get(key)
        if val:
            bits.append(f"- {label}: {val}")
    if bits:
        lines.extend(["", "TRAINED PROFILE (from their answers — do not invent):", *bits])
    completeness = profile.get("completeness")
    if completeness is not None:
        lines.append(f"- Training completeness: {completeness}%")
    return lines


def build_chat_system_prompt(
    *,
    learned_facts: Collection | None = None,
    severity: dict[str, Any] | None = None,
) -> str:
    """Slim system prompt for floating advisor chat — avoids full persona file + fact dump."""
    profile = advisor_profile_from_facts(learned_facts)
    sev = severity or {
        "level": "informational",
        "context_line": "tone: informational",
        "reasons": [],
    }
    level: Severity = sev.get("level") or "informational"  # type: ignore[assignment]
    name = profile.get("preferred_name") or "you"

    parts = [
        f"You are {name}'s Money Advisor (INR, India). Second person; 2–5 sentences unless they ask for detail.",
        _tone_instructions(level),
        sev.get("context_line") or f"tone: {level}",
        "",
        "RULES:",
        "- Answer only what the user actually asked. Do not proactively bring up other "
        "categories, subscriptions, or alerts from UserState unless the user's question "
        "relates to them or explicitly asks for a broader check-in.",
        "- Use ONLY UserState JSON and conversation history for numbers and facts.",
        "- If UserState lacks what you need (specific txn, merchant, date, category, balance), "
        "say clearly what is missing — never invent amounts, trends, or merchant names.",
        "- Reuse profile, facts, and memory from UserState; never re-ask answered questions.",
        "- Protect Investments/SIPs; do not suggest cutting them for discretionary spend.",
        "- No OTP, passwords, or full account numbers.",
        "- One concrete next step when tone is concerned or strict — and only if it relates "
        "to the user's question.",
    ]
    profile_bits = _profile_grounding_block(profile)
    if profile_bits:
        parts.extend(["", *profile_bits])
    return "\n".join(parts).strip()


def build_persona_system_prompt(
    base_system: str,
    *,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    severity: dict[str, Any] | None = None,
    extra_grounding: str | None = None,
) -> str:
    """Compose system prompt: persona + trained profile + severity + learned facts + task."""
    cfg = get_advisor_persona_settings(settings)
    profile = advisor_profile_from_facts(learned_facts)
    sev = severity or {
        "level": "informational",
        "context_line": "tone: informational",
        "reasons": [],
    }
    level: Severity = sev.get("level") or "informational"  # type: ignore[assignment]

    facts_lines = []
    if learned_facts is not None:
        for row in facts_for_ai_context(learned_facts)[:25]:
            # Skip raw advisor_profile rows — already in TRAINED PROFILE block
            if row.get("type") == "advisor_profile":
                continue
            facts_lines.append(f"- [{row.get('type')}] {row.get('summary')}")

    parts = [
        cfg["persona_text"],
        "",
        *_profile_grounding_block(profile),
        "",
        _tone_instructions(level),
        sev.get("context_line") or f"tone: {level}",
        "",
        "HARD RULES:",
        "- Use ONLY numbers and facts provided in the user message / context JSON.",
        "- Never invent balances, returns, rates, or trends.",
        "- If a learned fact says something is planned/one-off, do not treat it as drift.",
        "- Do not stay silent about a repeated bad pattern when tone is concerned or strict.",
        "- Respect autonomy: advise, don't command as if you control their money.",
        "- Protect Investments/SIPs — never suggest cutting them to fund wants.",
        "- Sound like the same advisor who coaches them on the Money Advisor page.",
    ]
    if facts_lines:
        parts.extend(["", "Other learned preferences:", *facts_lines[:20]])
    if extra_grounding:
        parts.extend(["", extra_grounding.strip()])
    if (base_system or "").strip():
        parts.extend(["", "Task-specific instructions:", base_system.strip()])
    return "\n".join(parts).strip()


def _is_discretionary_spend_reason(reason: str) -> bool:
    """True when a severity reason is spend/lifestyle/overshoot — worth tying to goal soft-spot.

    Structural events (subscription price changes, SIPs, allocation drift, fees, bills)
    should not force-append trained motivation copy.
    """
    r = (reason or "").strip().lower()
    if not r:
        return False
    # Structural / non-discretionary — exclude even if other markers appear
    if "subscription" in r:
        return False
    if "allocation drift" in r:
        return False
    if r.startswith("sip ") or "sip '" in r:
        return False
    if "bank fee" in r or "scheduled bill" in r:
        return False
    markers = (
        "discretionary",
        "lifestyle",
        "debits up",
        "overshoot",
        "overspend",
        "impulse",
        "shopping",
        "spend pattern",
        "ceiling",
        "contribution quiet",
        "missed this month's contribution",
    )
    return any(m in r for m in markers)


def system_briefing(
    *,
    learned_facts: Collection | None = None,
    severity: dict[str, Any] | None = None,
    analytics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Short deterministic advisor strip for every page (same trained model as Planning)."""
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    level: Severity = (severity or {}).get("level") or "informational"  # type: ignore[assignment]
    reasons = list((severity or {}).get("reasons") or [])
    soft = profile.get("soft_spot")
    motivation = profile.get("motivation")
    why = profile.get("why_money")
    o = (analytics or {}).get("overview") or {}
    lifestyle = o.get("lifestyle_spend")
    salary = o.get("salary_total")
    now = _now()
    goal = motivation or "your goal"
    mood = "steady"
    # Informational banners may show profile stakes as ambient context.
    # Firm banners only when the triggering reason is discretionary/spend-related.
    show_profile_stakes = True

    # Month-start excitement & salary joy beat stern tones for the banner
    if now.day <= 3 and not (salary and float(salary or 0) > 0):
        mood = "month_start"
        level = "informational"
        line = (
            f"{name} — new month, clean slate. I'm excited for this one. "
            f"Let's lock the plan for {goal}: Invest → Buffer → Goals → then play."
        )
    elif salary and float(salary or 0) > 0 and now.day <= 10:
        mood = "salary_happy"
        level = "informational"
        try:
            amt = float(salary)
            amt_s = f" — ₹{amt:,.0f}"
        except (TypeError, ValueError):
            amt_s = ""
        line = (
            f"{name}!!! Salary's in{amt_s}. Love that for you. "
            f"Pay yourself first before shopping: SIPs, buffer, then {goal}."
        )
    elif level == "strict":
        mood = "strict"
        line = f"{name} — I'm not softening this. "
        if reasons:
            line += f"{reasons[0]}. "
        stakes_ok = (
            _is_discretionary_spend_reason(reasons[0]) if reasons else True
        )
        show_profile_stakes = stakes_ok
        if stakes_ok and soft:
            line += f"You named your soft spot ({soft}) — we're in it. "
        if stakes_ok and motivation:
            line += f"That money was meant for {motivation}."
    elif level == "concerned":
        mood = "concerned"
        line = f"{name}, I'm being direct. "
        if reasons:
            line += f"{reasons[0]}. "
            stakes_ok = _is_discretionary_spend_reason(reasons[0])
        elif lifestyle is not None:
            try:
                line += f"Lifestyle is at ₹{float(lifestyle):,.0f}"
                if salary:
                    line += f" against ₹{float(salary):,.0f} salary credits"
                line += ". "
            except (TypeError, ValueError):
                pass
            stakes_ok = True  # lifestyle fallback is discretionary by nature
        else:
            stakes_ok = False
        show_profile_stakes = stakes_ok
        if stakes_ok and motivation:
            line += f"Keep {motivation} in the frame."
    else:
        line = f"{name}, we're steady. "
        if why:
            line += f"Remember why: {why}. "
        elif motivation:
            line += f"Quiet months buy {motivation}. "
        else:
            line += "Boring money builds wealth."
        if lifestyle is not None and salary:
            try:
                line += f" Lifestyle ₹{float(lifestyle):,.0f} / salary ₹{float(salary):,.0f}."
            except (TypeError, ValueError):
                pass

    return {
        "preferred_name": name,
        "level": level,
        "mood": mood,
        "headline": line.strip(),
        "reasons": reasons[:5],
        "show_profile_stakes": show_profile_stakes,
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
        },
        "context_line": (severity or {}).get("context_line"),
    }


def preview_samples(
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
) -> dict[str, Any]:
    """Sample advisor lines at each severity for settings UI."""
    cfg = get_advisor_persona_settings(settings)
    profile = advisor_profile_from_facts(learned_facts)
    name = profile.get("preferred_name") or "you"
    soft = profile.get("soft_spot") or "Shopping"
    goal = profile.get("motivation") or "your goal"
    samples = {
        "informational": (
            f"{name}, savings rate held near your plan — quiet discipline beats loud tips. "
            f"Keep the payday split: Invest → Buffer → Goals → then play."
        ),
        "concerned": (
            f"{name}, discretionary ran hotter than your template this month. "
            f"No drama — note what changed and pull {soft} back under the line."
        ),
        "strict": (
            f"{name}, this isn't a one-off anymore. Overshoot is repeating, "
            f"and that money was meant for {goal}. "
            "Salary-day split first — shopping apps stay closed until it's done."
        ),
    }
    return {
        "settings": cfg,
        "samples": samples,
        "note": "Previews use your trained name/soft spot/goal; live messages cite real numbers.",
    }


def alert_severity_for_type(alert_type: str, *, global_level: Severity = "informational") -> Severity:
    """Map a single alert type to tone — still deterministic, not LLM."""
    t = (alert_type or "").lower()
    if t in {"sip_stopped", "sip_lapsed", "lifestyle_cap", "goal_miss_streak"}:
        return "strict"
    if t in {
        "sip_missing",
        "drift",
        "allocation_drift",
        "subscription_creep",
        "price_up",
        "budget_breach",
        "spend_pace",
        "goal_miss",
        "liability_ratio",
    }:
        return "concerned" if global_level != "strict" else "strict"
    return global_level if global_level != "strict" else "informational"


def format_alert_advisor_message(
    alert: dict[str, Any],
    *,
    severity: Severity,
    profile: dict[str, Any] | None = None,
) -> str:
    """Deterministic advisor copy for alerts — cites alert fields + trained profile."""
    profile = profile or {}
    name = profile.get("preferred_name") or "you"
    soft = profile.get("soft_spot")
    motivation = profile.get("motivation")
    title = str(alert.get("title") or alert.get("type") or "Alert")
    base = str(alert.get("message") or "").strip()
    pct = alert.get("pct")
    amount = alert.get("amount")
    merchant = alert.get("merchant") or alert.get("name")
    bits = [base] if base else [title]
    if amount is not None:
        try:
            bits.append(f"₹{float(amount):,.0f}")
        except (TypeError, ValueError):
            pass
    if pct is not None:
        try:
            bits.append(f"{float(pct):+.0f}%")
        except (TypeError, ValueError):
            pass
    detail = " · ".join(bits)
    if severity == "strict":
        who = f" at {merchant}" if merchant else ""
        tail = f" That money was meant for {motivation}." if motivation else ""
        soft_bit = f" Soft spot check ({soft})." if soft else ""
        return (
            f"{name} — pattern check{who}: {detail}.{soft_bit} "
            f"This has shown up before — treat it as a ceiling breach, not a one-off.{tail}"
        )
    if severity == "concerned":
        goal = f" Keep {motivation} in frame." if motivation else ""
        return f"{name}, worth noting: {detail}. No alarm — mark what changed.{goal}"
    return f"{name}, update: {detail}."


def enrich_alerts_with_persona(
    analytics: dict[str, Any],
    *,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    goals_col: Collection | None = None,
) -> dict[str, Any]:
    """Attach advisor_severity + advisor_message + system-wide advisor briefing."""
    sev = severity_from_analytics_bundle(
        analytics,
        settings=settings,
        learned_facts=learned_facts,
        goals_col=goals_col,
    )
    profile = advisor_profile_from_facts(learned_facts)
    global_level: Severity = sev.get("level") or "informational"  # type: ignore[assignment]
    alerts = list(analytics.get("alerts") or [])
    out = []
    for a in alerts:
        level = alert_severity_for_type(str(a.get("type") or ""), global_level=global_level)
        row = dict(a)
        row["advisor_severity"] = level
        row["advisor_message"] = format_alert_advisor_message(
            row, severity=level, profile=profile
        )
        out.append(row)
    analytics["alerts"] = out
    analytics["advisor_severity"] = sev
    analytics["advisor"] = system_briefing(
        learned_facts=learned_facts,
        severity=sev,
        analytics=analytics,
    )
    return analytics


def severity_from_analytics_bundle(
    analytics: dict[str, Any] | None,
    *,
    settings: Collection | None = None,
    learned_facts: Collection | None = None,
    planning_advisor: dict[str, Any] | None = None,
    goals_col: Collection | None = None,
) -> dict[str, Any]:
    cfg = get_advisor_persona_settings(settings)
    goal_docs = []
    if goals_col is not None:
        goal_docs = list(goals_col.find({"status": "active"}).limit(20))

    # Approximate liability pressure from discretionary share of income
    history: list[float] = []
    o = (analytics or {}).get("overview") or {}
    income = float(o.get("expected_net_monthly") or o.get("salary_total") or o.get("total_credit") or 0)
    lifestyle = float(o.get("lifestyle_spend") or 0)
    if income > 0:
        history.append(lifestyle / income)

    return compute_advisor_severity(
        analytics=analytics,
        planning_advisor=planning_advisor,
        goal_docs=goal_docs,
        liability_ratio_history=history,
        sensitivity=int(cfg["strictness_sensitivity"]),
    )
