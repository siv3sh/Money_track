import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  Check,
  Loader2,
  Sparkles,
  Tags,
  Wand2,
  X,
} from 'lucide-react'
import {
  aiAnomalies,
  aiAsk,
  aiCategorize,
  aiMonthlySummary,
  fetchAiStatus,
  fetchTransferSuggestions,
  markSipInvested,
  reviewTransferSuggestion,
  runDisambiguateTransfers,
  saveDriftBaseline,
  type AiStatus,
  type TransferSuggestion,
} from '../api'
import { FilterBar } from '../components/FilterBar'
import { ChartCard, PageHeader } from '../components/ui'
import { useFilters } from '../context/FilterContext'
import { formatINR } from '../lib/format'

const SUGGESTIONS = [
  'How much did I spend on Food & Dining last period?',
  'How is my SIP / investment portfolio performing?',
  'What is my savings rate and where should I cut?',
  'Which merchants dominate my spending?',
]

export function AiInsightsPage() {
  const { dateFrom, dateTo, refresh, data } = useFilters()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [insights, setInsights] = useState<string[]>([])
  const [catResult, setCatResult] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transferQueue, setTransferQueue] = useState<TransferSuggestion[]>([])

  const smart = data?.smart
  const sipRows = smart?.sip?.sips || []
  const drift = smart?.drift
  const flaggedSips = sipRows.filter((s) => !['ok', 'marked'].includes(s.status))

  useEffect(() => {
    void fetchAiStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
    void fetchTransferSuggestions()
      .then((r) => setTransferQueue(r.suggestions))
      .catch(() => setTransferQueue([]))
  }, [])

  const rangeOpts = {
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }

  const runAsk = async (q?: string) => {
    const text = (q || question).trim()
    if (!text) return
    setBusy('ask')
    setError(null)
    try {
      const res = await aiAsk(text, rangeOpts)
      setAnswer(res.answer)
      setProvider(res.provider)
      setQuestion(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setBusy(null)
    }
  }

  const runSummary = async () => {
    setBusy('summary')
    setError(null)
    try {
      const res = await aiMonthlySummary(rangeOpts)
      setSummary(res.summary)
      setProvider(res.provider)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Summary failed')
    } finally {
      setBusy(null)
    }
  }

  const runAnomalies = async () => {
    setBusy('anomalies')
    setError(null)
    try {
      const res = await aiAnomalies(rangeOpts)
      setInsights(res.insights)
      setProvider(res.provider)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anomaly explain failed')
    } finally {
      setBusy(null)
    }
  }

  const runCategorize = async () => {
    setBusy('categorize')
    setError(null)
    try {
      const res = await aiCategorize({ limit: 40, use_llm: true })
      setCatResult(
        `Scanned ${res.scanned} · updated ${res.updated} (memory ${res.memory_applied ?? 0}, LLM ${res.llm_applied}) · ${res.remaining_other} still Other` +
          (res.llm_error ? ` · LLM note: ${res.llm_error}` : ''),
      )
      if (res.updated) refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Categorize failed')
    } finally {
      setBusy(null)
    }
  }

  const runDisambiguate = async () => {
    setBusy('disambiguate')
    setError(null)
    try {
      const res = await runDisambiguateTransfers({ limit: 25 })
      setProvider(res.provider)
      const pending = await fetchTransferSuggestions()
      setTransferQueue(pending.suggestions)
      setCatResult(
        `Transfer review: scanned ${res.scanned}, queued ${res.stored} suggestion(s)`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disambiguation failed')
    } finally {
      setBusy(null)
    }
  }

  const onReview = async (id: string, action: 'approve' | 'reject') => {
    try {
      await reviewTransferSuggestion(id, action)
      setTransferQueue((prev) => prev.filter((s) => s.id !== id))
      if (action === 'approve') refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    }
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="AI Insights"
        description="Ask questions, track SIPs, spot allocation drift, and review ambiguous transfers — local Ollama first, Gemini as fallback."
        actions={
          <Link to="/monthly-reports" className="btn">
            <Sparkles size={14} />
            Monthly reports
          </Link>
        }
      />
      <FilterBar showBanks={false} />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--muted)]">
          Provider:{' '}
          <strong className="text-[var(--text)]">
            {status?.active || status?.configured || 'checking…'}
          </strong>
        </span>
        {provider ? (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--muted)]">
            Last used: <strong className="text-[var(--text)]">{provider}</strong>
          </span>
        ) : null}
        {status?.ollama ? (
          <span
            className={`rounded-full border px-2.5 py-1 ${
              status.ollama.available
                ? 'border-[var(--credit)]/40 text-[var(--credit)]'
                : 'border-[var(--border)] text-[var(--muted)]'
            }`}
          >
            Ollama {status.ollama.available ? 'ready' : 'offline'}
          </span>
        ) : null}
        {status?.gemini ? (
          <span
            className={`rounded-full border px-2.5 py-1 ${
              status.gemini.available
                ? 'border-[var(--credit)]/40 text-[var(--credit)]'
                : 'border-[var(--border)] text-[var(--muted)]'
            }`}
          >
            Gemini {status.gemini.available ? 'ready' : 'offline'}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="SIP consistency"
          subtitle={
            smart?.sip
              ? `${smart.sip.flagged} flag(s) · ${smart.sip.current_month}`
              : 'Inferred from investment debits'
          }
        >
          {flaggedSips.length === 0 && sipRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Need 2+ monthly investment entries per instrument to track SIPs
            </p>
          ) : flaggedSips.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--credit)]">
              All tracked SIPs look on schedule
            </p>
          ) : (
            <ul className="space-y-3">
              {flaggedSips.map((s) => (
                <li
                  key={s.name}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        size={14}
                        className={
                          s.status === 'stopped'
                            ? 'mt-0.5 text-[var(--debit)]'
                            : 'mt-0.5 text-[var(--warning)]'
                        }
                      />
                      <div>
                        <p className="text-sm font-medium">
                          SIP: {s.name}
                          {s.status === 'missing'
                            ? ` — expected on day ${s.typical_day}, not yet detected`
                            : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{s.message}</p>
                      </div>
                    </div>
                    {s.status === 'missing' || s.status === 'stopped' ? (
                      <button
                        type="button"
                        className="btn shrink-0 text-xs"
                        disabled={busy === `sip-${s.name}`}
                        onClick={async () => {
                          setBusy(`sip-${s.name}`)
                          try {
                            await markSipInvested(s.name, s.current_month)
                            refresh()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Mark failed')
                          } finally {
                            setBusy(null)
                          }
                        }}
                      >
                        Mark invested
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sipRows.filter((s) => s.status === 'ok' || s.status === 'marked').length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--muted)]">
                Show on-track SIPs (
                {sipRows.filter((s) => s.status === 'ok' || s.status === 'marked').length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                {sipRows
                  .filter((s) => s.status === 'ok' || s.status === 'marked')
                  .map((s) => (
                    <li key={s.name}>
                      {s.name} · {formatINR(s.typical_amount)} · day {s.typical_day}
                      {s.marked_invested ? ' · marked' : ''}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </ChartCard>

        <ChartCard
          title="Portfolio drift"
          subtitle={
            drift
              ? `vs ${drift.reference_source} · ±${drift.threshold_pp} pp`
              : 'Current vs baseline allocation'
          }
        >
          {!drift || drift.current.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Add portfolio holdings to compare allocation
            </p>
          ) : (
            <>
              {(drift.drifts || []).length === 0 ? (
                <p className="mb-3 text-sm text-[var(--credit)]">Within your drift threshold</p>
              ) : (
                <ul className="mb-3 space-y-2">
                  {drift.drifts.map((d) => (
                    <li
                      key={d.asset_class}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                    >
                      <strong>{d.asset_class}</strong> is {d.current_pct}%,{' '}
                      {d.direction === 'up' ? 'up' : 'down'} from your typical {d.reference_pct}% —
                      consider rebalancing
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="mb-1 font-medium text-[var(--muted)]">Current</p>
                  {drift.current.map((c) => (
                    <div key={c.name} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate">{c.name}</span>
                      <span className="tabular-nums">{c.pct}%</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-1 font-medium text-[var(--muted)]">
                    {drift.reference_source === 'target' ? 'Target' : 'Baseline'}
                  </p>
                  {(drift.reference.length ? drift.reference : drift.current).map((c) => (
                    <div key={c.name} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate">{c.name}</span>
                      <span className="tabular-nums">{c.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn mt-3 text-xs"
                onClick={async () => {
                  setBusy('baseline')
                  try {
                    await saveDriftBaseline(drift.threshold_pp)
                    refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Baseline save failed')
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                Save current as baseline
              </button>
            </>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Transfer vs spend review"
        subtitle="Approve self-transfers to exclude them from lifestyle spend"
        className="mb-5"
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void runDisambiguate()}
          >
            {busy === 'disambiguate' ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            Scan ambiguous transfers
          </button>
        </div>
        {transferQueue.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            No pending suggestions — run a scan when Other/UPI debits look like self-transfers
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {transferQueue.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {s.merchant || 'Unknown'} · {formatINR(s.amount)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Suggests{' '}
                    <strong className="text-[var(--text)]">
                      {s.label === 'self_transfer' ? 'self-transfer' : 'actual spend'}
                    </strong>
                    {s.suggested_category ? ` → ${s.suggested_category}` : ''}
                    {s.reason ? ` · ${s.reason}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn text-xs"
                    onClick={() => void onReview(s.id, 'approve')}
                  >
                    <Check size={12} />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn text-xs"
                    onClick={() => void onReview(s.id, 'reject')}
                  >
                    <X size={12} />
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Ask your data" subtitle="Grounded in analytics aggregates">
          <div className="flex flex-col gap-3">
            <textarea
              className="min-h-[88px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Am I overspending on food this month?"
            />
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
                  onClick={() => void runAsk(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <button type="button" className="btn self-start" disabled={!!busy} onClick={() => void runAsk()}>
              {busy === 'ask' ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
              Ask
            </button>
            {answer ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                {answer}
              </div>
            ) : null}
          </div>
        </ChartCard>

        <div className="grid gap-4">
          <ChartCard title="Actions" subtitle="Summary, anomalies, categorize">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={!!busy} onClick={() => void runSummary()}>
                {busy === 'summary' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Monthly briefing
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => void runAnomalies()}>
                {busy === 'anomalies' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                Explain anomalies
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => void runCategorize()}>
                {busy === 'categorize' ? <Loader2 size={14} className="animate-spin" /> : <Tags size={14} />}
                Auto-categorize Other
              </button>
            </div>
            {catResult ? <p className="mt-3 text-xs text-[var(--muted)]">{catResult}</p> : null}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly briefing" subtitle="Spend changes, savings, tips">
          {summary ? (
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</div>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Generate a briefing for the selected date range
            </p>
          )}
        </ChartCard>
        <ChartCard title="Anomaly notes" subtitle="Plain-language flags">
          {insights.length ? (
            <ul className="space-y-2">
              {insights.map((line, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Run “Explain anomalies” to turn alerts into readable notes
            </p>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
