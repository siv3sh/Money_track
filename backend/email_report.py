"""HTML monthly report email + Resend delivery."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

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


def _bar(pct: float, color: str) -> str:
    width = max(0, min(100, abs(pct)))
    return (
        f'<div style="background:#e8e6e1;border-radius:4px;height:8px;width:100%;max-width:220px;">'
        f'<div style="background:{color};height:8px;border-radius:4px;width:{width}%;"></div></div>'
    )


def render_report_html(report: dict[str, Any]) -> str:
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

    lifestyle_delta = headline.get("vs_prior_lifestyle_pct")
    delta_color = debit if (lifestyle_delta or 0) > 0 else credit
    savings = headline.get("savings_rate_pct")

    going_well = "".join(
        f'<li style="margin:0 0 8px;color:{text};">{item}</li>'
        for item in (narrative.get("going_well") or [])
    ) or f'<li style="color:{muted};">Not enough history for highlights yet.</li>'

    suggestions = ""
    for s in narrative.get("suggestions") or []:
        text_s = s.get("text") if isinstance(s, dict) else str(s)
        impact = s.get("inr_impact") if isinstance(s, dict) else None
        extra = f' <span style="color:{credit};font-weight:600;">(~{_fmt_inr(impact)})</span>' if impact else ""
        suggestions += f'<li style="margin:0 0 10px;color:{text};">{text_s}{extra}</li>'
    if not suggestions:
        suggestions = f'<li style="color:{muted};">No specific suggestions this month.</li>'

    tax_block = ""
    tax_notes = narrative.get("tax_notes") or []
    tax_flags = stats.get("tax_flags") or []
    if tax_notes or tax_flags:
        items = tax_notes or [f.get("message") for f in tax_flags]
        lis = "".join(f'<li style="margin:0 0 8px;">{t}</li>' for t in items if t)
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
        <tr><td style="padding:0 0 8px;color:{text};font-size:15px;line-height:1.55;">{market}</td></tr>
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
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:{muted};">Money Track</p>
          <h1 style="margin:8px 0 4px;font-size:28px;font-weight:normal;">{label}</h1>
          <p style="margin:0 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:{muted};">
            Savings rate <strong style="color:{text};">{savings if savings is not None else "—"}%</strong>
            &nbsp;·&nbsp; Lifestyle vs prior
            <strong style="color:{delta_color};">{_pct(lifestyle_delta)}</strong>
          </p>
        </td></tr>

        <tr><td style="padding:0 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Summary</h2>
        </td></tr>
        <tr><td style="padding:0 0 20px;font-size:16px;line-height:1.6;">{narrative.get("summary") or "Report generated."}</td></tr>

        <tr><td style="padding:8px 0 20px;">{kpi_table}</td></tr>

        <tr><td style="padding:16px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">What's going well</h2>
        </td></tr>
        <tr><td style="padding:0 0 12px;"><ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.5;">{going_well}</ul></td></tr>

        <tr><td style="padding:16px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Suggestions</h2>
        </td></tr>
        <tr><td style="padding:0 0 12px;"><ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.5;">{suggestions}</ul></td></tr>

        {market_block}
        {tax_block}

        <tr><td style="padding:24px 0 8px;">
          <h2 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:{muted};">Year to date</h2>
        </td></tr>
        <tr><td style="padding:0 0 24px;font-size:15px;line-height:1.55;">{narrative.get("ytd_snapshot") or "YTD data included in the app report."}</td></tr>

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
) -> dict[str, Any]:
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not configured")
    if not to_email or "@" not in to_email:
        raise RuntimeError("Invalid recipient email")

    label = report.get("label") or report.get("month") or "Monthly report"
    html = render_report_html(report)
    payload = {
        "from": from_email or RESEND_FROM,
        "to": [to_email.strip()],
        "subject": f"Money Track — {label} analysis",
        "html": html,
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
    return {"ok": True, "id": data.get("id"), "to": to_email, "sent_at": datetime.now(timezone.utc).isoformat()}


def email_configured() -> bool:
    return bool(RESEND_API_KEY)
