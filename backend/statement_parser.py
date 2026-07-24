"""
Parse bank statement CSV / TSV / pasted text into Transaction dicts.

Supported CSV headers (case-insensitive, flexible aliases):
  date, description/narration/remarks, amount / debit+credit, type optional
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Any, Optional

from parser import Transaction, _detect_bank, parse_sms

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d-%m-%y",
    "%d/%m/%y",
    "%Y/%m/%d",
    "%d %b %Y",
    "%d-%b-%Y",
    "%d %B %Y",
    "%b %d, %Y",
)

HEADER_ALIASES = {
    "date": {"date", "txn date", "transaction date", "value date", "tran date", "posted"},
    "description": {
        "description",
        "narration",
        "remarks",
        "particulars",
        "details",
        "merchant",
        "payee",
        "transaction details",
    },
    "amount": {"amount", "txn amount", "transaction amount", "amt"},
    "debit": {"debit", "withdrawal", "dr", "debit amount", "withdrawals"},
    "credit": {"credit", "deposit", "cr", "credit amount", "deposits"},
    "type": {"type", "txn type", "transaction type", "dr/cr", "credit/debit"},
    "balance": {"balance", "closing balance", "available balance", "bal"},
}


def _norm_header(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _map_headers(fieldnames: list[str]) -> dict[str, str]:
    """Map canonical name -> actual CSV header."""
    mapping: dict[str, str] = {}
    normalized = {_norm_header(f): f for f in fieldnames if f}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                mapping[canonical] = normalized[alias]
                break
    return mapping


def _parse_date(raw: str) -> Optional[datetime]:
    text = (raw or "").strip()
    if not text:
        return None
    # Strip time if present
    text = re.split(r"[ T]", text, maxsplit=1)[0]
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(text, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _parse_money(raw: str) -> Optional[float]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text in {"-", "--", "—"}:
        return None
    # (1,234.56) accounting negative
    neg = text.startswith("(") and text.endswith(")")
    text = text.replace("₹", "").replace("INR", "").replace("Rs.", "").replace("Rs", "")
    text = text.replace(",", "").replace("(", "").replace(")", "").strip()
    text = re.sub(r"[^\d.\-]", "", text)
    if not text or text in {".", "-"}:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if neg:
        value = -abs(value)
    return value


def _row_type(
    mapped: dict[str, str],
    row: dict[str, str],
    amount: Optional[float],
    debit: Optional[float],
    credit: Optional[float],
) -> Optional[str]:
    type_col = mapped.get("type")
    if type_col:
        t = (row.get(type_col) or "").strip().lower()
        if t in {"dr", "debit", "withdrawal", "d", "paid"}:
            return "debit"
        if t in {"cr", "credit", "deposit", "c", "received"}:
            return "credit"

    if debit is not None and debit > 0 and (credit is None or credit == 0):
        return "debit"
    if credit is not None and credit > 0 and (debit is None or debit == 0):
        return "credit"
    if amount is not None:
        if amount < 0:
            return "debit"
        if amount > 0:
            # Ambiguous single Amount column — many banks use signed or always positive.
            # Prefer description cues.
            return None
    return None


def _type_from_description(desc: str) -> Optional[str]:
    lower = desc.lower()
    if any(k in lower for k in ("debit", "withdrawal", "paid", "purchase", "upi-")):
        if "credit" not in lower[:20]:
            return "debit"
    if any(k in lower for k in ("credit", "deposit", "salary", "refund", "interest")):
        return "credit"
    return None


def parse_statement_csv(
    content: str,
    *,
    bank: Optional[str] = None,
    default_card_type: str = "bank_account",
) -> list[tuple[Transaction, datetime]]:
    """
    Returns list of (Transaction, received_at).
    """
    text = content.lstrip("\ufeff").strip()
    if not text:
        return []

    # Detect delimiter
    sample = text[:2000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t|;")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return []

    mapped = _map_headers(list(reader.fieldnames))
    if "date" not in mapped or "description" not in mapped:
        # Need at least date + description; amount via amount or debit/credit
        if "date" not in mapped:
            return []
    if "amount" not in mapped and "debit" not in mapped and "credit" not in mapped:
        return []

    bank_name = bank or None
    results: list[tuple[Transaction, datetime]] = []

    for row in reader:
        if not row:
            continue
        date_raw = row.get(mapped["date"], "") if "date" in mapped else ""
        received_at = _parse_date(date_raw)
        if received_at is None:
            continue

        desc = ""
        if "description" in mapped:
            desc = (row.get(mapped["description"]) or "").strip()
        if not desc:
            continue

        debit = _parse_money(row.get(mapped["debit"], "")) if "debit" in mapped else None
        credit = _parse_money(row.get(mapped["credit"], "")) if "credit" in mapped else None
        amount_col = _parse_money(row.get(mapped["amount"], "")) if "amount" in mapped else None

        txn_type = _row_type(mapped, row, amount_col, debit, credit)
        if txn_type is None:
            txn_type = _type_from_description(desc)
        if txn_type is None and amount_col is not None:
            # Default: positive amount column treated as debit for spend trackers
            # unless description says credit
            txn_type = "debit" if amount_col >= 0 else "credit"
            if amount_col < 0:
                amount_col = abs(amount_col)

        if txn_type == "debit":
            amount = debit if debit and debit > 0 else (abs(amount_col) if amount_col else None)
        elif txn_type == "credit":
            amount = credit if credit and credit > 0 else (abs(amount_col) if amount_col else None)
        else:
            continue

        if amount is None or amount <= 0:
            continue

        balance = None
        if "balance" in mapped:
            balance = _parse_money(row.get(mapped["balance"], ""))

        # Prefer SMS-style parse on narration when it looks like an SMS
        sms_txn = parse_sms(bank_name or "STATEMENT", desc)
        if sms_txn is not None:
            txn = sms_txn
            if bank_name:
                txn["bank"] = bank_name
            txn["raw_text"] = desc
            if balance is not None:
                txn["balance"] = balance
        else:
            merchant = desc[:60]
            # Strip leading ref codes
            merchant = re.sub(r"^(UPI|NEFT|IMPS|RTGS)[/\-\s]+", "", merchant, flags=re.I)
            txn = Transaction(
                type=txn_type,
                amount=float(amount),
                account_last4=None,
                card_type=default_card_type,
                merchant=merchant.strip() or None,
                balance=balance,
                bank=bank_name or _detect_bank(bank_name or ""),
                raw_text=desc,
            )

        results.append((txn, received_at))

    return results


def parse_statement_text(
    content: str,
    *,
    bank: Optional[str] = None,
    sender: str = "STATEMENT",
) -> list[tuple[Transaction, datetime]]:
    """
    Each non-empty line: optional leading date, then SMS-like or free text.
    Examples:
      2026-07-15 Rs.200 debited ... at SWIGGY
      15/07/2026,SWIGGY,200,DR
    """
    results: list[tuple[Transaction, datetime]] = []
    # Try CSV first if it looks like one
    if "," in content and ("date" in content.lower()[:200] or "narration" in content.lower()[:200]):
        csv_rows = parse_statement_csv(content, bank=bank)
        if csv_rows:
            return csv_rows

    date_line_re = re.compile(
        r"^(\d{1,4}[-/]\d{1,2}[-/]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s*[,:\-]?\s*(.+)$"
    )

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        received_at = datetime.now(timezone.utc)
        body = line
        m = date_line_re.match(line)
        if m:
            parsed = _parse_date(m.group(1))
            if parsed:
                received_at = parsed
                body = m.group(2).strip()

        txn = parse_sms(sender if not bank else bank, body)
        if txn is None:
            # Minimal fallback: amount + DR/CR
            amount_m = re.search(
                r"(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
                body,
                re.I,
            )
            if not amount_m:
                continue
            amount = float(amount_m.group(1).replace(",", ""))
            lower = body.lower()
            if any(k in lower for k in (" cr", "credit", "deposit")):
                txn_type = "credit"
            elif any(k in lower for k in (" dr", "debit", "withdraw", "paid", "spent")):
                txn_type = "debit"
            else:
                continue
            txn = Transaction(
                type=txn_type,
                amount=amount,
                account_last4=None,
                card_type="bank_account",
                merchant=body[:60],
                balance=None,
                bank=bank,
                raw_text=body,
            )
        elif bank:
            txn["bank"] = bank

        results.append((txn, received_at))

    return results


def _cell_to_str(c: Any) -> str:
    if c is None:
        return ""
    if isinstance(c, datetime):
        return c.strftime("%Y-%m-%d")
    if isinstance(c, float) and c == int(c) and 20000 < c < 60000:
        # Likely Excel serial date left as float (rare with data_only)
        try:
            from datetime import timedelta

            base = datetime(1899, 12, 30, tzinfo=timezone.utc)
            return (base + timedelta(days=int(c))).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            pass
    return str(c).strip()


def _rows_to_csv_text(rows: list[list[Any]]) -> str:
    """Serialize a 2D table to CSV text for reuse of parse_statement_csv."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow([_cell_to_str(c) for c in row])
    return buf.getvalue()


