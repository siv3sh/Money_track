"""Billing entitlement without Stripe keys = everyone entitled."""

from datetime import datetime, timedelta, timezone

from billing import apply_signup_trial, billing_configured, resolve_entitlement


def test_billing_disabled_entitles_everyone(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_PRICE_PRO", raising=False)
    # Re-read module flags — billing_configured reads env at call time via module globals
    import billing as b

    monkeypatch.setattr(b, "STRIPE_SECRET_KEY", "")
    monkeypatch.setattr(b, "STRIPE_PRICE_PRO", "")
    assert billing_configured() is False
    snap = resolve_entitlement({"email": "a@b.com", "_id": "x"})
    assert snap["entitled"] is True
    assert snap["plan"] == "pro"


def test_trial_active_entitles(monkeypatch):
    import billing as b

    monkeypatch.setattr(b, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(b, "STRIPE_PRICE_PRO", "price_x")
    assert billing_configured() is True
    user = apply_signup_trial(
        {
            "email": "a@b.com",
            "_id": "x",
            "created_at": datetime.now(timezone.utc),
        }
    )
    snap = resolve_entitlement(user)
    assert snap["entitled"] is True
    assert snap["trial_active"] is True


def test_expired_trial_not_entitled(monkeypatch):
    import billing as b

    monkeypatch.setattr(b, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(b, "STRIPE_PRICE_PRO", "price_x")
    user = {
        "email": "a@b.com",
        "_id": "x",
        "plan": "free",
        "subscription_status": "none",
        "trial_ends_at": datetime.now(timezone.utc) - timedelta(days=1),
        "created_at": datetime.now(timezone.utc) - timedelta(days=30),
    }
    snap = resolve_entitlement(user)
    assert snap["entitled"] is False
    assert snap["plan"] == "free"


def test_active_subscription_entitled(monkeypatch):
    import billing as b

    monkeypatch.setattr(b, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(b, "STRIPE_PRICE_PRO", "price_x")
    user = {
        "email": "a@b.com",
        "_id": "x",
        "plan": "pro",
        "subscription_status": "active",
        "stripe_subscription_id": "sub_123",
        "trial_ends_at": datetime.now(timezone.utc) - timedelta(days=1),
    }
    snap = resolve_entitlement(user)
    assert snap["entitled"] is True
    assert snap["plan"] == "pro"
