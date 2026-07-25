import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, Loader2, Sparkles, Tags, Wand2 } from 'lucide-react'
import {
  aiAnomalies,
  aiAsk,
  aiCategorize,
  aiMonthlySummary,
  fetchAiStatus,
  type AiStatus,
} from '../api'
import { FilterBar } from '../components/FilterBar'
import { ChartCard, PageHeader } from '../components/ui'
import { useFilters } from '../context/FilterContext'

const SUGGESTIONS = [
  'How much did I spend on Food & Dining last period?',
  'How is my SIP / investment portfolio performing?',
  'What is my savings rate and where should I cut?',
  'Which merchants dominate my spending?',
]

export function AiInsightsPage() {
  const { dateFrom, dateTo, refresh } = useFilters()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [insights, setInsights] = useState<string[]>([])
  const [catResult, setCatResult] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchAiStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
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
        `Scanned ${res.scanned} · updated ${res.updated} (LLM ${res.llm_applied}) · ${res.remaining_other} still Other` +
          (res.llm_error ? ` · LLM note: ${res.llm_error}` : ''),
      )
      if (res.updated) refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Categorize failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="AI Insights"
        description="Ask questions, generate a monthly briefing, explain anomalies, and auto-categorize — local Ollama first, Gemini free tier as fallback."
      />
      <FilterBar showBanks={false} />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--muted)]">
          Provider:{' '}
          <strong className="text-[var(--text)]">
            {status?.active || status?.configured || 'checking…'}
          </strong>
        </span>
        {status ? (
          <>
            <span
              className={`rounded-full px-2.5 py-1 ${
                status.ollama.available
                  ? 'bg-[var(--credit-soft)] text-[var(--credit)]'
                  : 'bg-[var(--surface-2)] text-[var(--muted)]'
              }`}
            >
              Ollama {status.ollama.available ? 'online' : 'offline'} · {status.ollama.model}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 ${
                status.gemini.available
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'bg-[var(--surface-2)] text-[var(--muted)]'
              }`}
            >
              Gemini {status.gemini.key_configured ? 'key set' : 'no key'}
            </span>
          </>
        ) : null}
        {provider ? (
          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]">
            Last reply via {provider}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Ask your money"
          subtitle="Natural-language Q&A on aggregated totals"
          className="xl:col-span-2"
          action={<Bot size={14} className="text-[var(--muted)]" />}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                onClick={() => void runAsk(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="field flex-1"
              placeholder="e.g. How much did I spend on food last month?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runAsk()
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy || !question.trim()}
              onClick={() => void runAsk()}
            >
              {busy === 'ask' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              Ask
            </button>
          </div>
          {answer ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
              {answer}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Answers use category totals, trends, and portfolio aggregates — not raw SMS text.
            </p>
          )}
        </ChartCard>

        <ChartCard title="Quick actions" subtitle="One-click AI jobs">
          <div className="space-y-2">
            <button
              type="button"
              className="btn w-full justify-start"
              disabled={!!busy}
              onClick={() => void runSummary()}
            >
              {busy === 'summary' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Monthly summary
            </button>
            <button
              type="button"
              className="btn w-full justify-start"
              disabled={!!busy}
              onClick={() => void runAnomalies()}
            >
              {busy === 'anomalies' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <AlertTriangle size={14} />
              )}
              Explain anomalies
            </button>
            <button
              type="button"
              className="btn w-full justify-start"
              disabled={!!busy}
              onClick={() => void runCategorize()}
            >
              {busy === 'categorize' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Tags size={14} />
              )}
              Auto-categorize Other
            </button>
          </div>
          {catResult ? (
            <p className="mt-3 text-xs text-[var(--muted)]">{catResult}</p>
          ) : null}
        </ChartCard>
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
