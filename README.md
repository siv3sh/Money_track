# SMS Money Tracker

Personal finance tracker that captures bank/UPI SMS from your iPhone (via Shortcuts), parses debit/credit details with the tested `parser.py`, stores them in MongoDB, and shows them on a web dashboard.

Single-user — webhook protected by an API key only.

```
iPhone Shortcuts  →  POST /sms-webhook  →  parser.py  →  MongoDB
                                                      ↓
                                              React dashboard
```

## Project layout

```
money_track/
├── backend/
│   ├── main.py           # FastAPI (extends your working webhook + queries)
│   ├── parser.py         # Your tested SMS → Transaction parser (do not rewrite)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/             # Vite + React + TypeScript + Tailwind
├── docker-compose.yml
└── README.md
```

## 1. MongoDB (Atlas free tier)

1. Create an account at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a **free (M0)** cluster.
3. **Database Access** → add a user.
4. **Network Access** → allow your IP (or `0.0.0.0/0` for a trusted personal project).
5. Copy the connection URI into `backend/.env` as `MONGO_URI`.

Local alternative:

```bash
docker compose up -d mongo
# MONGO_URI=mongodb://localhost:27017
```

## 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set MONGO_URI + API_KEY
uvicorn main:app --reload --port 8000
```

Docs: http://localhost:8000/docs

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/sms-webhook` | `X-API-Key` | `{ sender, body, timestamp? }` — `timestamp` is epoch millis |
| `GET` | `/transactions` | — | `limit`, `skip`, `card_type`, `bank`, `type`, `date_from`, `date_to`, `sort`, `order` |
| `DELETE` | `/transactions/{id}` | — | Remove a mis-parsed row |
| `GET` | `/summary` | — | Totals + this/last month |
| `GET` | `/summary/monthly` | — | Monthly debit/credit for charts |
| `GET` | `/summary/merchants` | — | Top debit merchants |

### Quick webhook test

```bash
curl -X POST http://localhost:8000/sms-webhook \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "sender": "HDFCBK",
    "body": "Rs.500.00 debited from a/c XX1234 at AMAZON on 23-07-26. Avl Bal Rs.12,345.00"
  }'
```

## 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173 — summary header, monthly chart, merchant spend, filterable table, dark mode.

## 4. iOS Shortcuts

One Personal Automation per bank sender:

1. Trigger: **Message** from that sender (e.g. `VM-HDFCBK` — map sender IDs in `parser.BANK_SENDER_MAP` if needed).
2. Action: **Get Contents of URL**
   - URL: `https://YOUR-BACKEND/sms-webhook`
   - Method: `POST`
   - Headers: `Content-Type: application/json`, `X-API-Key: <API_KEY>`
   - JSON body: `{ "sender": "HDFCBK", "body": "<Message Text>" }`  
     Optionally include `"timestamp": <epoch millis>`.
3. Turn **Ask Before Running** off.

Use ngrok/Cloudflare Tunnel while developing against a laptop.

> Note: `BANK_SENDER_MAP` keys are exact (`HDFCBK`, `SBIINB`, …). If Shortcuts sends `VM-HDFCBK`, either pass the bare bank id as `sender`, or extend the map in `parser.py`.

## 5. Deploy

- **Backend**: Railway / Render — `uvicorn main:app --host 0.0.0.0 --port $PORT`, env: `MONGO_URI`, `API_KEY`, `CORS_ORIGINS`
- **Frontend**: Vercel — root `frontend/`, env `VITE_API_URL=https://your-backend…`

```bash
export API_KEY=dev-local-api-key
docker compose up --build   # mongo + backend
```

## Transaction shape (`parser.Transaction`)

| Field | Type | Notes |
|-------|------|--------|
| `type` | `debit` \| `credit` | |
| `amount` | float | |
| `account_last4` | str \| null | |
| `card_type` | `credit_card` \| `debit_card` \| `upi` \| `bank_account` \| null | |
| `merchant` | str \| null | Or UPI VPA |
| `balance` | float \| null | |
| `bank` | str \| null | From sender map |
| `raw_text` | str | Original SMS |

Stored documents also include `sender`, `received_at`, and `_id`.
