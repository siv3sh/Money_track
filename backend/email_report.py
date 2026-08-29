"""HTML monthly report email + Resend delivery (optional PDF attachment)."""

from __future__ import annotations

import base64
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from report_pdf import render_report_pdf

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_FROM = os.getenv("RESEND_FROM_EMAIL", "Money Track <onboarding@resend.dev>").strip()
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://money-track-rho-six.vercel.app").strip().rstrip("/")


def _fmt_inr(value: Any) -> str:
    try:
        n = float(value or 0)
    except (TypeError, ValueError):
        return "—"
    # Indian-ish grouping via en-IN style approximation
    return f"₹{n:,.0f}"


def _pct(value: Any) -> str:
    if value is None:
        return "—"
    try:
        return f"{float(value):+.1f}%"
    except (TypeError, ValueError):
        return "—"


def _friendly(text: Any) -> str:
    s = str(text or "").strip()
    if not s:
        return ""
    replacements = {
        "The user has ": "You have ",
        "The user is ": "You are ",
        "The user was ": "You were ",
        "The user ": "You ",
        "this user": "you",
        "the user": "you",
        "their ": "your ",
        "Their ": "Your ",
        "they have ": "you have ",
        "They have ": "You have ",
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s


def _bar(pct: float, color: str, *, height: int = 8, max_width: str = "220px") -> str:
    width = max(0, min(100, abs(pct)))
    return (
        f'<div style="background:#e8e6e1;border-radius:4px;height:{height}px;width:100%;'
        f'max-width:{max_width};">'
        f'<div style="background:{color};height:{height}px;border-radius:4px;width:{width}%;"></div></div>'
    )


_CHART_COLORS = (
    "#1a7f4b",
    "#1a5f8a",
    "#b45309",
    "#b42318",
    "#5b6e4e",
    "#6b4f3a",
    "#3d6b6b",
    "#8a6d3b",
)


def _spend_chart_rows(
    rows: list[dict[str, Any]],
    *,
    name_key: str,
    amount_key: str,
    muted: str,
    text: str,
    border: str,
) -> str:
    """Horizontal bar chart rows — works in major email clients (no JS)."""
    cleaned: list[tuple[str, float]] = []
    for r in rows:
        try:
            amt = float(r.get(amount_key) or 0)
        except (TypeError, ValueError):
            continue
        name = str(r.get(name_key) or "").strip()
        if amt <= 0 or not name:
            continue
        cleaned.append((name, amt))
    if not cleaned:
        return f'<p style="margin:0;color:{muted};font-size:14px;">No spend data for this chart.</p>'

    peak = max(a for _, a in cleaned) or 1.0
    total = sum(a for _, a in cleaned) or 1.0
    parts: list[str] = []
    for i, (name, amt) in enumerate(cleaned):
        color = _CHART_COLORS[i % len(_CHART_COLORS)]
        pct_of_peak = amt / peak * 100
        share = amt / total * 100
        safe_name = name[:36] + ("…" if len(name) > 36 else "")
        parts.append(
            f"""
        <tr>
          <td style="padding:8px 12px 8px 0;border-bottom:1px solid {border};width:34%;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:{text};">
            {safe_name}
          </td>
          <td style="padding:8px 0;border-bottom:1px solid {border};width:46%;">
            {_bar(pct_of_peak, color, height=12, max_width="100%")}
          </td>
          <td style="padding:8px 0 8px 12px;border-bottom:1px solid {border};text-align:right;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
              font-variant-numeric:tabular-nums;color:{text};white-space:nowrap;">
            {_fmt_inr(amt)}
            <span style="color:{muted};font-size:11px;"> · {share:.0f}%</span>
          </td>
        </tr>"""
        )
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        + "".join(parts)
        + "</table>"
    )


