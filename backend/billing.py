"""Stripe billing: free trial + Pro subscription paywall.

When STRIPE_SECRET_KEY / STRIPE_PRICE_PRO are unset, billing is disabled and every
user is treated as entitled (local/dev and unconfigured deploys).
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

PlanId = Literal["free", "pro"]

TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "14"))
STRIPE_SECRET_KEY = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
STRIPE_WEBHOOK_SECRET = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
STRIPE_PRICE_PRO = (os.getenv("STRIPE_PRICE_PRO") or "").strip()
STRIPE_PUBLISHABLE_KEY = (os.getenv("STRIPE_PUBLISHABLE_KEY") or "").strip()
# Display-only; Checkout uses STRIPE_PRICE_PRO from the Dashboard.
PRO_PRICE_LABEL = (os.getenv("BILLING_PRO_PRICE_LABEL") or "₹299/mo").strip()

PRO_FEATURES = frozenset({"ai", "wealth", "planning", "advisor", "reports_email"})


def billing_configured() -> bool:
    return bool(STRIPE_SECRET_KEY and STRIPE_PRICE_PRO)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: Any) -> datetime | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def apply_signup_trial(doc: dict[str, Any]) -> dict[str, Any]:
    """Defaults for a new user document (mutate + return)."""
    now = _now()
    doc.setdefault("plan", "free")
    doc.setdefault("subscription_status", "trialing")
    doc.setdefault("trial_ends_at", now + timedelta(days=TRIAL_DAYS))
    doc.setdefault("stripe_customer_id", None)
    doc.setdefault("stripe_subscription_id", None)
    return doc


def resolve_entitlement(user: dict[str, Any] | None) -> dict[str, Any]:
    """
    Canonical billing snapshot for API + paywall checks.

    entitled=True means Pro features are unlocked.
    """
    configured = billing_configured()
    base = {
        "billing_enabled": configured,
        "trial_days": TRIAL_DAYS,
        "pro_price_label": PRO_PRICE_LABEL,
        "publishable_key": (STRIPE_PUBLISHABLE_KEY or None) if configured else None,
        "features": sorted(PRO_FEATURES),
    }
    if not configured:
        return {
            **base,
            "plan": "pro",
            "entitled": True,
            "subscription_status": "billing_disabled",
            "trial_ends_at": None,
            "trial_active": False,
        }

    if not user:
        return {
            **base,
            "plan": "free",
            "entitled": False,
            "subscription_status": "none",
            "trial_ends_at": None,
            "trial_active": False,
        }

    admin_email = (os.getenv("ADMIN_EMAIL") or os.getenv("SEED_USER_EMAIL") or "").strip().lower()
    user_email = str(user.get("email") or "").strip().lower()
    if admin_email and user_email and user_email == admin_email:
        return {
            **base,
            "plan": "pro",
            "entitled": True,
            "subscription_status": str(user.get("subscription_status") or "admin"),
            "trial_ends_at": None,
            "trial_active": False,
            "stripe_customer_id": user.get("stripe_customer_id"),
        }

    status = str(user.get("subscription_status") or "none").lower()
    plan = str(user.get("plan") or "free").lower()
    if plan not in {"free", "pro"}:
        plan = "free"

    trial_ends = _as_aware(user.get("trial_ends_at"))
    if trial_ends is None and status in {"none", "", "trialing"} and plan == "free":
        created = _as_aware(user.get("created_at")) or _now()
        trial_ends = created + timedelta(days=TRIAL_DAYS)

    trial_active = bool(trial_ends and trial_ends > _now())
    paid_active = status in {"active", "trialing"} and (
        plan == "pro" or bool(user.get("stripe_subscription_id"))
    )
    entitled = paid_active or trial_active
    effective: PlanId = "pro" if entitled else "free"

    return {
        **base,
        "plan": effective,
        "entitled": entitled,
        "subscription_status": status if status not in {"", "none"} else ("trialing" if trial_active else "none"),
        "trial_ends_at": trial_ends.isoformat() if trial_ends else None,
        "trial_active": trial_active and not paid_active,
        "stripe_customer_id": user.get("stripe_customer_id"),
    }


def require_pro_feature(user: dict[str, Any], feature: str) -> None:
    """Raise HTTPException if the user cannot use a Pro-gated feature."""
    from fastapi import HTTPException

    snap = resolve_entitlement(user)
    if snap["entitled"]:
        return
    if feature not in PRO_FEATURES:
        return
    raise HTTPException(
        status_code=402,
        detail={
            "code": "pro_required",
            "feature": feature,
            "message": f"Upgrade to Pro to use {feature.replace('_', ' ')}.",
            "pricing_path": "/pricing",
        },
    )


def get_stripe_client():
    if not STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    import stripe

    return stripe.StripeClient(STRIPE_SECRET_KEY)


def ensure_stripe_customer(users_col, user: dict[str, Any]) -> str:
    existing = (user.get("stripe_customer_id") or "").strip()
    if existing:
        return existing
    client = get_stripe_client()
    email = str(user.get("email") or "")
    customer = client.v1.customers.create(
        params={
            "email": email or None,
            "metadata": {"user_id": str(user["_id"])},
        }
    )
    cid = str(customer["id"])
    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {"stripe_customer_id": cid, "updated_at": _now()}},
    )
    user["stripe_customer_id"] = cid
    return cid


def create_checkout_session(
    *,
    users_col,
    user: dict[str, Any],
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    if not billing_configured():
        raise RuntimeError("Billing is not configured")
    customer_id = ensure_stripe_customer(users_col, user)
    client = get_stripe_client()
    params: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": STRIPE_PRICE_PRO, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(user["_id"]),
        "metadata": {"user_id": str(user["_id"])},
        "subscription_data": {
            "metadata": {"user_id": str(user["_id"])},
        },
    }
    # Optional on older API versions — ignore if unsupported
    try:
        params["integration_identifier"] = f"tally-pro-{secrets.token_hex(4)}"
        session = client.v1.checkout.sessions.create(params=params)
    except Exception:
        params.pop("integration_identifier", None)
        session = client.v1.checkout.sessions.create(params=params)
    return {"id": session["id"], "url": session["url"]}


def create_portal_session(*, user: dict[str, Any], return_url: str) -> dict[str, Any]:
    cid = (user.get("stripe_customer_id") or "").strip()
    if not cid:
        raise RuntimeError("No Stripe customer on this account")
    client = get_stripe_client()
    session = client.v1.billing_portal.sessions.create(
        params={"customer": cid, "return_url": return_url}
    )
    return {"url": session["url"]}


def construct_webhook_event(payload: bytes, sig_header: str) -> dict[str, Any]:
    if not STRIPE_WEBHOOK_SECRET:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured")
    import stripe

    event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    if hasattr(event, "to_dict"):
        return event.to_dict()
    return dict(event)


def _set_user_subscription(
    users_col,
    *,
    user_id: Any = None,
    customer_id: str | None = None,
    plan: PlanId,
    status: str,
    subscription_id: str | None = None,
) -> None:
    from bson import ObjectId

    query: dict[str, Any] = {}
    if user_id is not None:
        try:
            query["_id"] = ObjectId(str(user_id))
        except Exception:  # noqa: BLE001
            return
    elif customer_id:
        query["stripe_customer_id"] = customer_id
    else:
        return

    patch: dict[str, Any] = {
        "plan": plan,
        "subscription_status": status,
        "updated_at": _now(),
    }
    if subscription_id:
        patch["stripe_subscription_id"] = subscription_id
    elif status == "canceled":
        patch["stripe_subscription_id"] = None
    users_col.update_one(query, {"$set": patch})


def handle_stripe_webhook_event(users_col, event: dict[str, Any]) -> None:
    etype = event.get("type") or ""
    data = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        if data.get("mode") != "subscription":
            return
        user_id = (data.get("metadata") or {}).get("user_id") or data.get("client_reference_id")
        sub_id = data.get("subscription")
        customer = data.get("customer")
        _set_user_subscription(
            users_col,
            user_id=user_id,
            customer_id=str(customer) if customer else None,
            plan="pro",
            status="active",
            subscription_id=str(sub_id) if sub_id else None,
        )
        return

    if etype in {
        "customer.subscription.updated",
        "customer.subscription.created",
    }:
        status = str(data.get("status") or "none")
        customer = data.get("customer")
        sub_id = data.get("id")
        user_id = (data.get("metadata") or {}).get("user_id")
        plan: PlanId = "pro" if status in {"active", "trialing"} else "free"
        _set_user_subscription(
            users_col,
            user_id=user_id,
            customer_id=str(customer) if customer else None,
            plan=plan,
            status=status,
            subscription_id=str(sub_id) if sub_id else None,
        )
        return

    if etype == "customer.subscription.deleted":
        customer = data.get("customer")
        user_id = (data.get("metadata") or {}).get("user_id")
        _set_user_subscription(
            users_col,
            user_id=user_id,
            customer_id=str(customer) if customer else None,
            plan="free",
            status="canceled",
            subscription_id=None,
        )
