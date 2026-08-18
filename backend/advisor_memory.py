"""AdvisorMemory — short narrative continuity entries for the Money Advisor.

Separate from UserLearnedFact. Auto-appended from severity/drift/SIP/goal signals.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from pymongo.collection import Collection

MEMORY_KINDS = {
    "commitment",
    "held",
    "reverted",
    "sip_lapse",
    "sip_recovered",
    "goal_milestone",
    "severity_shift",
    "spend_pattern",
    "note",
    "month_start",
    "salary_day",
    "spend_probe",
    "credit_source",
    "user_told",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    for key in ("created_at", "occurred_at"):
        val = out.get(key)
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    return out


def append_memory(
    memories: Collection,
    *,
    kind: str,
    summary: str,
    meta: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
    occurred_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Insert a memory; skip if dedupe_key already exists (same week)."""
    kind_n = (kind or "note").strip().lower()
    if kind_n not in MEMORY_KINDS:
        kind_n = "note"
    summary_n = (summary or "").strip()
    if not summary_n:
        return None

    if dedupe_key:
        existing = memories.find_one({"dedupe_key": dedupe_key})
        if existing:
            return _serialize(existing)

    doc = {
        "kind": kind_n,
        "summary": summary_n[:500],
        "meta": meta or {},
        "dedupe_key": dedupe_key,
        "occurred_at": occurred_at or _now(),
        "created_at": _now(),
    }
    res = memories.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _serialize(doc)


