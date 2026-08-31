"""Regression: analytics / match helpers must never run unscoped."""

from __future__ import annotations

import pytest
from bson import ObjectId


def test_match_range_requires_user_id():
    from analytics import _match_range

    with pytest.raises(ValueError, match="user_id"):
        _match_range(None, None)


def test_match_range_includes_user_id():
    from analytics import _match_range

    uid = ObjectId()
    match = _match_range(None, None, user_id=uid)
    assert match["user_id"] == uid


def test_user_match_rejects_none():
    from auth_users import user_match

    with pytest.raises(ValueError, match="user_id"):
        user_match(None)


def test_attach_smart_insights_requires_user_id():
    from smart_insights import attach_smart_insights

    with pytest.raises(ValueError, match="user_id"):
        attach_smart_insights({}, None)