def _find_header_row(rows: list[list[Any]], scan: int = 40) -> int:
    """Pick the row that looks most like column headers (date + description)."""
    best_idx, best_score = 0, -1
    for i, row in enumerate(rows[:scan]):
        cells = [_norm_header(str(c)) for c in row if c is not None and str(c).strip()]
        if not cells:
            continue
        score = 0
        joined = " ".join(cells)
        for aliases in HEADER_ALIASES.values():
            if any(a in cells or a in joined for a in aliases):
                score += 1
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx


def parse_statement_excel(
    raw: bytes,
    *,
    bank: Optional[str] = None,
    filename: str = "",
) -> list[tuple[Transaction, datetime]]:
    """Parse .xlsx (openpyxl) or .xls (xlrd) into transactions."""
    name = (filename or "").lower()
    rows: list[list[Any]] = []

    if name.endswith(".xls") and not name.endswith(".xlsx"):
        import xlrd  # type: ignore

        book = xlrd.open_workbook(file_contents=raw)
        sheet = book.sheet_by_index(0)
        for r in range(sheet.nrows):
            rows.append([sheet.cell_value(r, c) for c in range(sheet.ncols)])
    else:
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        try:
            ws = wb.active
            for row in ws.iter_rows(values_only=True):
                if row is None:
                    continue
                rows.append(list(row))
        finally:
            wb.close()

    if not rows:
        return []

    header_idx = _find_header_row(rows)
    table = rows[header_idx:]
    # Drop fully empty rows
    table = [r for r in table if any(c is not None and str(c).strip() for c in r)]
    if len(table) < 2:
        return []

    csv_text = _rows_to_csv_text(table)
    return parse_statement_csv(csv_text, bank=bank)


