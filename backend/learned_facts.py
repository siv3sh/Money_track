"""Learn About Me — durable user preferences + clarifying questions.

Facts are stored in Mongo and consulted by categorizer, drift alerts,
budgets, monthly reports, and AI context before falling back to defaults.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo.collection import Collection

from categorizer import CATEGORIES

FACT_TYPES = (
    "category_intent",
    "budget_target",
    "risk_tolerance",
    "one_off_context",
    "spending_intent",
    "merchant_correction",
    "income_profile",
    "people_relation",
    "advisor_profile",
)

FACT_TYPE_GROUPS = {
    "category_intent": "Spending Patterns",
    "merchant_correction": "Spending Patterns",
    "spending_intent": "Spending Patterns",
    "budget_target": "Budget Targets",
    "risk_tolerance": "Investment Preferences",
    "one_off_context": "One-off Events",
    "income_profile": "Income",
    "people_relation": "People",
    "advisor_profile": "Advisor training",
}

# Priority: lower number = ask first
QUESTION_PRIORITY = {
    "category_intent": 1,
    "merchant_correction": 1,
    "one_off_context": 2,
    "spending_intent": 3,
    "risk_tolerance": 4,
    "budget_target": 5,
}

MAX_QUESTIONS_PER_WEEK = 2
SKIP_COOLDOWN_DAYS = 14
SPEND_DEVIATION_PCT = 30.0
DEFAULT_DRIFT_THRESHOLD_PP = 10.0
NON_LIFESTYLE = frozenset({"Transfers", "Investments", "Income"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def fact_key(fact_type: str, key: str) -> str:
    return f"{fact_type}::{(key or '').strip().lower()}"


def question_id(fact_type: str, key: str) -> str:
    raw = fact_key(fact_type, key)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def serialize_fact(doc: dict[str, Any]) -> dict[str, Any]:
    created = doc.get("created_at")
    confirmed = doc.get("last_confirmed_at")
    return {
        "id": str(doc.get("_id")),
        "fact_type": doc.get("fact_type"),
        "key": doc.get("key"),
        "value": doc.get("value"),
        "confidence": doc.get("confidence") or doc.get("source") or "user_answered",
        "source": doc.get("source") or "user_answered",
        "meta": doc.get("meta") or {},
        "plain_language": doc.get("plain_language") or _plain_language(doc),
        "group": FACT_TYPE_GROUPS.get(str(doc.get("fact_type") or ""), "Other"),
        "created_at": created.isoformat() if isinstance(created, datetime) else None,
        "last_confirmed_at": confirmed.isoformat() if isinstance(confirmed, datetime) else None,
    }


def _plain_language(doc: dict[str, Any]) -> str:
    ft = doc.get("fact_type")
    key = doc.get("key") or ""
    value = doc.get("value")
    meta = doc.get("meta") or {}
    if ft in {"category_intent", "merchant_correction"}:
        return f'Treat "{key}" as {value}'
    if ft == "budget_target":
        try:
            amt = float(value)
        except (TypeError, ValueError):
            amt = 0
        return f"Budget target for {key}: ₹{amt:,.0f}/month"
    if ft == "risk_tolerance":
        try:
            pp = float(value)
        except (TypeError, ValueError):
            pp = DEFAULT_DRIFT_THRESHOLD_PP
        return f"Alert on {key} allocation drift after ±{pp:g} percentage points"
    if ft == "one_off_context":
        label = (
            "one-off"
            if str(value).lower() in {"one_off", "one-off", "gift", "emergency", "trip"}
            else str(value)
        )
        merchant = meta.get("merchant") or key
        return f'"{merchant}" marked as {label} (won\'t flag as repeating unusual)'
    if ft == "spending_intent":
        parts = key.split("|", 1)
        month = parts[0] if parts else ""
        cat = parts[1] if len(parts) > 1 else key
        planned = str(value).lower() in {"planned", "trip", "event"}
        return (
            f"{cat} in {month} was planned"
            if planned
            else f"{cat} in {month} was unplanned drift"
        )
    if ft == "income_profile":
        k = str(key).lower()
        if k == "ctc_lpa":
            return f"CTC is ₹{value} LPA"
        if k in {"expected_net_monthly", "net_salary"}:
            try:
                amt = float(value)
            except (TypeError, ValueError):
                amt = 0
            return f"Expected take-home ~₹{amt:,.0f}/month"
        if k == "employer":
            return f"Employer: {value}"
        if k in {"salary_keywords", "salary_sms_words"}:
            return f"Salary SMS words: {value}"
        if k == "designation":
            return f"Role: {value}"
        if k == "gross_monthly":
            try:
                amt = float(value)
            except (TypeError, ValueError):
                amt = 0
            return f"Gross pay ~₹{amt:,.0f}/month"
        if k == "joined_on":
            return f"Joined on {value}"
        return f"Income · {key}: {value}"
    if ft == "people_relation":
        return f"{key} is {value}"
    if ft == "advisor_profile":
        labels = {
            "preferred_name": "Call me",
            "soft_spot": "Weak spot",
            "dealbreaker": "Dealbreaker",
            "why_money": "Why money matters",
            "coach_tone": "Coach tone",
            "pride": "Proud of",
            "strict_on": "Be strict about",
            "motivation": "What motivates me",
        }
        return f"{labels.get(str(key).lower(), key)}: {value}"
    return f"{ft}: {key} = {value}"


def list_facts(facts: Collection) -> list[dict[str, Any]]:
    rows = [serialize_fact(d) for d in facts.find().sort("last_confirmed_at", -1)]
    rows.sort(key=lambda r: (r.get("group") or "", r.get("key") or ""))
    return rows


def get_fact_map(facts: Collection) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for d in facts.find():
        ft = str(d.get("fact_type") or "")
        key = str(d.get("key") or "")
        if ft and key:
            out[fact_key(ft, key)] = d
    return out


def merchant_category_overrides(facts: Collection) -> dict[str, str]:
    memory: dict[str, str] = {}
    for d in facts.find({"fact_type": {"$in": ["category_intent", "merchant_correction"]}}):
        key = str(d.get("key") or "").strip().lower()
        val = str(d.get("value") or "").strip()
        if key and val in CATEGORIES:
            memory[key] = val
    return memory


def income_profile_from_facts(facts: Collection) -> dict[str, Any]:
    """Structured salary profile from income_profile facts."""
    out: dict[str, Any] = {}
    for d in facts.find({"fact_type": "income_profile"}):
        key = str(d.get("key") or "").strip().lower()
        if not key:
            continue
        out[key] = d.get("value")
        meta = d.get("meta") or {}
        if meta:
            out.setdefault("_meta", {})[key] = meta
    # Normalize numbers
    for num_key in ("ctc_lpa", "expected_net_monthly", "gross_monthly", "employer_pf"):
        if num_key in out:
            try:
                out[num_key] = float(out[num_key])
            except (TypeError, ValueError):
                pass
    return out


def salary_needles_from_profile(profile: dict[str, Any] | None) -> list[str]:
    """Words/phrases from the user's profile that mark a credit as salary."""
    if not profile:
        return []
    needles: list[str] = []
    employer = str(profile.get("employer") or "").strip()
    if employer:
        needles.append(employer)
    raw_kw = profile.get("salary_keywords")
    if raw_kw is None:
        raw_kw = profile.get("salary_sms_words")
    if isinstance(raw_kw, list):
        needles.extend(str(x).strip() for x in raw_kw if str(x).strip())
    elif raw_kw is not None and str(raw_kw).strip():
        needles.extend(
            p.strip()
            for p in re.split(r"[,;\n]+", str(raw_kw))
            if p.strip()
        )
    # De-dupe case-insensitively while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for n in needles:
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(n)
    return out


