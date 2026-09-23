"""Authenticated password change."""

from auth_users import change_password, hash_password
from fastapi import HTTPException


class _FakeUsers:
    def __init__(self, doc):
        self.doc = doc

    def update_one(self, q, update):
        assert q["_id"] == self.doc["_id"]
        if "$set" in update:
            self.doc.update(update["$set"])
        if "$unset" in update:
            for k in update["$unset"]:
                self.doc.pop(k, None)

    def find_one(self, q):
        if q.get("_id") == self.doc["_id"]:
            return dict(self.doc)
        return None


def test_change_password_success():
    user = {
        "_id": "u1",
        "email": "a@b.com",
        "password_hash": hash_password("old-password-1"),
    }
    col = _FakeUsers(user)
    out = change_password(col, user, current_password="old-password-1", new_password="new-password-9")
    assert out["password_hash"] != hash_password("old-password-1")
    # verify new hash works
    from auth_users import verify_password

    assert verify_password(out["password_hash"], "new-password-9")


def test_change_password_wrong_current():
    user = {
        "_id": "u1",
        "email": "a@b.com",
        "password_hash": hash_password("old-password-1"),
    }
    col = _FakeUsers(user)
    try:
        change_password(col, user, current_password="nope", new_password="new-password-9")
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 401


def test_change_password_too_short():
    user = {
        "_id": "u1",
        "email": "a@b.com",
        "password_hash": hash_password("old-password-1"),
    }
    col = _FakeUsers(user)
    try:
        change_password(col, user, current_password="old-password-1", new_password="short")
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400