def list_memories(
    memories: Collection,
    *,
    limit: int = 40,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    q: dict[str, Any] = {}
    if kind:
        q["kind"] = kind
    rows = list(memories.find(q).sort("occurred_at", -1).limit(limit))
    return [_serialize(r) for r in rows]


def memories_for_prompt(memories: Collection | None, *, limit: int = 12) -> list[str]:
    if memories is None:
        return []
    lines = []
    for row in list_memories(memories, limit=limit):
        when = (row.get("occurred_at") or "")[:10]
        lines.append(f"- [{when}] ({row.get('kind')}) {row.get('summary')}")
    return lines


def maybe_append_from_severity(
    memories: Collection,
    *,
    severity: dict[str, Any],
    profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Create memories from deterministic severity signals (no separate detector)."""
    created: list[dict[str, Any]] = []
    level = severity.get("level") or "informational"
    reasons = list(severity.get("reasons") or [])
    signals = severity.get("signals") or {}
    name = (profile or {}).get("preferred_name") or "User"
    motivation = (profile or {}).get("motivation")
    ym = _now().strftime("%Y-%m")

    if signals.get("sip_stopped"):
        m = append_memory(
            memories,
            kind="sip_lapse",
            summary=f"{name}: SIP appears stopped/lapsed — investing-first rule under pressure.",
            meta={"signals": {"sip_stopped": True}},
            dedupe_key=f"sip_stopped:{ym}",
        )
        if m:
            created.append(m)

    if signals.get("lifestyle_pace_over") or signals.get("mom_debit_spike"):
        m = append_memory(
            memories,
            kind="spend_pattern",
            summary=(
                f"{name}: spend pressure flagged — {reasons[0] if reasons else 'pace/MoM spike'}."
                + (f" Goal in frame: {motivation}." if motivation else "")
            ),
            meta={"signals": {k: signals.get(k) for k in ("lifestyle_pace_over", "mom_debit_spike")}},
            dedupe_key=f"spend_pressure:{ym}:{level}",
        )
        if m:
            created.append(m)

    if level == "strict" and reasons:
        m = append_memory(
            memories,
            kind="severity_shift",
            summary=f"{name}: advisor tone moved to strict — {reasons[0]}.",
            meta={"level": level, "reasons": reasons[:3]},
            dedupe_key=f"severity_strict:{ym}",
        )
        if m:
            created.append(m)

    return created


def maybe_append_goal_milestone(
    memories: Collection,
    *,
    goal_name: str,
    progress_pct: float,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Celebrate 25/50/75/100 crossings once each."""
    milestones = [25, 50, 75, 100]
    hit = None
    for m in milestones:
        if progress_pct + 1e-6 >= m:
            hit = m
    if hit is None:
        return None
    # Only fire when just crossed into a band (within ~5pp of the milestone)
    if progress_pct < hit or progress_pct > hit + 5:
        # Still allow exact hit or slightly above; skip if way past without prior memory
        if progress_pct > hit + 5:
            # Check if memory already exists for this milestone
            key = f"goal_ms:{goal_name}:{hit}"
            if memories.find_one({"dedupe_key": key}):
                return None
            # Far past — only write if never recorded
            pass
    name = (profile or {}).get("preferred_name") or "User"
    key = f"goal_ms:{goal_name.strip().lower()}:{hit}"
    return append_memory(
        memories,
        kind="goal_milestone",
        summary=f"{name} hit ~{hit}% on goal '{goal_name}' (progress {progress_pct:.0f}%).",
        meta={"goal": goal_name, "milestone": hit, "progress_pct": progress_pct},
        dedupe_key=key,
    )


def maybe_append_commitment(
    memories: Collection,
    *,
    text: str,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    name = (profile or {}).get("preferred_name") or "User"
    day = _now().strftime("%Y-%m-%d")
    return append_memory(
        memories,
        kind="commitment",
        summary=f"{name} committed: {text.strip()[:300]}",
        meta={"source": "chat_or_action"},
        dedupe_key=f"commit:{day}:{hash(text.strip().lower()) % 10_000}",
    )


def get_memory_by_dedupe(memories: Collection, dedupe_key: str) -> dict[str, Any] | None:
    if not dedupe_key:
        return None
    doc = memories.find_one({"dedupe_key": dedupe_key})
    return _serialize(doc) if doc else None


def is_nudge_answered(memories: Collection, dedupe_key: str) -> bool:
    """True when the user already answered this ask (or we stored a matching answer)."""
    if not dedupe_key:
        return False
    doc = memories.find_one({"dedupe_key": dedupe_key})
    if doc and (doc.get("meta") or {}).get("answered"):
        return True
    answered = memories.find_one({"dedupe_key": f"{dedupe_key}:answered"})
    return answered is not None


def mark_nudge_answered(
    memories: Collection,
    *,
    dedupe_key: str,
    answer: str,
    summary: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Mark the original ask as answered and write a durable 'user_told' continuity note."""
    answer_n = (answer or "").strip()
    if not dedupe_key or not answer_n:
        return None
    doc = memories.find_one({"dedupe_key": dedupe_key})
    merged_meta = dict((doc or {}).get("meta") or {})
    merged_meta.update(meta or {})
    merged_meta["answered"] = True
    merged_meta["answer"] = answer_n[:200]
    if doc:
        memories.update_one(
            {"_id": doc["_id"]},
            {"$set": {"meta": merged_meta, "summary": summary[:500]}},
        )
    return append_memory(
        memories,
        kind="user_told",
        summary=summary[:500],
        meta={"answer": answer_n[:200], "ask_key": dedupe_key, **(meta or {})},
        dedupe_key=f"{dedupe_key}:answered",
    )


def open_asks(
    memories: Collection,
    *,
    kinds: tuple[str, ...] = ("credit_source", "spend_probe"),
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Recent unanswered probes the user can still reply to."""
    rows = list(
        memories.find({"kind": {"$in": list(kinds)}})
        .sort("occurred_at", -1)
        .limit(limit * 2)
    )
    out: list[dict[str, Any]] = []
    for doc in rows:
        meta = doc.get("meta") or {}
        if meta.get("answered"):
            continue
        key = doc.get("dedupe_key")
        if key and memories.find_one({"dedupe_key": f"{key}:answered"}):
            continue
        out.append(_serialize(doc))
        if len(out) >= limit:
            break
    return out
