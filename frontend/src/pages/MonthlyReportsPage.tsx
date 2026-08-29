import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FileDown, FileText, Loader2, Mail, RefreshCw, Settings2 } from 'lucide-react'
import {
  downloadMonthlyReportPdf,
  fetchMonthlyReport,
  fetchMonthlyReports,
  generateMonthlyReport,
  saveMonthlyReportSettings,
  type MonthlyReport,
  type MonthlyReportListItem,
  type MonthlyReportSettings,
} from '../api'
import { DeltaBars, DonutChart, GroupedComparisonBars, HorizontalBars } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

function normalizeNarrative(n: MonthlyReport['narrative']): MonthlyReport['narrative'] {
  const summary = n?.summary || ''
  if (summary.trim().startsWith('{') && summary.includes('"going_well"')) {
    try {
      const parsed = JSON.parse(summary) as MonthlyReport['narrative']
      return {
        ...n,
        summary: parsed.summary || summary,
        going_well: parsed.going_well?.length ? parsed.going_well : n.going_well,
        suggestions: parsed.suggestions?.length ? parsed.suggestions : n.suggestions,
        market_context: parsed.market_context ?? n.market_context,
        tax_notes: parsed.tax_notes?.length ? parsed.tax_notes : n.tax_notes,
        ytd_snapshot: parsed.ytd_snapshot || n.ytd_snapshot,
      }
    } catch {
      /* keep original */
    }
  }
  return n
}