def salary_needles_from_facts(facts: Collection | None) -> list[str]:
    if facts is None:
        return []
    return salary_needles_from_profile(income_profile_from_facts(facts))


def people_patterns_from_facts(facts: Collection | None) -> list[tuple[str, str]]:
    """(match_needle, display_name) from people_relation facts — family/friends transfers."""
    if facts is None:
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for d in facts.find({"fact_type": "people_relation"}):
        key = str(d.get("key") or "").strip()
        val = str(d.get("value") or "").strip()
        if not key:
            continue
        needle = key.lower()
        if needle in seen or len(needle) < 3:
            continue
        seen.add(needle)
        # Prefer relation label in display when present
        label = val if val else key.title()
        if val and val.lower() not in {key.lower(), needle}:
            label = f"{key.title()} ({val})"
        else:
            label = key.title()
        out.append((needle, label))
        # Also match on relation word if it's a unique name-like value
        meta = d.get("meta") or {}
        aliases = meta.get("aliases") or meta.get("match_words")
        if isinstance(aliases, str):
            aliases = [a.strip() for a in re.split(r"[,;\n]+", aliases) if a.strip()]
        if isinstance(aliases, list):
            for a in aliases:
                an = str(a).strip().lower()
                if len(an) >= 3 and an not in seen:
                    seen.add(an)
                    out.append((an, label))
    return out


