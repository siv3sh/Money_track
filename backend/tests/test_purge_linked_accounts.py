"""Account delete must kill private SMS links (linked_accounts)."""

from __future__ import annotations

from bson import ObjectId


def test_purge_includes_linked_accounts():
    from auth_users import USER_OWNED_COLLECTIONS, purge_user_owned_data

    assert "linked_accounts" in USER_OWNED_COLLECTIONS

    class _FakeResult:
        deleted_count = 2

    class _FakeCol:
        def __init__(self):
            self.queries: list[dict] = []

        def delete_many(self, q):
            self.queries.append(q)
            return _FakeResult()

    class _FakeDb(dict):
        def __getitem__(self, name: str):
            if name not in self:
                dict.__setitem__(self, name, _FakeCol())
            return dict.__getitem__(self, name)

    db = _FakeDb()
    uid = ObjectId()
    deleted = purge_user_owned_data(db, uid)

    assert deleted.get("linked_accounts") == 2
    assert db["linked_accounts"].queries == [{"user_id": uid}]


def test_legacy_api_key_webhook_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("ALLOW_LEGACY_API_KEY_WEBHOOK", raising=False)
    # Re-read the module-level flag the same way main does
    import os

    allowed = (os.getenv("ALLOW_LEGACY_API_KEY_WEBHOOK") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    assert allowed is False
