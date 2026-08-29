import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  Check,
  Loader2,
  Scale,
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
  aiTally,
  fetchAiStatus,
  fetchTransferSuggestions,
  markSipInvested,
  reviewTransferSuggestion,
  runDisambiguateTransfers,
  saveDriftBaseline,
  type AiStatus,
  type TallyAi,
  type TallyPack,
  type TransferSuggestion,
} from '../api'
import { FilterBar } from '../components/FilterBar'
import { LearnAboutMePanel } from '../components/LearnAboutMePanel'
import { AdvisorVoiceBanner } from '../components/AdvisorVoiceBanner'
import { AdvisorCommentBubble } from '../components/AdvisorCommentBubble'
import { ChartCard, PageHeader } from '../components/ui'
import { useFilters } from '../context/FilterContext'
import { formatINR, formatDate } from '../lib/format'

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
  const [tally, setTally] = useState<TallyPack | null>(null)
  const [tallyAi, setTallyAi] = useState<TallyAi | null>(null)
  const [sipComment, setSipComment] = useState<string | null>(null)

  const smart = data?.smart
  const sipRows = smart?.sip?.sips || []
  const drift = smart?.drift
  const flaggedSips = sipRows.filter((s) => !['ok', 'marked'].includes(s.status))
  const advisorAlerts = (data?.alerts || []).filter((a) => a.advisor_message)
  const advisorSeverity = data?.advisor_severity

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

  const runTally = async () => {
    setBusy('tally')
    setError(null)
    try {
      const res = await aiTally({ ...rangeOpts, use_llm: true })
      setTally(res.tally)
      setTallyAi(res.ai)
      setProvider(res.provider || res.ai?.provider || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tally failed')
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

      {data?.advisor ? <AdvisorVoiceBanner advisor={data.advisor} /> : null}

      <div className="mb-5">
        <LearnAboutMePanel dateFrom={dateFrom || undefined} dateTo={dateTo || undefined} />
      </div>

      <ChartCard
        title="Does this make sense?"
        subtitle="AI sense-check — does income, spend, investments, and big debits fit a coherent story?"
        className="mb-5"
        action={
          <button type="button" className="btn text-xs" disabled={!!busy} onClick={() => void runTally()}>
            {busy === 'tally' ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
            Sense-check
          </button>
        }
      >
        {!tally ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            Run a sense-check to see if your money story feels right — not a bookkeeping reconcile.
          </p>
        ) : (
          <div className="space-y-4">
            {(() => {
              const verdict = String(tallyAi?.verdict || tally.status)
              const good = verdict === 'makes_sense' || verdict === 'tallies'
              const bad = verdict === 'odd' || verdict === 'gaps'
              return (
            <div
              className={`rounded-xl border px-4 py-3 ${
                good
                  ? 'border-[var(--credit)]/35 bg-[var(--credit-soft)]'
                  : bad
                    ? 'border-[var(--debit)]/35 bg-[var(--debit-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)]'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {good ? 'Makes sense' : bad ? "Something's off" : 'Mostly makes sense'}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">
                {tallyAi?.headline || 'Sense-check complete'}
              </p>
              {tallyAi?.summary ? (
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
                  {tallyAi.summary}
                </p>
              ) : null}
            </div>
              )
            })()}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">In</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--credit)]">
                  {formatINR(tally.overview.total_credit)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Out</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--debit)]">
                  {formatINR(tally.overview.total_debit)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Lifestyle share</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text)]">
                  {tally.identity.lifestyle_to_credit_pct != null
                    ? `${tally.identity.lifestyle_to_credit_pct}%`
                    : '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">of credits</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Peak spend day</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--debit)]">
                  {tally.peak_spend_day ? formatINR(tally.peak_spend_day.amount) : '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  {tally.peak_spend_day?.date
                    ? formatDate(tally.peak_spend_day.date + 'T00:00:00')
                    : 'No peak yet'}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="text-[var(--muted)]">Lifestyle</span>
                <p className="mt-0.5 font-medium tabular-nums">{formatINR(tally.identity.lifestyle_debit)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="text-[var(--muted)]">Investments</span>
                <p className="mt-0.5 font-medium tabular-nums">{formatINR(tally.identity.investments_debit)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="text-[var(--muted)]">Transfers</span>
                <p className="mt-0.5 font-medium tabular-nums">{formatINR(tally.identity.transfers_debit)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="text-[var(--muted)]">Other</span>
                <p className="mt-0.5 font-medium tabular-nums">{formatINR(tally.identity.other_debit)}</p>
              </div>
            </div>

            {tallyAi?.checks?.length ? (
              <ul className="space-y-2">
                {tallyAi.checks.map((c, i) => (
                  <li
                    key={`${c.label}-${i}`}
                    className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                  >
                    {c.ok ? (
                      <Check size={14} className="mt-0.5 shrink-0 text-[var(--credit)]" />
                    ) : (
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />
                    )}
                    <div>
                      <p className="font-medium">{c.label}</p>
                      {c.detail ? <p className="mt-0.5 text-xs text-[var(--muted)]">{c.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {tallyAi?.actions?.length ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Next steps
                </p>
                <ol className="list-decimal space-y-1 pl-4 text-sm text-[var(--text)]">
                  {tallyAi.actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {(tally.sense_flags || tally.issues).length ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  What stood out
                </p>
                <ul className="space-y-1.5">
                  {(tally.sense_flags || tally.issues).map((issue) => (
                    <li key={issue.code} className="text-xs text-[var(--muted)]">
                      <strong className="text-[var(--text)]">{issue.title}</strong> — {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {tally.largest_debits?.length ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Biggest debits
                </p>
                <ul className="space-y-1.5 text-xs">
                  {tally.largest_debits.slice(0, 5).map((d, i) => (
                    <li
                      key={`${d.merchant}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border)] pt-1.5 first:border-0 first:pt-0"
                    >
                      <span>
                        <span className="font-medium text-[var(--text)]">{d.merchant}</span>
                        <span className="text-[var(--muted)]">
                          {' '}
                          · {d.category}
                          {d.date ? ` · ${formatDate(d.date + 'T00:00:00')}` : ''}
                        </span>
                      </span>
                      <span className="tabular-nums text-[var(--debit)]">{formatINR(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {tally.by_bank.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-xs">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="pb-2 font-medium">Bank</th>
                      <th className="pb-2 font-medium">Out</th>
                      <th className="pb-2 font-medium">In</th>
                      <th className="pb-2 font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tally.by_bank.map((b) => (
                      <tr key={b.name} className="border-t border-[var(--border)]">
                        <td className="py-2">{b.name}</td>
                        <td className="py-2 tabular-nums text-[var(--debit)]">{formatINR(b.debit)}</td>
                        <td className="py-2 tabular-nums text-[var(--credit)]">{formatINR(b.credit)}</td>
                        <td className="py-2 tabular-nums">{formatINR(b.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </ChartCard>

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
                        {(() => {
                          const note = advisorAlerts.find(
                            (a) =>
                              String(a.title || '')
                                .toLowerCase()
                                .includes(String(s.name || '').toLowerCase()) ||
                              String(a.message || '')
                                .toLowerCase()
                                .includes(String(s.name || '').toLowerCase()),
                          )
                          return note?.advisor_message ? (
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text)]">
                              <span className="font-medium uppercase tracking-wide text-[var(--muted)]">
                                {note.advisor_severity || 'advisor'} ·{' '}
                              </span>
                              {note.advisor_message}
                            </p>
                          ) : null
                        })()}
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
                            const res = await markSipInvested(s.name, s.current_month)
                            setSipComment(res.advisor_comment?.comment || null)
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
                  {sipComment && busy !== `sip-${s.name}` ? (
                    <AdvisorCommentBubble comment={sipComment} />
                  ) : null}
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

      {advisorAlerts.length > 0 ? (
        <ChartCard
          title="Advisor alerts"
          subtitle={
            advisorSeverity?.level
              ? `Tone: ${advisorSeverity.level} · grounded in your real thresholds`
              : 'Tone matched to rule history — not LLM guesswork'
          }
          className="mb-5"
        >
          <ul className="space-y-3">
            {advisorAlerts.slice(0, 12).map((a, i) => (
              <li
                key={`${a.type}-${a.title}-${i}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {a.advisor_severity || a.severity} · {a.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{a.advisor_message || a.message}</p>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

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
                {data?.advisor?.level ? (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Advisor · {data.advisor.level}
                  </p>
                ) : null}
                {answer}
              </div>
            ) : null}
          </div>
        </ChartCard>

        <div className="grid gap-4">
          <ChartCard title="Actions" subtitle="Summary, anomalies, categorize, tally">
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
              <button type="button" className="btn" disabled={!!busy} onClick={() => void runTally()}>
                {busy === 'tally' ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                Does this make sense?
              </button>
            </div>
            {catResult ? <p className="mt-3 text-xs text-[var(--muted)]">{catResult}</p> : null}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly briefing" subtitle="Same trained advisor voice as the Advisor page">
          {summary ? (
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              {data?.advisor?.preferred_name ? (
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  Advisor · {data.advisor.preferred_name}
                  {data.advisor.level ? ` · ${data.advisor.level}` : ''}
                </p>
              ) : null}
              {summary}
            </div>
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