ADVISOR_TRAINING_KEYS = (
    "preferred_name",
    "soft_spot",
    "dealbreaker",
    "why_money",
    "coach_tone",
    "pride",
    "strict_on",
    "motivation",
)

ADVISOR_TRAINING_QUESTIONS: list[dict[str, Any]] = [
    {
        "key": "preferred_name",
        "prompt": "What should I call you when I’m coaching you?",
        "placeholder": "e.g. your name",
        "hint": "I’ll use this when I’m proud of you — and when I’m calling you out.",
    },
    {
        "key": "soft_spot",
        "prompt": "Where do you usually slip? Be honest.",
        "placeholder": "e.g. shopping, eating out, subscriptions",
        "hint": "I’ll watch this like a hawk. No judgment — just accountability.",
    },
    {
        "key": "dealbreaker",
        "prompt": "What money mistake makes future-you angry?",
        "placeholder": "e.g. EMI for gadgets / skipping SIPs for shopping",
        "hint": "That’s when I get strict. No pep talk — straight talk.",
    },
    {
        "key": "why_money",
        "prompt": "Why does money matter to you right now — beyond numbers?",
        "placeholder": "e.g. freedom, family security, building wealth",
        "hint": "I’ll remind you of this when temptation hits.",
    },
    {
        "key": "coach_tone",
        "prompt": "How do you want me to talk to you?",
        "placeholder": "strict friend / warm coach / no-nonsense",
        "options": ["strict friend", "warm coach", "no-nonsense"],
        "hint": "Optional — pick how you want me to talk to you once you start training.",
    },
    {
        "key": "pride",
        "prompt": "What money habit are you already proud of?",
        "placeholder": "e.g. SIPs every month / tracking spends / helping family",
        "hint": "I’ll celebrate this so discipline doesn’t feel like punishment.",
    },
    {
        "key": "strict_on",
        "prompt": "Where should I be extra strict?",
        "placeholder": "e.g. Shopping, subscriptions, eating out",
        "hint": "I’ll raise my voice here when the numbers slip.",
    },
    {
        "key": "motivation",
        "prompt": "What goal makes you feel something when you picture it?",
        "placeholder": "e.g. emergency fund / trip / parents’ peace of mind",
        "hint": "I’ll tie every cut and SIP back to this feeling.",
    },
]


def advisor_profile_from_facts(facts: Collection | None) -> dict[str, Any]:
    """Persona + training answers for the Money Advisor voice."""
    out: dict[str, Any] = {
        "preferred_name": None,
        "soft_spot": None,
        "dealbreaker": None,
        "why_money": None,
        "coach_tone": None,
        "pride": None,
        "strict_on": None,
        "motivation": None,
        "trained_keys": [],
        "completeness": 0.0,
    }
    if facts is None:
        return out
    trained: list[str] = []
    for d in facts.find({"fact_type": "advisor_profile"}):
        key = str(d.get("key") or "").strip().lower()
        if not key:
            continue
        val = d.get("value")
        if val is None or str(val).strip() == "":
            continue
        out[key] = str(val).strip()
        trained.append(key)
    out["trained_keys"] = sorted(set(trained))
    core = [k for k in ADVISOR_TRAINING_KEYS if k in out["trained_keys"]]
    out["completeness"] = round(len(core) / max(len(ADVISOR_TRAINING_KEYS), 1) * 100, 1)
    return out