def render_report_html(report: dict[str, Any], *, advisor_profile: dict[str, Any] | None = None) -> str:
    stats = report.get("stats") or {}
    narrative = report.get("narrative") or {}
    current = stats.get("current") or {}
    previous = stats.get("previous") or {}
    headline = stats.get("headline_metric") or {}
    label = report.get("label") or stats.get("label") or report.get("month")
    month = report.get("month")
    credit = "#1a7f4b"  # green
    debit = "#b42318"  # red
    muted = "#6b6b66"
    text = "#1a1a18"
    border = "#e5e2dc"
    bg = "#f7f5f0"

    profile = advisor_profile or {}
    who = profile.get("preferred_name") or "you"
    motivation = profile.get("motivation")
    severity = (narrative.get("advisor_severity") or {}).get("level") or "informational"
    sev_color = debit if severity in {"concerned", "strict"} else credit
    advisor_from = f"Your Money Advisor · for {who}"
    goal_line = f" · Goal in frame: {motivation}" if motivation else ""
    tone_line = f"Tone: {severity}{goal_line}"

    lifestyle_delta = headline.get("vs_prior_lifestyle_pct")
    delta_color = debit if (lifestyle_delta or 0) > 0 else credit
    savings = headline.get("savings_rate_pct")

    tax_block = ""
    tax_notes = narrative.get("tax_notes") or []
    tax_flags = stats.get("tax_flags") or []
    if tax_notes or tax_flags:
        items = tax_notes or [f.get("message") for f in tax_flags]
        lis = "".join(f'<li style="margin:0 0 8px;">{_friendly(t)}</li>' for t in items if t)
        tax_block = f"""
        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Tax notes</h2>
        </td></tr>
        <tr><td style="padding:0 0 8px;"><ul style="margin:0;padding-left:18px;">{lis}</ul></td></tr>
        """

    market = (narrative.get("market_context") or "").strip()
    market_block = ""
    if market:
        market_block = f"""
        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Market context</h2>
        </td></tr>
        <tr><td style="padding:0 0 8px;color:{text};font-size:15px;line-height:1.55;">{_friendly(market)}</td></tr>
        """

    # KPI comparison rows
    def kpi_row(name: str, cur: Any, prev: Any) -> str:
        try:
            c, p = float(cur or 0), float(prev or 0)
            chg = ((c - p) / p * 100) if p else None
        except (TypeError, ValueError):
            c, p, chg = 0.0, 0.0, None
        color = debit if (chg or 0) > 0 and "spend" in name.lower() else (
            credit if (chg or 0) >= 0 else debit
        )
        if "spend" in name.lower() or "debit" in name.lower():
            color = debit if (chg or 0) > 0 else credit
        elif "credit" in name.lower() or "saving" in name.lower():
            color = credit if (chg or 0) >= 0 else debit
        bar = _bar(min(abs(chg or 0), 100), color) if chg is not None else ""
        return f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid {border};font-size:14px;color:{text};">{name}</td>
          <td style="padding:10px 0;border-bottom:1px solid {border};text-align:right;font-variant-numeric:tabular-nums;">{_fmt_inr(c)}</td>
          <td style="padding:10px 0;border-bottom:1px solid {border};text-align:right;color:{muted};font-size:13px;">{_fmt_inr(p)}</td>
          <td style="padding:10px 0;border-bottom:1px solid {border};text-align:right;color:{color};font-size:13px;">{_pct(chg)}<div style="margin-top:4px;">{bar}</div></td>
        </tr>
        """

    kpi_table = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:0 0 8px;font-size:12px;color:{muted};">Metric</td>
        <td style="padding:0 0 8px;font-size:12px;color:{muted};text-align:right;">This month</td>
        <td style="padding:0 0 8px;font-size:12px;color:{muted};text-align:right;">Prior</td>
        <td style="padding:0 0 8px;font-size:12px;color:{muted};text-align:right;">Change</td>
      </tr>
      {kpi_row("Lifestyle spend", current.get("lifestyle_spend"), previous.get("lifestyle_spend"))}
      {kpi_row("Total credited", current.get("total_credit"), previous.get("total_credit"))}
      {kpi_row("Total debited", current.get("total_debit"), previous.get("total_debit"))}
      {kpi_row("Credit card spend", current.get("credit_card_spend"), previous.get("credit_card_spend"))}
    </table>
    """

    categories = list(current.get("categories") or [])
    # Fallback: derive from category_changes if older reports lack categories
    if not categories:
        categories = [
            {"name": r.get("name"), "debit": r.get("current")}
            for r in (stats.get("category_changes") or [])
            if float(r.get("current") or 0) > 0
        ]
    categories = sorted(categories, key=lambda r: -float(r.get("debit") or 0))[:8]

    top_merchants = list(current.get("top_merchants") or stats.get("top_merchants") or [])
    top_merchants = sorted(top_merchants, key=lambda r: -float(r.get("amount") or 0))[:8]

    category_chart = _spend_chart_rows(
        categories,
        name_key="name",
        amount_key="debit",
        muted=muted,
        text=text,
        border=border,
    )
    merchant_chart = _spend_chart_rows(
        top_merchants,
        name_key="name",
        amount_key="amount",
        muted=muted,
        text=text,
        border=border,
    )

    charts_block = f"""
        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Spend by category</h2>
          <p style="margin:6px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:{muted};">Lifestyle spend this month</p>
        </td></tr>
        <tr><td style="padding:12px 0 8px;">{category_chart}</td></tr>

        <tr><td style="padding:20px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Top spend</h2>
          <p style="margin:6px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:{muted};">Largest merchants / pays</p>
        </td></tr>
        <tr><td style="padding:12px 0 8px;">{merchant_chart}</td></tr>
    """

    review = stats.get("month_end_review") or {}

    leak_chart_rows = [
        {
            "name": r.get("name") or "Leak",
            "amount": float(r.get("change_inr") or r.get("amount") or 0),
        }
        for r in (review.get("leakages") or [])
        if float(r.get("change_inr") or r.get("amount") or 0) > 0
    ]
    big_chart_rows = [
        {"name": r.get("name"), "amount": r.get("amount")}
        for r in (review.get("big_spends") or [])
        if float(r.get("amount") or 0) > 0
    ]
    if not big_chart_rows:
        big_chart_rows = list(top_merchants)

    impact_rows = []
    for s in list(narrative.get("suggestions") or []) or list(review.get("recommendations") or []):
        if not isinstance(s, dict):
            continue
        try:
            impact = float(s.get("inr_impact") or 0)
        except (TypeError, ValueError):
            impact = 0.0
        if impact <= 0:
            continue
        impact_rows.append(
            {
                "name": str(s.get("text") or "Action")[:40],
                "amount": impact,
            }
        )

    leak_chart = _spend_chart_rows(
        leak_chart_rows, name_key="name", amount_key="amount", muted=muted, text=text, border=border
    )
    big_chart = _spend_chart_rows(
        big_chart_rows, name_key="name", amount_key="amount", muted=muted, text=text, border=border
    )
    impact_chart = _spend_chart_rows(
        impact_rows, name_key="name", amount_key="amount", muted=muted, text=text, border=border
    )

    check_bits = []
    for row in review.get("checklist") or []:
        status = str(row.get("status") or "ok")
        color = debit if status == "action" else (credit if status == "ok" else "#1a5f8a")
        title = _friendly(row.get("title") or "")
        check_bits.append(
            f'<tr><td style="padding:6px 0;border-bottom:1px solid {border};">'
            f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;'
            f'background:{color};margin-right:8px;"></span>'
            f'<span style="font-size:14px;color:{text};">{title}</span></td></tr>'
        )
    check_table = (
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        + ("".join(check_bits) or f'<tr><td style="color:{muted};">Pulse unavailable — regenerate in app.</td></tr>')
        + "</table>"
    )

    review_block = f"""
        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Leakages</h2>
          <p style="margin:6px 0 0;font-size:13px;color:{muted};">Rs up vs prior</p>
        </td></tr>
        <tr><td style="padding:12px 0 8px;">{leak_chart}</td></tr>

        <tr><td style="padding:16px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Big spends</h2>
        </td></tr>
        <tr><td style="padding:12px 0 8px;">{big_chart}</td></tr>

        <tr><td style="padding:16px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Month-end pulse</h2>
        </td></tr>
        <tr><td style="padding:8px 0;">{check_table}</td></tr>

        <tr><td style="padding:16px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Rs you can free</h2>
        </td></tr>
        <tr><td style="padding:12px 0 8px;">{impact_chart}</td></tr>
    """

    report_url = f"{APP_BASE_URL}/monthly-reports/{month}" if month else f"{APP_BASE_URL}/monthly-reports"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Money Track — {label}</title></head>