function ReportDetail({
  report,
  onBack,
  onDownloadPdf,
  pdfBusy,
}: {
  report: MonthlyReport
  onBack?: () => void
  onDownloadPdf?: () => void
  pdfBusy?: boolean
}) {
  const n = normalizeNarrative(report.narrative)
  const s = report.stats
  const h = s.headline_metric
  const review = s.month_end_review

  const categoryBars = useMemo(() => {
    const cats = (s.current?.categories || [])
      .filter((c) => (c.debit || 0) > 0)
      .map((c) => ({ name: c.name, value: c.debit }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
    if (cats.length) return cats
    return (s.category_changes || [])
      .filter((c) => (c.current || 0) > 0)
      .map((c) => ({ name: c.name, value: c.current }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [s])

  const merchantBars = useMemo(() => {
    return (s.current?.top_merchants || [])
      .filter((m) => (m.amount || 0) > 0)
      .map((m) => ({ name: m.name, value: m.amount }))
      .slice(0, 8)
  }, [s])

  const leakageBars = useMemo(() => {
    return (review?.leakages || [])
      .filter((l) => (l.change_inr != null && l.change_inr > 0) || (l.amount != null && l.amount > 0))
      .map((l) => ({
        name: (l.name || 'Item').slice(0, 22),
        value: Number(l.change_inr != null && l.change_inr > 0 ? l.change_inr : l.amount) || 0,
      }))
      .slice(0, 8)
  }, [review])

  const bigSpendBars = useMemo(() => {
    return (review?.big_spends || [])
      .map((m) => ({ name: m.name.slice(0, 22), value: m.amount }))
      .slice(0, 8)
  }, [review])

  const priorVsNow = useMemo(() => {
    return (s.category_changes || [])
      .slice(0, 6)
      .map((c) => ({
        name: c.name.slice(0, 18),
        template: c.previous,
        actual: c.current,
      }))
  }, [s])

  const categoryDeltas = useMemo(() => {
    return (s.category_changes || [])
      .slice(0, 8)
      .map((c) => ({
        name: c.name.slice(0, 18),
        delta: c.change_inr,
        prior: c.previous,
        current: c.current,
      }))
      .filter((c) => c.delta !== 0)
  }, [s])

  const leakageDeltas = useMemo(() => {
    return (review?.leakages || [])
      .map((l) => {
        const delta =
          l.change_inr != null && l.change_inr !== 0
            ? Number(l.change_inr)
            : Number(l.amount) || 0
        return {
          name: (l.name || 'Item').slice(0, 18),
          delta,
          prior: undefined as number | undefined,
          current: l.amount != null ? Number(l.amount) : undefined,
        }
      })
      .filter((r) => r.delta !== 0)
      .slice(0, 8)
  }, [review])

  const impactBars = useMemo(() => {
    const fromNarrative = (n.suggestions || [])
      .filter((x) => x.inr_impact != null && Number(x.inr_impact) > 0)
      .map((x) => ({
        name: (x.text || 'Action').slice(0, 28),
        value: Number(x.inr_impact) || 0,
      }))
    if (fromNarrative.length) return fromNarrative.slice(0, 6)
    return (review?.recommendations || [])
      .filter((x) => x.inr_impact != null && Number(x.inr_impact) > 0)
      .map((x) => ({
        name: (x.text || 'Action').slice(0, 28),
        value: Number(x.inr_impact) || 0,
      }))
      .slice(0, 6)
  }, [n.suggestions, review])

  const ytdDonut = useMemo(() => {
    const lifestyle = Number(s.ytd?.lifestyle_spend) || 0
    const credit = Number(s.ytd?.total_credit) || 0
    const invested = Number(s.ytd?.investments_debit) || 0
    const saved = Math.max(credit - lifestyle, 0)
    const rows = [
      { name: 'Lifestyle', value: lifestyle },
      { name: 'Invested', value: invested },
      { name: 'Other kept', value: Math.max(saved - invested, 0) },
    ].filter((r) => r.value > 0)
    return rows
  }, [s.ytd])

  const monthPulse = useMemo(() => {
    const cur = s.current as Record<string, unknown>
    const prev = s.previous as Record<string, unknown>
    const keys: Array<{ key: string; label: string }> = [
      { key: 'lifestyle_spend', label: 'Lifestyle' },
      { key: 'total_credit', label: 'Credited' },
      { key: 'total_debit', label: 'Debited' },
      { key: 'credit_card_spend', label: 'Cards' },
    ]
    return keys
      .map(({ key, label }) => ({
        name: label,
        template: Number(prev?.[key]) || 0,
        actual: Number(cur?.[key]) || 0,
      }))
      .filter((r) => r.template > 0 || r.actual > 0)
  }, [s])

  const checklist = review?.checklist || []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack ? (
          <button type="button" className="btn text-xs" onClick={onBack}>
            ← All reports
          </button>
        ) : (
          <span />
        )}
        {onDownloadPdf ? (
          <button
            type="button"
            className="btn text-xs"
            disabled={pdfBusy}
            onClick={onDownloadPdf}
          >
            {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            Download PDF
          </button>
        ) : null}
      </div>

      <div className="mb-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Savings rate"
          value={h.savings_rate_pct != null ? `${h.savings_rate_pct}%` : '—'}
          tone={h.savings_rate_pct != null && h.savings_rate_pct >= 20 ? 'credit' : 'neutral'}
        />
        <KpiCard
          label="Lifestyle spend"
          value={formatINR(h.lifestyle_spend)}
          tone="debit"
          hint={
            h.vs_prior_lifestyle_pct != null
              ? `${h.vs_prior_lifestyle_pct > 0 ? '+' : ''}${h.vs_prior_lifestyle_pct}% vs prior`
              : undefined
          }
        />
        <KpiCard
          label="Net worth (period)"
          value={formatINR(h.net_worth_estimate)}
        />
        <KpiCard
          label="YTD invested"
          value={formatINR(s.ytd.investments_debit)}
          tone="credit"
        />
      </div>

      {monthPulse.length ? (
        <ChartCard title="This month vs prior" subtitle="Column compare — labels show ₹">
          <GroupedComparisonBars data={monthPulse} orientation="vertical" />
        </ChartCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Leakages" subtitle="Red = up vs prior · zero line = no change">
          {leakageDeltas.length ? (
            <DeltaBars data={leakageDeltas} />
          ) : leakageBars.length ? (
            <HorizontalBars data={leakageBars} showLabels toneByRank />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No material leakages vs prior
              {!review ? ' — regenerate to refresh charts' : ''}.
            </p>
          )}
        </ChartCard>
        <ChartCard title="Big spends" subtitle="Largest merchants — bar length = ₹">
          {bigSpendBars.length ? (
            <HorizontalBars data={bigSpendBars} showLabels toneByRank />
          ) : merchantBars.length ? (
            <HorizontalBars data={merchantBars} showLabels toneByRank />
          ) : (
            <p className="text-sm text-[var(--muted)]">No merchant spend chart yet.</p>
          )}
        </ChartCard>
      </div>

      {categoryDeltas.length ? (
        <ChartCard title="Category Δ" subtitle="Spend change vs prior (red up · green down)">
          <DeltaBars data={categoryDeltas} />
        </ChartCard>
      ) : priorVsNow.length ? (
        <ChartCard title="Category moves" subtitle="Prior vs this month by category">
          <GroupedComparisonBars data={priorVsNow} />
        </ChartCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Spend mix" subtitle="Lifestyle categories this month">
          <HorizontalBars data={categoryBars} showLabels toneByRank />
        </ChartCard>
        <ChartCard title="YTD split" subtitle="Where credited money went">
          {ytdDonut.length ? (
            <DonutChart data={ytdDonut} />
          ) : (
            <p className="text-sm text-[var(--muted)]">Not enough YTD totals for a chart.</p>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Month-end pulse" subtitle="Status at a glance">
        {checklist.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {checklist.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
              >
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    item.status === 'action'
                      ? 'bg-[var(--debit)]'
                      : item.status === 'watch'
                        ? 'bg-[var(--accent)]'
                        : 'bg-[var(--credit)]'
                  }`}
                  title={item.status}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text)]">{item.title}</p>
                  {item.detail ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">{item.detail}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Regenerate this report to load the month-end pulse chart.
          </p>
        )}
      </ChartCard>

      <ChartCard title="₹ you can free" subtitle="Larger bar = more upside if you act">
        {impactBars.length ? (
          <HorizontalBars data={impactBars} color="var(--credit)" showLabels toneByRank />
        ) : (
          <p className="text-sm text-[var(--muted)]">No ₹-impact actions quantified this month.</p>
        )}
      </ChartCard>

      {(n.summary || (n.going_well || []).length > 0) && (
        <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--muted)]">
            Advisor note (optional read)
          </summary>
          {n.summary ? (
            <p className="mt-3 text-sm leading-relaxed text-[var(--text)]">{n.summary}</p>
          ) : null}
          {(n.going_well || []).length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--text)]">
              {(n.going_well || []).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {n.market_context ? (
            <p className="mt-3 text-sm text-[var(--muted)]">{n.market_context}</p>
          ) : null}
          {(n.tax_notes || []).length || (s.tax_flags || []).length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
              {(n.tax_notes || []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
              {!n.tax_notes?.length
                ? (s.tax_flags || []).map((t, i) => <li key={i}>{t.message}</li>)
                : null}
            </ul>
          ) : null}
        </details>
      )}

      <p className="text-[11px] text-[var(--muted)]">
        Generated {report.generated_at ? new Date(report.generated_at).toLocaleString('en-IN') : '—'}
        {n.provider ? ` · ${n.provider}` : ''}
        {report.emailed_at
          ? ` · emailed ${new Date(report.emailed_at).toLocaleString('en-IN')}`
          : ''}
        {!s.history_ok ? ' · limited prior-month history' : ''}
      </p>
    </div>
  )
}

export function MonthlyReportsPage() {
  const { month: monthParam } = useParams()
  const navigate = useNavigate()
  const [list, setList] = useState<MonthlyReportListItem[]>([])
  const [settings, setSettings] = useState<MonthlyReportSettings | null>(null)
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const loadList = useCallback(async () => {
    const res = await fetchMonthlyReports()
    setList(res.reports)
    setSettings(res.settings)
    setEmailDraft(res.settings.recipient_email || '')
    setEmailEnabled(res.settings.email_enabled)
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        await loadList()
        if (monthParam) {
          const r = await fetchMonthlyReport(monthParam)
          setReport(r)
        } else {
          setReport(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reports')
      } finally {
        setLoading(false)
      }
    })()
  }, [monthParam, loadList])

  const runGenerate = async (opts: { send_email?: boolean; force?: boolean } = {}) => {
    setBusy(true)
    setError(null)
    try {
      const res = await generateMonthlyReport({
        force: opts.force ?? true,
        send_email: opts.send_email ?? false,
        ...(monthParam
          ? {
              year: Number(monthParam.slice(0, 4)),
              month: Number(monthParam.slice(5, 7)),
            }
          : {}),
      })
      setReport(res.report)
      await loadList()
      if (res.email && !res.email.ok) {
        setError(`Report saved, but email failed: ${res.email.reason || 'unknown'}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed')
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await saveMonthlyReportSettings({
        email_enabled: emailEnabled,
        recipient_email: emailDraft.trim(),
      })
      setSettings(next)
      setShowSettings(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!report?.month) return
    setPdfBusy(true)
    setError(null)
    try {
      await downloadMonthlyReportPdf(report.month)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF download failed')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Monthly reports"
        description="Chart-first month-end review — leakages, big spends, and ₹ impact. Words are optional. Email includes the same charts + PDF."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 size={14} />
              Email settings
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runGenerate({ force: true, send_email: false })}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Generate report
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runGenerate({ force: true, send_email: true })}
            >
              <Mail size={14} />
              Generate & email
            </button>
          </div>
        }
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {showSettings ? (
        <ChartCard title="Monthly email" subtitle="Sent on the 1st for the prior month" className="mb-5">
          <div className="flex flex-col gap-3 sm:max-w-md">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
              />
              Enable monthly email
            </label>
            <input
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              type="email"
              placeholder="you@example.com"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
            />
            <p className="text-xs text-[var(--muted)]">
              Email via Resend{settings?.email_configured ? ' (configured)' : ' — set RESEND_API_KEY on the server'}.
              Generate & email attaches a PDF of the month-end review.
            </p>
            <button type="button" className="btn self-start" disabled={busy} onClick={() => void saveSettings()}>
              Save
            </button>
          </div>
        </ChartCard>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : report ? (
        <ReportDetail
          report={report}
          pdfBusy={pdfBusy}
          onDownloadPdf={() => void handleDownloadPdf()}
          onBack={() => {
            setReport(null)
            if (monthParam) navigate('/monthly-reports')
          }}
        />
      ) : (
        <ChartCard title="Past reports" subtitle="Tap a month to open">
          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              No reports yet — generate one for last month.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {list.map((r) => (
                <li key={r.month}>
                  <Link
                    to={`/monthly-reports/${r.month}`}
                    className="flex items-start justify-between gap-3 py-3 hover:opacity-90"
                  >
                    <div className="flex items-start gap-2">
                      <FileText size={16} className="mt-0.5 text-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-medium">{r.label || r.month}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {r.summary_preview || 'Open report'}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {r.headline?.savings_rate_pct != null
                        ? `${r.headline.savings_rate_pct}% saved`
                        : r.month}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      )}
    </div>
  )
}
