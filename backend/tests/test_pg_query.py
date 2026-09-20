"""Unit tests for the Mongo-compatible query/aggregation layer."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from bson import ObjectId

from pg_query import aggregate, apply_update, compile_query, from_jsonable, match_doc, to_jsonable


class MatchDocTests(unittest.TestCase):
    def test_equality_and_objectid(self):
        uid = ObjectId()
        doc = {"_id": uid, "type": "debit", "amount": 100, "card_type": "upi"}
        self.assertTrue(match_doc(doc, {"user_id": uid}) is False)
        doc["user_id"] = uid
        self.assertTrue(match_doc(doc, {"user_id": uid, "type": "debit"}))
        self.assertTrue(match_doc(doc, {"amount": 100.0}))

    def test_ne_and_nor(self):
        doc = {"card_type": "upi", "raw_text": "paid at store"}
        self.assertTrue(match_doc(doc, {"card_type": {"$ne": "wallet"}}))
        self.assertFalse(
            match_doc(
                doc,
                {"$nor": [{"raw_text": {"$regex": "paid at", "$options": "i"}}]},
            )
        )
        noise = {"cc_sms_kind": "statement"}
        self.assertFalse(
            match_doc(noise, {"$nor": [{"cc_sms_kind": {"$in": ["statement", "payment"]}}]})
        )

    def test_exists_false(self):
        self.assertTrue(match_doc({"amount": 1}, {"user_id": {"$exists": False}}))
        self.assertFalse(match_doc({"user_id": ObjectId()}, {"user_id": {"$exists": False}}))

    def test_in_and_regex(self):
        doc = {"bank": "HDFC", "merchant": "Amazon"}
        self.assertTrue(match_doc(doc, {"bank": {"$in": ["hdfc", "HDFC"]}}))
        self.assertTrue(match_doc(doc, {"merchant": {"$regex": "ama", "$options": "i"}}))
        self.assertTrue(match_doc(doc, {"merchant": {"$nin": [None, ""]}}))


class AggregateTests(unittest.TestCase):
    def test_group_cond_and_date(self):
        uid = ObjectId()
        docs = [
            {
                "user_id": uid,
                "type": "debit",
                "amount": 50,
                "received_at": datetime(2026, 4, 1, 10, tzinfo=timezone.utc),
                "card_type": "upi",
            },
            {
                "user_id": uid,
                "type": "credit",
                "amount": 20,
                "received_at": datetime(2026, 4, 2, 10, tzinfo=timezone.utc),
                "card_type": "upi",
            },
        ]
        rows = aggregate(
            docs,
            [
                {"$match": {"user_id": uid, "card_type": {"$ne": "wallet"}}},
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {
                                "format": "%Y-%m",
                                "date": "$received_at",
                                "timezone": "Asia/Kolkata",
                            }
                        },
                        "debit": {"$sum": {"$cond": [{"$eq": ["$type", "debit"]}, "$amount", 0]}},
                        "credit": {"$sum": {"$cond": [{"$eq": ["$type", "credit"]}, "$amount", 0]}},
                        "count": {"$sum": 1},
                    }
                },
            ],
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["_id"], "2026-04")
        self.assertEqual(rows[0]["debit"], 50)
        self.assertEqual(rows[0]["credit"], 20)
        self.assertEqual(rows[0]["count"], 2)

    def test_first_after_sort(self):
        docs = [
            {"bank": "HDFC", "account_last4": "1234", "balance": 10, "received_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
            {"bank": "HDFC", "account_last4": "1234", "balance": 99, "received_at": datetime(2026, 2, 1, tzinfo=timezone.utc)},
        ]
        rows = aggregate(
            docs,
            [
                {"$sort": {"received_at": -1}},
                {
                    "$group": {
                        "_id": {"bank": "$bank", "last4": "$account_last4"},
                        "balance": {"$first": "$balance"},
                    }
                },
            ],
        )
        self.assertEqual(rows[0]["balance"], 99)


class CodecTests(unittest.TestCase):
    def test_roundtrip(self):
        uid = ObjectId()
        doc = {
            "_id": uid,
            "user_id": uid,
            "received_at": datetime(2026, 3, 1, 12, 30, tzinfo=timezone.utc),
            "amount": 12.5,
            "label": "ok",
        }
        encoded = to_jsonable(doc)
        decoded = from_jsonable(encoded)
        self.assertEqual(decoded["_id"], uid)
        self.assertEqual(decoded["user_id"], uid)
        self.assertEqual(decoded["received_at"], datetime(2026, 3, 1, 12, 30, tzinfo=timezone.utc))
        self.assertEqual(decoded["amount"], 12.5)

    def test_set_unset(self):
        doc = {"_id": "a", "active": True, "token": "x"}
        nxt = apply_update(doc, {"$set": {"active": False}, "$unset": {"token": ""}}, is_insert=False)
        self.assertFalse(nxt["active"])
        self.assertNotIn("token", nxt)


class CompileQueryTests(unittest.TestCase):
    def test_list_endpoint_is_complete(self):
        uid = ObjectId()
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        compiled = compile_query(
            {
                "user_id": uid,
                "type": "debit",
                "card_type": "upi",
                "received_at": {"$gte": start},
                "bank": {"$regex": "^HDFC$", "$options": "i"},
            }
        )
        self.assertTrue(compiled.complete)
        ops = {(p.field, p.op) for p in compiled.predicates}
        self.assertIn(("user_id", "eq"), ops)
        self.assertIn(("type", "eq"), ops)
        self.assertIn(("received_at", "gte"), ops)
        self.assertIn(("bank", "ilike"), ops)

    def test_search_or_is_complete(self):
        compiled = compile_query(
            {
                "user_id": ObjectId(),
                "$or": [
                    {"merchant": {"$regex": "ama", "$options": "i"}},
                    {"raw_text": {"$regex": "ama", "$options": "i"}},
                ],
            }
        )
        self.assertTrue(compiled.complete)
        self.assertEqual(len(compiled.or_groups), 1)
        self.assertEqual(len(compiled.or_groups[0]), 2)

    def test_amount_and_ne_stay_in_remainder(self):
        compiled = compile_query(
            {"user_id": ObjectId(), "amount": {"$gte": 10}, "active": {"$ne": False}}
        )
        self.assertFalse(compiled.complete)
        self.assertIn("amount", compiled.remainder)
        self.assertIn("active", compiled.remainder)
        self.assertEqual(compiled.predicates[0].field, "user_id")


class RestLiteralTests(unittest.TestCase):
    def test_email_and_iso_are_unquoted(self):
        from pg_store import _rest_literal

        self.assertEqual(_rest_literal("siv3sh@gmail.com"), "siv3sh@gmail.com")
        self.assertEqual(_rest_literal("2026-01-01T00:00:00.000Z"), "2026-01-01T00:00:00.000Z")
        self.assertTrue(_rest_literal("a,b").startswith('"'))


if __name__ == "__main__":
    unittest.main()
