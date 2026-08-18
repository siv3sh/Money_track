import { useState } from 'react'
import { FileUp, Sparkles, Bot } from 'lucide-react'
import { uploadStatementFile, type StatementImportResult } from '../api'
import { PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

export function ImportPage() {
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<StatementImportResult | null>(null)

  const saveFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setOk(null)
    setErr(null)
    setResult(null)
    try {
      const res = await uploadStatementFile(file)
      setResult(res)
      const detected = res.detected
      const bankLabel = detected?.bank
        ? `${detected.bank}${detected.is_credit_card_statement ? ' credit card' : ''}`
        : 'auto'
      const ragNote =
        res.agent?.rag_categorized && res.agent.rag_categorized > 0
          ? ` · RAG categorized ${res.agent.rag_categorized}`
          : ''
      if (res.imported === 0) {
        setErr(
          res.parsed === 0
            ? 'No transactions found in that file'
            : `Nothing new imported · exact dups ${res.skipped_duplicates}` +
                (res.skipped_likely_duplicates
                  ? ` · cross-source likely dups ${res.skipped_likely_duplicates}`
                  : ''),
        )
      } else {
        setOk(
          `Detected ${bankLabel} · imported ${res.imported} of ${res.parsed} rows` +
            (res.skipped_duplicates ? ` · skipped ${res.skipped_duplicates} exact duplicates` : '') +
            (res.skipped_likely_duplicates
              ? ` · skipped ${res.skipped_likely_duplicates} likely SMS duplicates`
              : '') +
            ragNote,
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const analysis = result?.analysis
  const agent = result?.agent

  return (
    <div className="fade-in">
      <PageHeader
        title="Import"
        description="LangGraph multi-agent import: extract → map columns → categorize (RAG) → validate → review. High-confidence rows commit automatically; unclear rows go to Learn About Me."
      />

      <section className="panel max-w-xl p-5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileUp size={22} />
        </div>
        <h2 className="text-base font-semibold">Statement upload</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          PDF (OCR fallback), multi-sheet Excel, and CSV. Cross-source dedup against SMS + past
          imports. RAG vectors live in MongoDB (`document_formats`, `merchant_knowledge`).
        </p>

        {(result?.pipeline_stages || result?.agent?.stages) && (
          <ol className="mt-4 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
            {(result.pipeline_stages || result.agent?.stages || []).map((stage) => {
              const current = result.pipeline_stage || result.agent?.stage
              const done =
                current === 'complete' ||
                (result.pipeline_stages || result.agent?.stages || []).indexOf(stage) <=
                  (result.pipeline_stages || result.agent?.stages || []).indexOf(current || '')
              return (
                <li
                  key={stage}
                  className={
                    done
                      ? 'rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]'
                      : 'rounded-md bg-[var(--surface-2)] px-2 py-1 text-[var(--muted)]'
                  }
                >
                  {stage.replaceAll('_', ' ')}
                </li>
              )
            })}
          </ol>
        )}

        <label className="mt-5 flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
          File
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
            className="field"
            disabled={busy}
            onChange={(e) => void saveFile(e.target.files?.[0] || null)}
          />
        </label>

        {busy ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
            <Sparkles size={14} className="animate-pulse" />
            Extracting → Mapping → Categorizing → Validating → Review…
          </p>
        ) : null}
        {ok ? (
          <p className="mt-4 rounded-xl bg-[var(--credit-soft)] px-3 py-2 text-sm text-[var(--credit)]">
            {ok}
          </p>
        ) : null}
        {err ? (
          <p className="mt-4 rounded-xl bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]">
            {err}
          </p>
        ) : null}
      </section>

      {agent?.steps?.length ? (
        <section className="panel mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bot size={14} className="text-[var(--accent)]" />
              Import agent · {agent.protocol || 'langgraph-import/v1'}
            </h3>
            <p className="text-xs text-[var(--muted)]">
              {agent.vector_backend ? `store ${agent.vector_backend} · ` : ''}
              RAG hits {agent.rag_categorized ?? agent.rag_hits ?? 0}
              {agent.review_queue_count
                ? ` · ${agent.review_queue_count} held for review`
                : ''}
            </p>
          </div>
          <ol className="divide-y divide-[var(--border)] text-sm">
            {agent.steps.map((step, i) => (
              <li key={`${step.tool}-${i}`} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={
                    step.status === 'ok'
                      ? 'mt-0.5 rounded bg-[var(--credit-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--credit)]'
                      : step.status === 'warn' || step.status === 'error'
                        ? 'mt-0.5 rounded bg-[var(--debit-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--debit)]'
                        : 'mt-0.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]'
                  }
                >
                  {step.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.tool}</p>
                  <p className="text-xs text-[var(--muted)]">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {agent.warnings?.length ? (
            <ul className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--debit)]">
              {agent.warnings.map((w) => (
                <li key={w}>· {w}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {result?.review_queue?.length ? (
        <section className="panel mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">Held for review</h3>
            <p className="text-xs text-[var(--muted)]">
              Low-confidence or flagged rows — answer them in AI Insights → Learn About Me
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {result.review_queue.map((r, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium">{r.merchant || 'Unknown'}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {r.reason || 'needs review'}
                    {r.category ? ` · suggested ${r.category}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-[var(--muted)]">
                  <p className="font-medium tabular-nums text-[var(--text)]">
                    {formatINR(Number(r.amount) || 0)} · {r.type}
                  </p>
                  {r.confidence != null ? <p>conf {(Number(r.confidence) * 100).toFixed(0)}%</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result?.detected ? (
        <section className="panel mt-5 max-w-xl px-4 py-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Detected
          </p>
          <p className="mt-1 font-medium">
            {result.detected.bank}
            {result.detected.is_credit_card_statement ? ' · Credit card' : ' · Bank account'}
            {result.detected.confidence ? (
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                confidence {result.detected.confidence}
              </span>
            ) : null}
          </p>
        </section>
      ) : null}

      {analysis ? (
        <section className="panel mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={14} className="text-[var(--accent)]" />
              Import analysis
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Auto-categorized with RAG + investment/credit-card cues
              {analysis.ai_note ? ` · ${analysis.ai_note}` : ''}
            </p>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)]">Debits</p>
              <p className="text-lg font-semibold tabular-nums text-[var(--debit)]">
                {formatINR(analysis.debit_total)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)]">Credits</p>
              <p className="text-lg font-semibold tabular-nums text-[var(--credit)]">
                {formatINR(analysis.credit_total)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)]">Investments</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatINR(analysis.investment_debit)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)]">Credit card</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatINR(analysis.credit_card_spend)}
              </p>
            </div>
          </div>
          {analysis.highlights?.length ? (
            <ul className="space-y-1 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
              {analysis.highlights.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          ) : null}
          {analysis.by_category?.length ? (
            <div className="border-t border-[var(--border)] px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase text-[var(--muted)]">
                Categories
              </p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {analysis.by_category.map((c) => (
                  <li
                    key={c.category}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1"
                  >
                    {c.category} · {c.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {result?.likely_duplicates?.length ? (
        <section className="panel mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">Likely cross-source duplicates (skipped)</h3>
            <p className="text-xs text-[var(--muted)]">
              Same amount, date, type, and similar merchant as an existing SMS/statement row
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {result.likely_duplicates.map((d, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium">{d.incoming_merchant}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Matched {d.matched_existing_merchant || 'existing'} · source{' '}
                    {d.matched_existing_source || 'unknown'}
                  </p>
                </div>
                <div className="text-right text-xs text-[var(--muted)]">
                  <p className="font-medium tabular-nums text-[var(--text)]">
                    {formatINR(Number(d.amount) || 0)} · {d.type}
                  </p>
                  <p>{d.received_at ? String(d.received_at).slice(0, 10) : '—'}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
