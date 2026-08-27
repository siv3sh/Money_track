"""Golden regression tests — advisor must not leak hardcoded example brands.

Run from backend/:
  python -m unittest tests.test_advisor_golden -v
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

from advisor_persona import build_chat_system_prompt, _profile_grounding_block
from advisor_presence import (
    build_compact_chat_user_state,
    detect_money_mood,
    _llm_history_lines,
)
from learned_facts import advisor_profile_from_facts, trained_profile_fields
from planning import (
    build_calibration_personalization_note,
    build_cut_first_rule,
    build_merchant_personalization_note,
    temptation_label,
)


# Strings that used to leak from templates / placeholders into advisor copy
FORBIDDEN_WHEN_ABSENT = ("oxygen", "ps5", "playstation", "cursor")


def _fixture_analytics(*, merchants: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "range": {"date_from": None, "date_to": None},
        "overview": {
            "total_debit": 50000.0,
            "total_credit": 80000.0,
            "net": 30000.0,
            "lifestyle_spend": 20000.0,
            "salary_total": 75000.0,
            "other_income_total": 5000.0,
            "credit_card_spend": 0.0,
            "bank_upi_spend": 20000.0,
            "transfers_debit": 0.0,
            "investments_debit": 5000.0,
            "lifestyle_to_salary": 26.7,
            "net_worth_estimate": 100000.0,
            "liquid_total": 40000.0,
            "liabilities_total": 0.0,
        },
        "mom": {"net_pct": 5.0},
        "by_category_lifestyle": [
            {"name": "Food & Dining", "debit": 8000.0, "credit": 0, "count": 12},
            {"name": "Shopping", "debit": 5000.0, "credit": 0, "count": 4},
        ],
        "merchants": merchants
        or [
            {"merchant": "Cafe Local", "amount": 4200.0, "count": 8},
            {"merchant": "City Mart", "amount": 3100.0, "count": 5},
        ],
        "investments": {"total_invested": 5000.0, "total_current": 5200.0, "pnl": 200.0},
        "alerts": [],
    }


def _assert_no_forbidden(text: str, *, allowed: set[str] | None = None) -> None:
    allowed = {a.lower() for a in (allowed or set())}
    low = (text or "").lower()
    for token in FORBIDDEN_WHEN_ABSENT:
        if token in allowed:
            continue
        if token in low:
            raise AssertionError(f"Forbidden example token {token!r} found in: {text!r}")


class AdvisorGoldenLeakTests(unittest.TestCase):
    def test_untrained_profile_has_no_strict_friend_default(self) -> None:
        profile = advisor_profile_from_facts(None)
        self.assertIsNone(profile.get("coach_tone"))
        self.assertEqual(profile.get("completeness"), 0.0)
        self.assertEqual(trained_profile_fields(profile), {})

    def test_chat_system_untrained_is_neutral_no_example_brands(self) -> None:
        prompt = build_chat_system_prompt(
            learned_facts=None,
            severity={"level": "informational", "context_line": "tone: informational"},
        )
        _assert_no_forbidden(prompt)
        self.assertIn("Neutral, data-grounded", prompt)
        self.assertNotIn("strict friend", prompt.lower())

    def test_user_state_profile_empty_when_untrained(self) -> None:
        analytics = _fixture_analytics()
        state = build_compact_chat_user_state(
            analytics,
            severity={"level": "informational", "reasons": []},
            profile=advisor_profile_from_facts(None),
            goals=[],
            memory_lines=[],
            learned_facts=None,
        )
        self.assertNotIn("profile", state)  # empty profile omitted
        blob = str(state).lower()
        _assert_no_forbidden(blob)

    def test_personalization_notes_use_fixture_merchants_not_oxygen(self) -> None:
        merchants = [
            {"name": "Cafe Local", "amount": 4200, "protected": False, "category": "Food & Dining"},
            {"name": "City Mart", "amount": 3100, "protected": False, "category": "Shopping"},
            {"name": "INDmoney SIP", "amount": 5000, "protected": True, "category": "Investments"},
        ]
        note = build_merchant_personalization_note(merchants)
        cal = build_calibration_personalization_note(merchants)
        rule = build_cut_first_rule(merchants)
        for text in (note, cal, rule):
            self.assertIn("Cafe Local", text)
            _assert_no_forbidden(text)

    def test_temptation_label_from_fixture_not_hardcoded_oxygen(self) -> None:
        analytics = _fixture_analytics()
        label = temptation_label(profile={}, analytics=analytics)
        self.assertEqual(label, "Cafe Local")
        _assert_no_forbidden(label)

    def test_salary_mood_headline_uses_dynamic_temptation(self) -> None:
        analytics = _fixture_analytics()
        analytics["overview"]["salary_total"] = 75000.0
        salary_doc = {
            "amount": 75000.0,
            "merchant": "Payroll ACME",
            "raw_text": "NEFT salary credit from ACME",
            "category": "Income",
            "received_at": datetime.now(timezone.utc),
        }
        txn = MagicMock()
        txn.find.return_value.sort.return_value.limit.return_value = [salary_doc]
        mood = detect_money_mood(
            analytics=analytics,
            transactions=txn,
            learned_facts=None,
        )
        self.assertEqual(mood.get("mood"), "salary_happy")
        headline = mood.get("headline") or ""
        self.assertTrue(headline)
        self.assertIn("Cafe Local", headline)  # top fixture merchant temptation
        self.assertNotIn("Oxygen", headline)
        _assert_no_forbidden(headline)

    def test_template_nudge_excluded_from_llm_history(self) -> None:
        messages = [
            {
                "role": "advisor",
                "content": "Pay yourself first before Oxygen calls.",
                "meta": {"nudge": True, "exclude_from_llm": True},
            },
            {"role": "user", "content": "How am I doing on food this month?"},
        ]
        lines = _llm_history_lines(messages, limit=6)
        joined = "\n".join(lines)
        self.assertNotIn("Oxygen", joined)
        self.assertIn("food this month", joined)

    def test_trained_soft_spot_may_mention_oxygen(self) -> None:
        """When fixture training includes Oxygen, it is allowed in profile grounding."""
        profile = {
            "preferred_name": "Alex",
            "coach_tone": "warm coach",
            "soft_spot": "impulse shopping (Oxygen / gadgets)",
            "trained_keys": ["preferred_name", "coach_tone", "soft_spot"],
            "completeness": 37.5,
        }
        block = "\n".join(_profile_grounding_block(profile))
        self.assertIn("Oxygen", block)
        # PS5 still forbidden — not in this fixture
        self.assertNotIn("PS5", block)
        self.assertNotIn("PlayStation", block)

    def test_ps5_allowed_only_when_in_trained_motivation(self) -> None:
        profile = {
            "preferred_name": "Alex",
            "motivation": "PS5 bought with cash",
            "trained_keys": ["preferred_name", "motivation"],
            "completeness": 25.0,
        }
        block = "\n".join(_profile_grounding_block(profile))
        self.assertIn("PS5", block)
        _assert_no_forbidden(block, allowed={"ps5"})


if __name__ == "__main__":
    unittest.main()
