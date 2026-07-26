"""Computed smart insights: SIPs, drift, subscription creep, spend forecast.

All numbers are derived from transactions/portfolio first; LLM (if used)
only narrates pre-aggregated facts.
"""

from __future__ import annotations

import calendar
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.collection import Collection

from analytics import NON_LIFESTYLE_CATEGORIES, _instrument_for, _clean_merchant_label
from merchant_label import clean_merchant_label


def _as_utc(dt: datetime) -> datetime:
    """Mongo returns naive UTC datetimes; make them aware so math with now() works."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def _parse_month(ym: str) -> tuple[int, int]:
    y, m = ym.split("-")
    return int(y), int(m)


def _add_months(ym: str, delta: int) -> str:
    y, m = _parse_month(ym)
    m += delta
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return f"{y:04d}-{m:02d}"


def _days_in_month(ym: str) -> int:
    y, m = _parse_month(ym)
    return calendar.monthrange(y, m)[1]


def build_sip_tracker(
    transactions: Collection,
    *,
    overrides: Collection | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Infer monthly SIPs from Investments debits and flag misses / amount drift."""
    now = now or datetime.now(timezone.utc)
    current_month = _month_key(now)

    # Collect per-instrument debit history
    by_inst: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for doc in transactions.find(
        {"category": "Investments", "type": "debit"},
        {"merchant": 1, "raw_text": 1, "amount": 1, "received_at": 1},
    ):
        ts = doc.get("received_at")
        if not isinstance(ts, datetime):
            continue
        ts = _as_utc(ts)
        name, asset_class = _instrument_for(doc.get("merchant"), doc.get("raw_text"))
        by_inst[name].append(
            {
                "amount": float(doc.get("amount") or 0),
                "received_at": ts,
                "month": _month_key(ts),
                "day": ts.day,
                "asset_class": asset_class,
            }
        )

    override_keys: set[str] = set()
    if overrides is not None:
        try:
            for row in overrides.find({"month": current_month}):
                key = str(row.get("instrument") or "").strip()
                if key:
                    override_keys.add(key)
        except Exception:  # noqa: BLE001
            pass

    sips: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []

    for name, events in by_inst.items():
        if len(events) < 2:
            continue
        events.sort(key=lambda e: e["received_at"])
        months = sorted({e["month"] for e in events})
        # Typical cadence: appears in ≥2 distinct months
        if len(months) < 2:
            continue

        # Median gap in months between consecutive appearances
        month_indices = []
        for ym in months:
            y, m = _parse_month(ym)
            month_indices.append(y * 12 + m)
        gaps = [month_indices[i] - month_indices[i - 1] for i in range(1, len(month_indices))]
        median_gap = statistics.median(gaps) if gaps else 1
        if median_gap > 1.5:
            # Not monthly enough — skip one-offs / irregular
            continue

        amounts = [e["amount"] for e in events]
        days = [e["day"] for e in events]
        typical_amount = statistics.median(amounts)
        typical_day = int(statistics.median(days))
        asset_class = events[-1]["asset_class"]
        last_month = months[-1]
        this_month_events = [e for e in events if e["month"] == current_month]
        this_amount = sum(e["amount"] for e in this_month_events)
        marked = name in override_keys

        status = "ok"
        message = f"On track · typical ₹{typical_amount:,.0f} around day {typical_day}"
        severity = "info"

        # Missed this month (and expected day has passed or we're past mid-month)
        expected_passed = now.day >= max(typical_day - 2, 1)
        months_since_last = 0
        if last_month != current_month:
            ly, lm = _parse_month(last_month)
            cy, cm = _parse_month(current_month)
            months_since_last = (cy * 12 + cm) - (ly * 12 + lm)

        if marked and not this_month_events:
            status = "marked"
            message = f"Marked as invested for {current_month} (awaiting import)"
            severity = "info"
        elif months_since_last >= 2:
            status = "stopped"
            message = (
                f"No SIP detected for {months_since_last} months "
                f"(last: {last_month}, usual ₹{typical_amount:,.0f})"
            )
            severity = "alert"
        elif not this_month_events and expected_passed:
            status = "missing"
            message = (
                f"Expected around day {typical_day} · usual ₹{typical_amount:,.0f} — "
                f"not yet detected in {current_month}"
            )
            severity = "warning"
        elif this_month_events and typical_amount > 0:
            deviation = abs(this_amount - typical_amount) / typical_amount
            if deviation >= 0.25:
                status = "amount_drift"
                message = (
                    f"This month ₹{this_amount:,.0f} vs usual ₹{typical_amount:,.0f} "
                    f"({deviation * 100:.0f}% difference)"
                )
                severity = "warning"

        row = {
            "name": name,
            "asset_class": asset_class,
            "typical_amount": round(typical_amount, 2),
            "typical_day": typical_day,
            "occurrences": len(events),
            "months_active": len(months),
            "last_month": last_month,
            "this_month_amount": round(this_amount, 2),
            "status": status,
            "message": message,
            "marked_invested": marked,
            "current_month": current_month,
        }
        sips.append(row)

        if status in {"missing", "stopped", "amount_drift"}:
            alerts.append(
                {
                    "type": "sip",
                    "severity": severity,
                    "title": f"SIP: {name}",
                    "message": message,
                    "instrument": name,
                    "status": status,
                    "typical_amount": round(typical_amount, 2),
                    "typical_day": typical_day,
                    "category": "Investments",
                }
            )

    sips.sort(key=lambda s: (0 if s["status"] != "ok" else 1, s["name"]))
    return {
        "current_month": current_month,
        "sips": sips,
        "alerts": alerts,
        "flagged": sum(1 for s in sips if s["status"] not in {"ok", "marked"}),
    }


