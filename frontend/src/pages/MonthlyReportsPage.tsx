import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FileText, Loader2, Mail, RefreshCw, Settings2 } from 'lucide-react'
import {
  fetchMonthlyReport,
  fetchMonthlyReports,
  generateMonthlyReport,
  saveMonthlyReportSettings,
  type MonthlyReport,
  type MonthlyReportListItem,
  type MonthlyReportSettings,
} from '../api'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

function ReportDetail({
  report,
  onBack,
}: {
  report: MonthlyReport
  onBack?: () => void
}) {
  const n = report.narrative
  const s = report.stats
  const h = s.headline_metric

  return (
    <div className="space-y-5">
      {onBack ? (
        <button type="button" className="btn text-xs" onClick={onBack}>
          ← All reports
        </button>
      ) : null}

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

      <ChartCard title="Summary" subtitle={report.label}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.summary}</p>
        {!s.history_ok ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Limited history — prior-month comparison may be incomplete.
          </p>
        ) : null}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="What's going well">
          <ul className="space-y-2">
            {(n.going_well || []).map((item, i) => (
              <li
                key={i}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
              >
                {item}
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard title="Suggestions">
          <ul className="space-y-2">
            {(n.suggestions || []).map((item, i) => (
              <li
                key={i}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
              >
                {item.text}
                {item.inr_impact != null ? (
                  <span className="ml-1 text-[var(--credit)]">
                    (~{formatINR(item.inr_impact)})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      {n.market_context ? (
        <ChartCard title="Market context" subtitle="Tied to your holdings">
          <p className="text-sm leading-relaxed">{n.market_context}</p>
          {(s.news.headlines || []).length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
              {s.news.headlines.map((hline, i) => (
                <li key={i}>• {hline.title}</li>
              ))}
            </ul>
          ) : null}
        </ChartCard>
      ) : null}

      {(n.tax_notes || []).length > 0 || (s.tax_flags || []).length > 0 ? (
        <ChartCard title="Tax notes" subtitle="Only when thresholds are near">
          <ul className="space-y-2 text-sm">
            {(n.tax_notes || []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {!n.tax_notes?.length
              ? (s.tax_flags || []).map((t, i) => (
                  <li key={i}>{t.message}</li>
                ))
              : null}
          </ul>
        </ChartCard>
      ) : null}

      <ChartCard title="Year to date">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.ytd_snapshot}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs text-[var(--muted)]">
          <div>
            YTD lifestyle{' '}
            <strong className="text-[var(--text)]">{formatINR(s.ytd.lifestyle_spend)}</strong>
          </div>
          <div>
            YTD credited{' '}
            <strong className="text-[var(--text)]">{formatINR(s.ytd.total_credit)}</strong>
          </div>
          <div>
            YTD savings rate{' '}
            <strong className="text-[var(--text)]">
              {s.ytd.savings_rate_pct != null ? `${s.ytd.savings_rate_pct}%` : '—'}
            </strong>
          </div>
        </div>
      </ChartCard>

      {(s.category_changes || []).length > 0 ? (
        <ChartCard title="Category moves" subtitle="Largest ₹ changes vs prior month">
          <ul className="divide-y divide-[var(--border)] text-sm">
            {s.category_changes.slice(0, 6).map((c) => (
              <li key={c.name} className="flex justify-between gap-3 py-2">
                <span>{c.name}</span>
                <span
                  className={
                    c.change_inr > 0 ? 'text-[var(--debit)]' : 'text-[var(--credit)]'
                  }
                >
                  {c.change_inr > 0 ? '+' : ''}
                  {formatINR(c.change_inr)} ({c.change_pct > 0 ? '+' : ''}
                  {c.change_pct}%)
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

      <p className="text-[11px] text-[var(--muted)]">
        Generated {report.generated_at ? new Date(report.generated_at).toLocaleString('en-IN') : '—'}
        {n.provider ? ` · ${n.provider}` : ''}
        {report.emailed_at
          ? ` · emailed ${new Date(report.emailed_at).toLocaleString('en-IN')}`
          : ''}
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

  return (
    <div className="fade-in">
      <PageHeader
        title="Monthly reports"
        description="AI analysis of the prior month — computed numbers first, LLM narration second. Optional email on the 1st."
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