def trained_profile_fields(profile: dict[str, Any]) -> dict[str, Any]:
    """Only advisor_profile keys the user explicitly saved — no baked-in defaults."""
    keys = set(profile.get("trained_keys") or [])
    return {
        k: profile[k]
        for k in ADVISOR_TRAINING_KEYS
        if k in keys and profile.get(k) not in (None, "")
    }


def persona_is_trained(profile: dict[str, Any], *, min_keys: int = 1) -> bool:
    return len(profile.get("trained_keys") or []) >= min_keys


def advisor_training_status(facts: Collection | None) -> dict[str, Any]:
    profile = advisor_profile_from_facts(facts)
    answered = set(profile.get("trained_keys") or [])
    pending = []
    for q in ADVISOR_TRAINING_QUESTIONS:
        if q["key"] not in answered:
            pending.append({**q, "answered": False, "value": None})
        else:
            pending.append({**q, "answered": True, "value": profile.get(q["key"])})
    return {
        "profile": profile,
        "questions": pending,
        "completeness": profile["completeness"],
        "ready": profile["completeness"] >= 50,
    }


def budget_targets_from_facts(facts: Collection) -> dict[str, float]:
    out: dict[str, float] = {}
    for d in facts.find({"fact_type": "budget_target"}):
        key = str(d.get("key") or "").strip()
        try:
            amt = float(d.get("value") or 0)
        except (TypeError, ValueError):
            continue
        if key and amt > 0:
            out[key] = amt
    return out


def drift_thresholds_from_facts(facts: Collection) -> dict[str, float]:
    out: dict[str, float] = {}
    for d in facts.find({"fact_type": "risk_tolerance"}):
        key = str(d.get("key") or "").strip()
        try:
            pp = float(d.get("value") or 0)
        except (TypeError, ValueError):
            continue
        if key and pp >= 1:
            out[key] = pp
    return out


def one_off_fingerprints(facts: Collection) -> set[str]:
    ids: set[str] = set()
    for d in facts.find({"fact_type": "one_off_context"}):
        meta = d.get("meta") or {}
        tid = meta.get("txn_id") or d.get("key")
        if tid:
            ids.add(str(tid))
        fp = meta.get("fingerprint")
        if fp:
            ids.add(str(fp))
        key = d.get("key")
        if key:
            ids.add(str(key))
    return ids


def planned_spend_keys(facts: Collection) -> set[str]:
    keys: set[str] = set()
    for d in facts.find({"fact_type": "spending_intent"}):
        if str(d.get("value") or "").lower() in {"planned", "trip", "event"}:
            keys.add(str(d.get("key") or ""))
    return keys


def upsert_fact(
    facts: Collection,
    *,
    fact_type: str,
    key: str,
    value: Any,
    source: str = "user_answered",
    plain_language: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if fact_type not in FACT_TYPES:
        raise ValueError(f"Invalid fact_type: {fact_type}")
    key_s = (key or "").strip()
    if not key_s:
        raise ValueError("key is required")
    now = _now()
    doc = {
        "fact_type": fact_type,
        "key": key_s,
        "key_norm": key_s.lower(),
        "value": value,
        "confidence": source,
        "source": source,
        "meta": meta or {},
        "plain_language": plain_language,
        "last_confirmed_at": now,
    }
    existing = facts.find_one({"fact_type": fact_type, "key_norm": key_s.lower()})
    if existing:
        facts.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    **doc,
                    "plain_language": plain_language or _plain_language({**existing, **doc}),
                }
            },
        )
        updated = facts.find_one({"_id": existing["_id"]}) or {**existing, **doc}
        return serialize_fact(updated)
    doc["created_at"] = now
    doc["plain_language"] = plain_language or _plain_language(doc)
    res = facts.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_fact(doc)


def delete_fact(facts: Collection, fact_id: str) -> bool:
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(fact_id)
    except InvalidId:
        return False
    return facts.delete_one({"_id": oid}).deleted_count > 0