def build_portfolio_drift(
    holdings: list[dict[str, Any]],
    *,
    targets: dict[str, float] | None = None,
    threshold_pp: float = 10.0,
    baseline: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Compare current allocation % to targets or rolling baseline."""
    total = sum(float(h.get("current_value") or 0) for h in holdings)
    current: dict[str, float] = defaultdict(float)
    for h in holdings:
        cls = str(h.get("asset_class") or "Other")
        current[cls] += float(h.get("current_value") or 0)

    current_pct = {
        k: round(v / total * 100, 1) if total else 0.0 for k, v in current.items()
    }

    reference = targets if targets else baseline
    reference_source = "target" if targets else ("baseline" if baseline else "none")
    if not reference:
        # No baseline yet — return current as suggested baseline, no alerts
        return {
            "current": [
                {"name": k, "value": current[k], "pct": current_pct[k]}
                for k in sorted(current_pct, key=lambda x: -current_pct[x])
            ],
            "reference": [],
            "reference_source": reference_source,
            "threshold_pp": threshold_pp,
            "drifts": [],
            "alerts": [],
            "suggested_baseline": current_pct,
        }

    # Normalize reference to %
    ref_sum = sum(reference.values()) or 100.0
    ref_pct = {k: round(v / ref_sum * 100, 1) if ref_sum > 1.5 else round(v, 1) for k, v in reference.items()}

    all_keys = sorted(set(current_pct) | set(ref_pct), key=lambda k: -current_pct.get(k, 0))
    drifts: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []
    for key in all_keys:
        cur = current_pct.get(key, 0.0)
        ref = ref_pct.get(key, 0.0)
        delta = round(cur - ref, 1)
        if abs(delta) >= threshold_pp:
            direction = "up" if delta > 0 else "down"
            drifts.append(
                {
                    "asset_class": key,
                    "current_pct": cur,
                    "reference_pct": ref,
                    "delta_pp": delta,
                    "direction": direction,
                }
            )
            alerts.append(
                {
                    "type": "drift",
                    "severity": "warning",
                    "title": f"Allocation drift: {key}",
                    "message": (
                        f"{key} is {cur:.0f}%, "
                        f"{'up' if delta > 0 else 'down'} from your typical {ref:.0f}% "
                        f"({delta:+.0f} pp) — consider rebalancing"
                    ),
                    "asset_class": key,
                    "current_pct": cur,
                    "reference_pct": ref,
                    "delta_pp": delta,
                }
            )

    return {
        "current": [
            {"name": k, "value": current.get(k, 0), "pct": current_pct.get(k, 0)}
            for k in all_keys
        ],
        "reference": [{"name": k, "pct": ref_pct.get(k, 0)} for k in all_keys],
        "reference_source": reference_source,
        "threshold_pp": threshold_pp,
        "drifts": drifts,
        "alerts": alerts,
        "suggested_baseline": None,
    }


def build_subscription_creep(
    transactions: Collection,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Detect price hikes and missing recurring charges."""
    now = now or datetime.now(timezone.utc)
    by_merchant: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for doc in transactions.find(
        {
            "type": "debit",
            "category": {"$in": ["Subscriptions", "Entertainment", "Bills & Utilities"]},
        },
        {"merchant": 1, "raw_text": 1, "amount": 1, "received_at": 1, "category": 1},
    ):
        ts = doc.get("received_at")
        if not isinstance(ts, datetime):
            continue
        ts = _as_utc(ts)
        name = _clean_merchant_label(doc.get("merchant"), doc.get("raw_text"))
        if name in {"Unknown", "Bank transfer", "UPI transfer"}:
            continue
        by_merchant[name].append(
            {
                "amount": float(doc.get("amount") or 0),
                "received_at": ts,
                "category": doc.get("category"),
            }
        )

    items: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []

    for name, events in by_merchant.items():
        if len(events) < 2:
            continue
        events.sort(key=lambda e: e["received_at"])
        # Monthly-ish: at least 2 charges spanning 30+ days
        span_days = (events[-1]["received_at"] - events[0]["received_at"]).days
        if span_days < 25:
            continue

        amounts = [e["amount"] for e in events]
        last = events[-1]
        prev = events[-2]
        days_since = (now - last["received_at"]).days
        median_amt = statistics.median(amounts[:-1]) if len(amounts) > 2 else prev["amount"]

        status = "ok"
        message = f"~₹{statistics.median(amounts):,.0f} · last {last['received_at'].date().isoformat()}"
        severity = "info"

        if last["amount"] > median_amt * 1.08 and last["amount"] - median_amt >= 20:
            status = "price_up"
            message = (
                f"Price changed: ₹{median_amt:,.0f} → ₹{last['amount']:,.0f} "
                f"(+{last['amount'] - median_amt:,.0f})"
            )
            severity = "warning"
        elif days_since >= 45:
            status = "missing"
            message = f"No charge detected since {last['received_at'].date().isoformat()} ({days_since} days)"
            severity = "warning"

        row = {
            "merchant": name,
            "category": last.get("category"),
            "count": len(events),
            "typical_amount": round(float(median_amt), 2),
            "last_amount": round(last["amount"], 2),
            "last_date": last["received_at"].isoformat(),
            "days_since": days_since,
            "status": status,
            "message": message,
        }
        items.append(row)
        if status != "ok":
            alerts.append(
                {
                    "type": "subscription",
                    "severity": severity,
                    "title": f"Subscription: {name}",
                    "message": message,
                    "merchant": name,
                    "status": status,
                    "avg": round(float(median_amt), 2),
                    "count": len(events),
                }
            )

    items.sort(key=lambda r: (0 if r["status"] != "ok" else 1, -r["days_since"]))
    return {"items": items[:30], "alerts": alerts}


def build_spend_forecast(
    transactions: Collection,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Mid-month lifestyle spend pace vs historical monthly average."""
    now = now or datetime.now(timezone.utc)
    ym = _month_key(now)
    days_in = _days_in_month(ym)
    day = now.day

    def lifestyle_amount(match: dict[str, Any]) -> float:
        total = 0.0
        for doc in transactions.find(
            {**match, "type": "debit"},
            {"amount": 1, "category": 1},
        ):
            cat = doc.get("category") or "Other"
            if cat in NON_LIFESTYLE_CATEGORIES:
                continue
            total += float(doc.get("amount") or 0)
        return total

    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    mtd = lifestyle_amount({"received_at": {"$gte": month_start, "$lte": now}})
    projected = (mtd / day) * days_in if day > 0 else 0.0

    # Historical full-month lifestyle averages (last 6 complete months)
    hist: list[float] = []
    for i in range(1, 7):
        past = _add_months(ym, -i)
        y, m = _parse_month(past)
        start = datetime(y, m, 1, tzinfo=timezone.utc)
        if m == 12:
            end = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(y, m + 1, 1, tzinfo=timezone.utc)
        hist.append(lifestyle_amount({"received_at": {"$gte": start, "$lt": end}}))
    usual = statistics.mean(hist) if hist else 0.0
    pace_pct = round(projected / usual * 100, 1) if usual else None

    return {
        "month": ym,
        "day_of_month": day,
        "days_in_month": days_in,
        "mtd_lifestyle": round(mtd, 2),
        "projected_month": round(projected, 2),
        "usual_month": round(usual, 2),
        "pace_pct": pace_pct,
        "status": (
            "over"
            if pace_pct and pace_pct >= 115
            else "under"
            if pace_pct and pace_pct <= 85
            else "on_track"
        ),
        "message": (
            f"On track to spend ₹{projected:,.0f} this month, vs your usual ₹{usual:,.0f}"
            if usual
            else f"Projected lifestyle spend ₹{projected:,.0f} this month"
        ),
    }


def find_ambiguous_transfers(
    transactions: Collection,
    *,
    known_banks: list[str] | None = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Heuristic shortlist of debits that may be self-transfers."""
    banks = {b.lower() for b in (known_banks or [])}
    out: list[dict[str, Any]] = []
    query = {
        "type": "debit",
        "$and": [
            {
                "$or": [
                    {"category": {"$in": ["Other", "Transfers"]}},
                    {"category": {"$exists": False}},
                    {"category": None},
                    {"category": ""},
                ]
            },
            {"category_source": {"$nin": ["manual", "disambiguation"]}},
        ],
    }
    for doc in transactions.find(query).sort("received_at", -1).limit(200):
        if len(out) >= limit:
            break
        # Skip already reviewed
        if doc.get("transfer_review") in {"approved_transfer", "approved_spend", "rejected"}:
            continue
        merchant = clean_merchant_label(doc.get("merchant"), fallback=doc.get("raw_text"))
        amount = float(doc.get("amount") or 0)
        raw = (doc.get("raw_text") or "").lower()
        reasons: list[str] = []
        # Round amounts often transfers
        if amount >= 500 and abs(amount - round(amount, -2)) < 0.01:
            reasons.append("round_amount")
        # Person-like single token merchant (no known brand)
        if merchant and " " not in merchant and "@" not in merchant and len(merchant) >= 4:
            if merchant.lower() not in {"amazon", "swiggy", "zomato", "myntra", "paytm"}:
                reasons.append("person_like_merchant")
        # Mentions self / own account
        if any(k in raw for k in ("self", "own a/c", "own account", "to a/c")):
            reasons.append("self_keyword")
        # Bank name in narration matching known banks
        if any(b in raw for b in banks if len(b) > 3):
            reasons.append("known_bank")
        if not reasons:
            continue
        out.append(
            {
                "id": str(doc["_id"]),
                "amount": amount,
                "merchant": merchant,
                "raw_snippet": (doc.get("raw_text") or "")[:100],
                "category": doc.get("category") or "Other",
                "bank": doc.get("bank"),
                "received_at": doc.get("received_at").isoformat()
                if isinstance(doc.get("received_at"), datetime)
                else doc.get("received_at"),
                "reasons": reasons,
            }
        )
    return out


def attach_smart_insights(
    analytics: dict[str, Any],
    transactions: Collection,
    *,
    sip_overrides: Collection | None = None,
    settings: Collection | None = None,
) -> dict[str, Any]:
    """Mutate analytics payload with SIP / drift / creep / forecast blocks + alerts."""
    holdings = (analytics.get("investments") or {}).get("holdings") or []

    targets: dict[str, float] | None = None
    baseline: dict[str, float] | None = None
    threshold_pp = 10.0
    if settings is not None:
        try:
            doc = settings.find_one({"_id": "allocation"}) or {}
            raw_targets = doc.get("targets")
            if isinstance(raw_targets, dict) and raw_targets:
                targets = {str(k): float(v) for k, v in raw_targets.items()}
            raw_base = doc.get("baseline")
            if isinstance(raw_base, dict) and raw_base:
                baseline = {str(k): float(v) for k, v in raw_base.items()}
            if doc.get("threshold_pp") is not None:
                threshold_pp = float(doc["threshold_pp"])
        except Exception:  # noqa: BLE001
            pass

    sip = build_sip_tracker(transactions, overrides=sip_overrides)
    drift = build_portfolio_drift(
        holdings,
        targets=targets,
        threshold_pp=threshold_pp,
        baseline=baseline,
    )
    # Persist suggested baseline once so drift has something to compare against
    if (
        settings is not None
        and drift.get("suggested_baseline")
        and not baseline
        and not targets
    ):
        try:
            settings.update_one(
                {"_id": "allocation"},
                {
                    "$set": {
                        "baseline": drift["suggested_baseline"],
                        "baseline_saved_at": datetime.now(timezone.utc),
                        "threshold_pp": threshold_pp,
                    },
                    "$setOnInsert": {"_id": "allocation"},
                },
                upsert=True,
            )
            drift = build_portfolio_drift(
                holdings,
                targets=None,
                threshold_pp=threshold_pp,
                baseline=drift["suggested_baseline"],
            )
        except Exception:  # noqa: BLE001
            pass

    creep = build_subscription_creep(transactions)
    forecast = build_spend_forecast(transactions)

    analytics["smart"] = {
        "sip": sip,
        "drift": drift,
        "subscription_creep": creep,
        "spend_forecast": forecast,
    }

    extra = list(sip.get("alerts") or []) + list(drift.get("alerts") or [])
    # Prefer creep alerts over generic recurring keyword alerts for same merchant
    creep_alerts = list(creep.get("alerts") or [])
    creep_merchants = {str(a.get("merchant") or "").lower() for a in creep_alerts}
    existing = analytics.get("alerts") or []
    filtered = [
        a
        for a in existing
        if not (
            a.get("type") == "subscription"
            and str(a.get("merchant") or "").lower() in creep_merchants
        )
    ]
    # Keep info recurring that aren't in creep, then prepend smart alerts
    merged = extra + creep_alerts + filtered
    now = datetime.now(timezone.utc).isoformat()
    for a in merged:
        a.setdefault("created_at", now)
    analytics["alerts"] = merged[:40]
    return analytics
