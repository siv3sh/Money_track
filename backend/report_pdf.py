"""PDF export for monthly reports — chart-first (bars), minimal prose."""

from __future__ import annotations

from io import BytesIO
from typing import Any

from fpdf import FPDF


def _safe(text: Any) -> str:
    """FPDF core fonts are Latin-1; map common INR/unicode to ASCII-ish."""
    s = str(text or "")
    replacements = {
        "₹": "Rs ",
        "—": "-",
        "–": "-",
        "•": "*",
        "→": "->",
        "…": "...",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
    }
    for a, b in replacements.items():
        s = s.replace(a, b)
    return s.encode("latin-1", errors="replace").decode("latin-1")


class _ReportPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, _safe(f"Money Track  |  page {self.page_no()}"), align="C")


def _section(pdf: _ReportPDF, title: str) -> None:
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(40, 40, 40)
    pdf.cell(0, 8, _safe(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(220, 220, 220)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(3)


def _muted(pdf: _ReportPDF, text: str) -> None:
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(0, 5, _safe(text))
    pdf.ln(1)


def _hbar_chart(
    pdf: _ReportPDF,
    rows: list[tuple[str, float]],
    *,
    bar_rgb: tuple[int, int, int] = (180, 35, 24),
    max_rows: int = 8,
) -> None:
    cleaned = [(str(n)[:28], float(v)) for n, v in rows if float(v) > 0][:max_rows]
    if not cleaned:
        _muted(pdf, "No data for this chart.")
        return
    peak = max(v for _, v in cleaned) or 1.0
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    label_w = 48
    value_w = 28
    bar_w = usable - label_w - value_w - 4
    row_h = 7
    for name, amt in cleaned:
        y = pdf.get_y()
        if y + row_h + 14 > pdf.page_break_trigger:
            pdf.add_page()
            y = pdf.get_y()
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(pdf.l_margin, y)
        pdf.cell(label_w, row_h, _safe(name), align="L")
        frac = amt / peak
        bw = max(2.0, bar_w * frac)
        pdf.set_fill_color(236, 236, 236)
        pdf.rect(pdf.l_margin + label_w + 1, y + 1.5, bar_w, row_h - 3, style="F")
        pdf.set_fill_color(*bar_rgb)
        pdf.rect(pdf.l_margin + label_w + 1, y + 1.5, bw, row_h - 3, style="F")
        pdf.set_xy(pdf.l_margin + label_w + bar_w + 2, y)
        pdf.set_text_color(60, 60, 60)
        pdf.cell(value_w, row_h, _safe(f"Rs {amt:,.0f}"), align="R")
        pdf.set_y(y + row_h)
    pdf.ln(2)


def _paired_bars(
    pdf: _ReportPDF,
    rows: list[tuple[str, float, float]],
    *,
    max_rows: int = 6,
) -> None:
    """Prior (blue) vs this month (red)."""
    cleaned = [(str(n)[:22], float(a), float(b)) for n, a, b in rows][:max_rows]
    cleaned = [r for r in cleaned if r[1] > 0 or r[2] > 0]
    if not cleaned:
        _muted(pdf, "No comparison data.")
        return
    peak = max(max(a, b) for _, a, b in cleaned) or 1.0
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    label_w = 42
    bar_w = usable - label_w - 2
    for name, prior, cur in cleaned:
        y = pdf.get_y()
        if y + 14 > pdf.page_break_trigger:
            pdf.add_page()
            y = pdf.get_y()
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(pdf.l_margin, y)
        pdf.cell(label_w, 12, _safe(name), align="L")
        x0 = pdf.l_margin + label_w
        pdf.set_fill_color(37, 99, 235)
        pdf.rect(x0, y + 1, max(1.5, bar_w * (prior / peak)), 4, style="F")
        pdf.set_fill_color(180, 35, 24)
        pdf.rect(x0, y + 6.5, max(1.5, bar_w * (cur / peak)), 4, style="F")
        pdf.set_y(y + 13)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 4, "Blue = prior month   |   Red = this month", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def render_report_pdf(
    report: dict[str, Any],
    *,
    advisor_profile: dict[str, Any] | None = None,
) -> bytes:
    """Chart-first PDF — bars tell the story; prose is optional and short."""
    stats = report.get("stats") or {}
    narrative = report.get("narrative") or {}
    review = stats.get("month_end_review") or {}
    headline = stats.get("headline_metric") or {}
    current = stats.get("current") or {}
    previous = stats.get("previous") or {}
    label = report.get("label") or stats.get("label") or report.get("month") or "Monthly report"
    who = (advisor_profile or {}).get("preferred_name") or "you"

    pdf = _ReportPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.set_margins(18, 16, 18)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, _safe(f"Your Money Advisor  ·  for {who}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 10, _safe(str(label)), new_x="LMARGIN", new_y="NEXT")
    savings = headline.get("savings_rate_pct")
    vs = headline.get("vs_prior_lifestyle_pct")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(80, 80, 80)
    line = f"Savings rate: {savings if savings is not None else '-'}%"
    if vs is not None:
        line += f"  |  Lifestyle vs prior: {vs:+.1f}%"
    pdf.cell(0, 6, _safe(line), new_x="LMARGIN", new_y="NEXT")

    _section(pdf, "This month vs prior")
    pulse = [
        ("Lifestyle", float(previous.get("lifestyle_spend") or 0), float(current.get("lifestyle_spend") or 0)),
        ("Credited", float(previous.get("total_credit") or 0), float(current.get("total_credit") or 0)),
        ("Debited", float(previous.get("total_debit") or 0), float(current.get("total_debit") or 0)),
        (
            "Cards",
            float(previous.get("credit_card_spend") or 0),
            float(current.get("credit_card_spend") or 0),
        ),
    ]
    _paired_bars(pdf, pulse)

    _section(pdf, "Leakages (Rs up vs prior)")
    leak_rows: list[tuple[str, float]] = []
    for row in review.get("leakages") or []:
        name = str(row.get("name") or "Leak")
        try:
            amt = float(row.get("change_inr") or row.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        if amt > 0:
            leak_rows.append((name, amt))
    _hbar_chart(pdf, leak_rows, bar_rgb=(180, 35, 24))

    _section(pdf, "Big spends")
    big_rows = [
        (str(r.get("name") or "Merchant"), float(r.get("amount") or 0))
        for r in (review.get("big_spends") or [])
    ]
    if not big_rows:
        big_rows = [
            (str(r.get("name") or "Merchant"), float(r.get("amount") or 0))
            for r in (current.get("top_merchants") or [])
        ]
    _hbar_chart(pdf, big_rows, bar_rgb=(180, 90, 30))

    _section(pdf, "Category moves")
    cat_pairs = [
        (
            str(c.get("name") or "Category"),
            float(c.get("previous") or 0),
            float(c.get("current") or 0),
        )
        for c in (stats.get("category_changes") or [])[:6]
    ]
    _paired_bars(pdf, cat_pairs)

    _section(pdf, "Spend mix")
    cats = [
        (str(c.get("name") or "Category"), float(c.get("debit") or 0))
        for c in (current.get("categories") or [])
    ]
    if not cats:
        cats = [
            (str(c.get("name") or "Category"), float(c.get("current") or 0))
            for c in (stats.get("category_changes") or [])
        ]
    cats.sort(key=lambda x: -x[1])
    _hbar_chart(pdf, cats[:8], bar_rgb=(26, 95, 138))

    _section(pdf, "Month-end pulse")
    for row in review.get("checklist") or []:
        status = str(row.get("status") or "ok").upper()[:6]
        title = str(row.get("title") or "")
        # Tiny status "bar": filled block count by severity
        fill = 3 if status == "ACTION" else (2 if status == "WATCH" else 1)
        y = pdf.get_y()
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(40, 40, 40)
        pdf.cell(18, 6, status, align="L")
        colors = {
            "ACTION": (180, 35, 24),
            "WATCH": (37, 99, 235),
            "OK": (26, 127, 75),
        }
        rgb = colors.get(status, (120, 120, 120))
        pdf.set_fill_color(*rgb)
        for i in range(3):
            if i < fill:
                pdf.rect(pdf.l_margin + 20 + i * 6, y + 1.5, 5, 3, style="F")
            else:
                pdf.set_draw_color(200, 200, 200)
                pdf.rect(pdf.l_margin + 20 + i * 6, y + 1.5, 5, 3, style="D")
        pdf.set_xy(pdf.l_margin + 42, y)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, _safe(title), new_x="LMARGIN", new_y="NEXT")

    _section(pdf, "Rs you can free")
    impact_rows: list[tuple[str, float]] = []
    for s in narrative.get("suggestions") or []:
        if not isinstance(s, dict):
            continue
        try:
            impact = float(s.get("inr_impact") or 0)
        except (TypeError, ValueError):
            impact = 0.0
        if impact <= 0:
            continue
        impact_rows.append((str(s.get("text") or "Action")[:32], impact))
    if not impact_rows:
        for s in review.get("recommendations") or []:
            try:
                impact = float(s.get("inr_impact") or 0)
            except (TypeError, ValueError):
                impact = 0.0
            if impact <= 0:
                continue
            impact_rows.append((str(s.get("text") or "Action")[:32], impact))
    _hbar_chart(pdf, impact_rows, bar_rgb=(26, 127, 75))

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(
        0,
        4,
        _safe(
            "Charts use computed transaction totals. "
            "Open the in-app report for interactive views."
        ),
    )

    out = BytesIO()
    pdf.output(out)
    return out.getvalue()