def update_fact(
    facts: Collection,
    fact_id: str,
    *,
    value: Any | None = None,
    plain_language: str | None = None,
) -> dict[str, Any] | None:
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(fact_id)
    except InvalidId:
        return None
    doc = facts.find_one({"_id": oid})
    if not doc:
        return None
    patch: dict[str, Any] = {"last_confirmed_at": _now()}
    if value is not None:
        patch["value"] = value
    merged = {**doc, **patch}
    patch["plain_language"] = plain_language or _plain_language(merged)
    facts.update_one({"_id": oid}, {"$set": patch})
    return serialize_fact(facts.find_one({"_id": oid}) or merged)


def _events_this_week(events: Collection) -> int:
    """Count distinct questions interacted with this week (shown or answered)."""
    since = _now() - timedelta(days=7)
    ids = events.distinct(
        "question_id",
        {"at": {"$gte": since}, "action": {"$in": ["shown", "answered"]}},
    )
    return len(ids)


def _already_shown_this_week(events: Collection, qid: str) -> bool:
    since = _now() - timedelta(days=7)
    return (
        events.count_documents(
            {"question_id": qid, "action": "shown", "at": {"$gte": since}}
        )
        > 0
    )


def _recently_skipped(events: Collection, qid: str) -> bool:
    since = _now() - timedelta(days=SKIP_COOLDOWN_DAYS)
    return (
        events.count_documents({"question_id": qid, "action": "skipped", "at": {"$gte": since}})
        > 0
    )


def log_event(
    events: Collection,
    *,
    question_id: str,
    action: str,
    fact_type: str | None = None,
    key: str | None = None,
) -> None:
    events.insert_one(
        {
            "question_id": question_id,
            "action": action,
            "fact_type": fact_type,
            "key": key,
            "at": _now(),
        }
    )


def _alt_categories(merchant: str, raw: str) -> list[str]:
    """Ranked category suggestions — best guesses first, then common lifestyle options."""
    blob = f"{merchant} {raw}".lower()
    guesses: list[str] = []
    rules = [
        (("swiggy", "zomato", "restaurant", "cafe", "food", "dining"), "Food & Dining"),
        (("dmart", "bigbasket", "blinkit", "grocery", "supermarket", "hypermar"), "Groceries"),
        (("amazon", "flipkart", "myntra", "ajio", "meesho", "shop"), "Shopping"),
        (("uber", "ola", "petrol", "fuel", "irctc", "fastag", "toll", "parking"), "Travel & Transport"),
        (("netflix", "spotify", "prime", "youtube", "apple.com/bill", "cursor"), "Subscriptions"),
        (("electricity", "airtel", "jio", "bsnl", "gas", "water"), "Bills & Utilities"),
        (("pharmacy", "apollo", "1mg", "hospital", "clinic", "med"), "Health & Wellness"),
        (("bookmyshow", "pvr", "inox", "game", "movie"), "Entertainment"),
        (("school", "college", "tuition", "course", "udemy"), "Education"),
        (("mutual", "groww", "zerodha", "kuvera", "sip", "nps"), "Investments"),
        (("transfer", "upi", "neft", "imps", "self"), "Transfers"),
    ]
    for needles, cat in rules:
        if any(n in blob for n in needles) and cat not in guesses:
            guesses.append(cat)

    # Always offer a full practical set after the best guesses
    common = [
        "Food & Dining",
        "Groceries",
        "Shopping",
        "Travel & Transport",
        "Bills & Utilities",
        "Entertainment",
        "Health & Wellness",
        "Subscriptions",
        "Education",
        "Transfers",
        "Investments",
        "Other",
    ]
    for cat in common:
        if cat not in guesses:
            guesses.append(cat)
    return guesses[:12]