<body style="margin:0;padding:0;background:{bg};font-family:Georgia,'Times New Roman',serif;color:{text};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:{bg};padding:32px 12px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid {border};border-radius:12px;padding:36px 32px;">
        <tr><td>
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:{muted};">{advisor_from}</p>
          <h1 style="margin:8px 0 4px;font-size:28px;font-weight:normal;">{label}</h1>
          <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:{sev_color};">
            {tone_line}
          </p>
          <p style="margin:0 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:{muted};">
            Savings rate <strong style="color:{text};">{savings if savings is not None else "—"}%</strong>
            &nbsp;·&nbsp; Lifestyle vs prior
            <strong style="color:{delta_color};">{_pct(lifestyle_delta)}</strong>
          </p>
        </td></tr>

        <tr><td style="padding:0 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">At a glance</h2>
        </td></tr>
        <tr><td style="padding:0 0 20px;font-size:15px;line-height:1.55;color:{muted};">
          Charts below are the report — open the app for the interactive version.
          {_friendly((narrative.get("summary") or "")[:220])}
        </td></tr>

        <tr><td style="padding:8px 0 20px;">{kpi_table}</td></tr>

        {charts_block}

        {review_block}

        {market_block}
        {tax_block}

        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Year to date</h2>
        </td></tr>
        <tr><td style="padding:0 0 24px;font-size:15px;line-height:1.55;">{_friendly(narrative.get("ytd_snapshot") or "See charts in the app report.")}</td></tr>

        <tr><td style="padding:20px 0 0;border-top:1px solid {border};">
          <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;">
            <a href="{report_url}" style="color:#1a5f8a;text-decoration:none;">View full report in Money Track →</a>
          </p>
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:{muted};">
            Numbers are computed from your transactions. AI only narrates — it does not invent figures.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def send_report_email(
    report: dict[str, Any],
    *,
    to_email: str,
    from_email: str | None = None,
    advisor_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not configured")
    if not to_email or "@" not in to_email:
        raise RuntimeError("Invalid recipient email")

    label = report.get("label") or report.get("month") or "Monthly report"
    who = (advisor_profile or {}).get("preferred_name")
    html = render_report_html(report, advisor_profile=advisor_profile)
    subject = (
        f"Your Money Advisor — {label}" + (f" · {who}" if who else "")
    )
    month_key = report.get("month") or "report"
    pdf_bytes = render_report_pdf(report, advisor_profile=advisor_profile)
    payload: dict[str, Any] = {
        "from": from_email or RESEND_FROM,
        "to": [to_email.strip()],
        "subject": subject,
        "html": html,
        "attachments": [
            {
                "filename": f"money-track-{month_key}.pdf",
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
            }
        ],
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Resend error {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
    return {
        "ok": True,
        "id": data.get("id"),
        "to": to_email,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "pdf_attached": True,
    }


def email_configured() -> bool:
    return bool(RESEND_API_KEY)