def parse_statement_pdf(
    raw: bytes,
    *,
    bank: Optional[str] = None,
) -> list[tuple[Transaction, datetime]]:
    """
    Parse PDF bank statements:
    1) extract tables → CSV path
    2) fallback to plain text line parsing
    """
    import pdfplumber

    all_pairs: list[tuple[Transaction, datetime]] = []
    text_chunks: list[str] = []

    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                if not table or len(table) < 2:
                    continue
                cleaned = [
                    [("" if c is None else str(c).replace("\n", " ").strip()) for c in row]
                    for row in table
                    if row and any(c is not None and str(c).strip() for c in row)
                ]
                if len(cleaned) < 2:
                    continue
                header_idx = _find_header_row(cleaned)
                slice_rows = cleaned[header_idx:]
                pairs = parse_statement_csv(_rows_to_csv_text(slice_rows), bank=bank)
                all_pairs.extend(pairs)

            page_text = page.extract_text() or ""
            if page_text.strip():
                text_chunks.append(page_text)

    if all_pairs:
        return all_pairs

    combined = "\n".join(text_chunks)
    if combined.strip():
        return parse_statement_text(combined, bank=bank)
    return []


def parse_statement(
    content: str,
    *,
    bank: Optional[str] = None,
    fmt: str = "auto",
) -> list[dict[str, Any]]:
    """
    Unified entry for text/CSV: returns docs ready for Mongo insert.
    """
    fmt = (fmt or "auto").lower()
    if fmt == "csv":
        pairs = parse_statement_csv(content, bank=bank)
    elif fmt == "text":
        pairs = parse_statement_text(content, bank=bank)
    else:
        # auto: prefer CSV if headers look right
        pairs = parse_statement_csv(content, bank=bank)
        if not pairs:
            pairs = parse_statement_text(content, bank=bank)

    return _pairs_to_docs(pairs)


def parse_statement_file(
    raw: bytes,
    filename: str,
    *,
    bank: Optional[str] = None,
    fmt: str = "auto",
) -> list[dict[str, Any]]:
    """
    Parse uploaded file bytes (.csv/.txt/.tsv/.xlsx/.xls/.pdf).
    """
    name = (filename or "").lower()
    fmt = (fmt or "auto").lower()

    if name.endswith(".pdf") or fmt == "pdf":
        pairs = parse_statement_pdf(raw, bank=bank)
        return _pairs_to_docs(pairs)

    if name.endswith(".xlsx") or name.endswith(".xls") or fmt in {"xlsx", "xls", "excel"}:
        pairs = parse_statement_excel(raw, bank=bank, filename=name)
        return _pairs_to_docs(pairs)

    # Text-like formats
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    if name.endswith(".csv") or fmt == "csv":
        return parse_statement(content, bank=bank, fmt="csv")
    if name.endswith(".txt") or name.endswith(".tsv") or fmt == "text":
        return parse_statement(content, bank=bank, fmt="text" if name.endswith(".txt") else "auto")
    return parse_statement(content, bank=bank, fmt="auto")


def _pairs_to_docs(pairs: list[tuple[Transaction, datetime]]) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    for txn, received_at in pairs:
        docs.append(
            {
                **txn,
                "sender": "STATEMENT",
                "received_at": received_at,
                "source": "statement",
            }
        )
    return docs