def generate_questions(
    *,
    facts: Collection,
    events: Collection,
    transactions: Collection,
    analytics: dict[str, Any] | None = None,
    category_memory: Collection | None = None,
) -> list[dict[str, Any]]:
    """Build up to MAX_QUESTIONS_PER_WEEK clarifying questions under guardrails."""
    fact_map = get_fact_map(facts)
    used = _events_this_week(events)
    remaining = max(0, MAX_QUESTIONS_PER_WEEK - used)
    # Still allow re-display of questions already shown this week (until answered/skipped)

    candidates: list[dict[str, Any]] = []
    analytics = analytics or {}

    memory_keys: set[str] = set()
    if category_memory is not None:
        for row in category_memory.find({}, {"merchant_key": 1}):
            k = (row.get("merchant_key") or "").strip().lower()
            if k:
                memory_keys.add(k)
    memory_keys.update(merchant_category_overrides(facts).keys())

    # a) Categorization confidence — Other / low-confidence merchants
    for doc in (
        transactions.find(
            {
                "type": "debit",
                "$or": [
                    {"category": "Other"},
                    {"category_source": {"$in": ["other", "type_default"]}},
                ],
            },
            {"merchant": 1, "raw_text": 1, "amount": 1, "category": 1, "received_at": 1},
        )
        .sort("received_at", -1)
        .limit(40)
    ):
        merchant = (doc.get("merchant") or "").strip()
        if not merchant or merchant.lower() in {"unknown", "bank transfer", "upi transfer"}:
            continue
        key = merchant.lower()
        if fact_key("category_intent", key) in fact_map or key in memory_keys:
            continue
        opts = _alt_categories(merchant, doc.get("raw_text") or "")
        qid = question_id("category_intent", key)
        if _recently_skipped(events, qid):
            continue
        top = opts[:2]
        candidates.append(
            {
                "id": qid,
                "fact_type": "category_intent",
                "key": merchant,
                "priority": QUESTION_PRIORITY["category_intent"],
                "prompt": f'What category is "{merchant}"? (suggested: {top[0]} or {top[1]})',
                "choices": [{"id": c, "label": c} for c in opts],
                "allow_free_text": False,
                "meta": {
                    "txn_id": str(doc.get("_id")),
                    "amount": float(doc.get("amount") or 0),
                    "options": opts,
                },
            }
        )

    alerts = analytics.get("alerts") or []
    smart = analytics.get("smart") or {}
    cat_monthly = (
        analytics.get("lifestyle_category_monthly") or analytics.get("category_monthly") or []
    )
    planned = planned_spend_keys(facts)

    # b) Spending intent — category MoM deviation > 30%
    if cat_monthly:
        history: dict[str, list[tuple[str, float]]] = {}
        for row in cat_monthly:
            month = str(row.get("month") or "")
            for cat, val in row.items():
                if cat == "month":
                    continue
                try:
                    amt = float(val)
                except (TypeError, ValueError):
                    continue
                if amt <= 0:
                    continue
                history.setdefault(str(cat), []).append((month, amt))

        for cat, series in history.items():
            if cat in NON_LIFESTYLE:
                continue
            series = sorted(series, key=lambda x: x[0])
            if len(series) < 2:
                continue
            cur_month, cur_amt = series[-1]
            intent_key = f"{cur_month}|{cat}"
            if fact_key("spending_intent", intent_key) in fact_map:
                continue
            trail = [
                amt
                for m, amt in series[:-1]
                if f"{m}|{cat}" not in planned and amt > 0
            ]
            if not trail:
                continue
            avg = sum(trail) / len(trail)
            if avg <= 0 or cur_amt < avg * (1 + SPEND_DEVIATION_PCT / 100):
                continue
            qid = question_id("spending_intent", intent_key)
            if _recently_skipped(events, qid):
                continue
            candidates.append(
                {
                    "id": qid,
                    "fact_type": "spending_intent",
                    "key": intent_key,
                    "priority": QUESTION_PRIORITY["spending_intent"],
                    "prompt": (
                        f"This month's {cat} spend (₹{cur_amt:,.0f}) is higher than usual "
                        f"(~₹{avg:,.0f}) — was this planned (trip/event) or just drift?"
                    ),
                    "choices": [
                        {"id": "planned", "label": "Planned (trip/event)"},
                        {"id": "drift", "label": "Just drift"},
                    ],
                    "allow_free_text": False,
                    "meta": {
                        "category": cat,
                        "month": cur_month,
                        "amount": cur_amt,
                        "avg": avg,
                    },
                }
            )

    # c) Budget calibration — 3+ months consistent, no budget
    existing_budgets: set[str] = set()
    budgets_payload = analytics.get("budgets")
    if isinstance(budgets_payload, dict):
        existing_budgets.update(budgets_payload.keys())
    for fk, doc in fact_map.items():
        if fk.startswith("budget_target::"):
            existing_budgets.add(str(doc.get("key") or ""))

    if cat_monthly:
        history2: dict[str, list[float]] = {}
        for row in cat_monthly:
            for cat, val in row.items():
                if cat == "month":
                    continue
                try:
                    amt = float(val)
                except (TypeError, ValueError):
                    continue
                if amt > 0:
                    history2.setdefault(str(cat), []).append(amt)
        for cat, amounts in history2.items():
            if cat in NON_LIFESTYLE or cat == "Other" or cat in existing_budgets:
                continue
            if len(amounts) < 3:
                continue
            avg = sum(amounts[-6:]) / len(amounts[-6:])
            if avg < 300:
                continue
            if fact_key("budget_target", cat) in fact_map:
                continue
            qid = question_id("budget_target", cat)
            if _recently_skipped(events, qid):
                continue
            rounded = round(avg / 100) * 100
            lower = round(rounded * 0.8 / 100) * 100
            candidates.append(
                {
                    "id": qid,
                    "fact_type": "budget_target",
                    "key": cat,
                    "priority": QUESTION_PRIORITY["budget_target"],
                    "prompt": (
                        f"You've averaged ₹{rounded:,.0f}/month on {cat} — "
                        f"set that as your target, or aim lower?"
                    ),
                    "choices": [
                        {"id": str(int(rounded)), "label": f"Set ₹{rounded:,.0f}"},
                        {"id": str(int(lower)), "label": f"Aim lower (₹{lower:,.0f})"},
                    ],
                    "allow_free_text": True,
                    "meta": {"suggested": rounded, "category": cat},
                }
            )

    # d) Risk / allocation preference on drift
    def _add_drift_q(asset: str, delta: Any) -> None:
        asset = asset.strip()
        if not asset or fact_key("risk_tolerance", asset) in fact_map:
            return
        qid = question_id("risk_tolerance", asset)
        if _recently_skipped(events, qid):
            return
        if any(c["id"] == qid for c in candidates):
            return
        delta_bit = f" ({delta:+.0f} pp)" if isinstance(delta, (int, float)) else ""
        candidates.append(
            {
                "id": qid,
                "fact_type": "risk_tolerance",
                "key": asset,
                "priority": QUESTION_PRIORITY["risk_tolerance"],
                "prompt": (
                    f"Are you comfortable with your {asset} allocation{delta_bit}, "
                    f"or should I alert you sooner next time?"
                ),
                "choices": [
                    {"id": "15", "label": "I'm comfortable (wider ±15%)"},
                    {"id": "5", "label": "Alert sooner (±5%)"},
                    {"id": "10", "label": "Keep default (±10%)"},
                ],
                "allow_free_text": False,
                "meta": {"asset_class": asset, "delta_pp": delta},
            }
        )

    for alert in alerts:
        if alert.get("type") == "drift":
            _add_drift_q(str(alert.get("asset_class") or ""), alert.get("delta_pp"))
    for d in (smart.get("drift") or {}).get("drifts") or []:
        _add_drift_q(str(d.get("asset_class") or ""), d.get("delta_pp"))

    # e) One-off context for unusual spends
    one_offs = one_off_fingerprints(facts)
    for alert in alerts:
        if alert.get("type") != "anomaly":
            continue
        merchant = str(alert.get("merchant") or "this charge").strip()
        amount = float(alert.get("amount") or 0)
        fp = f"{merchant.lower()}|{int(amount)}"
        if fp in one_offs or fact_key("one_off_context", fp) in fact_map:
            continue
        qid = question_id("one_off_context", fp)
        if _recently_skipped(events, qid):
            continue
        candidates.append(
            {
                "id": qid,
                "fact_type": "one_off_context",
                "key": fp,
                "priority": QUESTION_PRIORITY["one_off_context"],
                "prompt": (
                    f'Was ₹{amount:,.0f} at "{merchant}" a one-off '
                    f"(gift/emergency/trip) or something that might repeat?"
                ),
                "choices": [
                    {"id": "one_off", "label": "One-off"},
                    {"id": "might_repeat", "label": "Might repeat"},
                ],
                "allow_free_text": False,
                "meta": {"merchant": merchant, "amount": amount, "fingerprint": fp},
            }
        )

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for c in sorted(candidates, key=lambda x: (x["priority"], x["id"])):
        if c["id"] in seen:
            continue
        seen.add(c["id"])
        unique.append(c)

    chosen = unique[:remaining]
    # Prefer re-surfacing already-shown unanswered questions from this week first
    already = [c for c in unique if _already_shown_this_week(events, c["id"])]
    fresh = [c for c in unique if not _already_shown_this_week(events, c["id"])]
    slots = max(0, MAX_QUESTIONS_PER_WEEK - len(already))
    chosen = (already + fresh[:slots])[:MAX_QUESTIONS_PER_WEEK]
    for c in chosen:
        if not _already_shown_this_week(events, c["id"]):
            log_event(
                events,
                question_id=c["id"],
                action="shown",
                fact_type=c["fact_type"],
                key=c["key"],
            )
        c["skip_label"] = "Not sure / Skip"
    return chosen


