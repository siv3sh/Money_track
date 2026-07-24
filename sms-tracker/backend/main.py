import os
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pymongo import MongoClient, DESCENDING

from parser import parse_sms

app = FastAPI(title="SMS Money Tracker")

MONGO_URI = os.environ["MONGO_URI"]
client = MongoClient(MONGO_URI)
db = client["money_tracker"]
transactions = db["transactions"]

# Useful indexes for the dashboard queries below
transactions.create_index([("received_at", DESCENDING)])
transactions.create_index("card_type")


class SmsPayload(BaseModel):
    sender: str
    body: str
    timestamp: int | None = None  # epoch millis from the phone, optional


@app.post("/sms-webhook")
def receive_sms(payload: SmsPayload):
    txn = parse_sms(payload.sender, payload.body)

    if txn is None:
        return {"stored": False, "reason": "not a transaction SMS"}

    doc = {
        **txn,
        "sender": payload.sender,
        "received_at": (
            datetime.fromtimestamp(payload.timestamp / 1000, tz=timezone.utc)
            if payload.timestamp else datetime.now(timezone.utc)
        ),
    }

    result = transactions.insert_one(doc)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to store transaction")

    return {"stored": True, "transaction": txn}


@app.get("/transactions")
def list_transactions(limit: int = 50, card_type: str | None = None):
    query = {"card_type": card_type} if card_type else {}
    cursor = transactions.find(query).sort("received_at", DESCENDING).limit(limit)
    return [
        {**doc, "_id": str(doc["_id"])}  # ObjectId isn't JSON-serializable
        for doc in cursor
    ]


@app.get("/summary")
def summary():
    pipeline = [
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}}
    ]
    results = {r["_id"]: r["total"] for r in transactions.aggregate(pipeline)}
    total_debit = results.get("debit", 0)
    total_credit = results.get("credit", 0)
    return {
        "total_debit": total_debit,
        "total_credit": total_credit,
        "net": total_credit - total_debit,
    }