def apply_answer(
    *,
    facts: Collection,
    events: Collection,
    category_memory: Collection | None,
    budgets_col: Collection | None,
    question: dict[str, Any],
    choice_id: str | None,
    free_text: str | None = None,
) -> dict[str, Any]:
    fact_type = question["fact_type"]
    key = question["key"]
    meta = dict(question.get("meta") or {})
    value: Any = choice_id if choice_id else (free_text or "").strip()
    if not value:
        raise ValueError("Answer required")

    if fact_type == "budget_target":
        m = re.search(r"([\d,]+(?:\.\d+)?)", str(value).replace("₹", ""))
        if not m:
            raise ValueError("Could not parse budget amount")
        value = float(m.group(1).replace(",", ""))
        if budgets_col is not None and value > 0:
            budgets_col.update_one(
                {"category": key},
                {
                    "$set": {
                        "category": key,
                        "amount": value,
                        "updated_at": _now(),
                        "source": "learned",
                    }
                },
                upsert=True,
            )

    if fact_type == "risk_tolerance":
        value = float(str(value).replace("%", "").strip())

    if fact_type in {"category_intent", "merchant_correction"}:
        cat = str(value).strip()
        if cat not in CATEGORIES:
            for c in question.get("choices") or []:
                if c.get("id") == choice_id or c.get("label") == choice_id:
                    cat = c["id"]
                    break
        if cat not in CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(CATEGORIES)}")
        value = cat
        if category_memory is not None:
            now = _now()
            for mk in {key.lower(), key.strip().lower()}:
                category_memory.update_one(
                    {"merchant_key": mk},
                    {
                        "$set": {
                            "merchant_key": mk,
                            "merchant": key,
                            "category": cat,
                            "updated_at": now,
                            "source": "learned",
                        }
                    },
                    upsert=True,
                )

    fact = upsert_fact(
        facts,
        fact_type=fact_type,
        key=key,
        value=value,
        source="user_answered",
        meta=meta,
    )
    log_event(
        events,
        question_id=question["id"],
        action="answered",
        fact_type=fact_type,
        key=key,
    )
    return fact


def skip_question(events: Collection, question: dict[str, Any]) -> None:
    log_event(
        events,
        question_id=question["id"],
        action="skipped",
        fact_type=question.get("fact_type"),
        key=question.get("key"),
    )


def facts_for_ai_context(facts: Collection) -> list[dict[str, str]]:
    return [
        {
            "type": str(d.get("fact_type")),
            "summary": str(d.get("plain_language") or _plain_language(d)),
        }
        for d in facts.find().sort("last_confirmed_at", -1).limit(40)
    ]


def reconstruct_question_from_answer_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Rebuild minimal question object from client answer payload."""
    return {
        "id": payload.get("question_id") or question_id(payload["fact_type"], payload["key"]),
        "fact_type": payload["fact_type"],
        "key": payload["key"],
        "choices": payload.get("choices") or [],
        "meta": payload.get("meta") or {},
    }
