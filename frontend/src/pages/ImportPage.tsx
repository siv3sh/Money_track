import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Eye, EyeOff, FileUp, FileSpreadsheet, Lock, Sparkles, Bot } from 'lucide-react'
import {
  PdfPasswordNeededError,
  uploadStatementFile,
  type StatementImportResult,
} from '../api'
import { LedgerAmount } from '../components/LedgerAmount'
import { PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

function PipelineTicks({
  stages,
  current,
}: {
  stages: string[]
  current?: string | null
}) {
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]">
      {stages.map((stage, i) => {
        const done =
          current === 'complete' ||
          (current
            ? stages.indexOf(stage) <= stages.indexOf(current)
            : false)
        return (
          <li key={stage} className="flex items-center gap-1">
            {i > 0 ? <span className="mx-0.5 text-[var(--border-strong)]">·</span> : null}
            <span
              className={`inline-flex items-center gap-1 ${
                done ? 'font-semibold text-[var(--sapphire)]' : 'text-[var(--muted)]'
              }`}
            >
              {done ? (
                <Check size={12} className="shrink-0 text-[var(--sapphire)]" aria-hidden />
              ) : (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-strong)]"
                  aria-hidden
                />
              )}
              {stage.replaceAll('_', ' ')}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ImportPage() {
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<StatementImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [needPassword, setNeedPassword] = useState(false)
  const [pdfPassword, setPdfPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  const applyResult = (res: StatementImportResult) => {
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
  }

  const saveFile = async (file: File | null, password?: string) => {
    if (!file) return
    setBusy(true)
    setOk(null)
    setErr(null)
    setResult(null)
    try {
      const res = await uploadStatementFile(file, undefined, 'auto', password)
      setPendingFile(null)
      setNeedPassword(false)
      setPdfPassword('')
      applyResult(res)
    } catch (e) {
      if (e instanceof PdfPasswordNeededError) {
        setPendingFile(file)
        setNeedPassword(true)
        setErr(null)
        requestAnimationFrame(() => passwordInputRef.current?.focus())
        return
      }
      setErr(e instanceof Error && e.message.trim() ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const unlockAndImport = (e: FormEvent) => {
    e.preventDefault()
    if (!pendingFile) return
    const pwd = pdfPassword.trim()
    if (!pwd) {
      setErr('Enter the PDF password to unlock this statement')
      return
    }
    void saveFile(pendingFile, pwd)
  }

  const analysis = result?.analysis
  const agent = result?.agent
  const stages = result?.pipeline_stages || result?.agent?.stages || []
  const currentStage = result?.pipeline_stage || result?.agent?.stage

  return (
    <div className="fade-in">
      <PageHeader
        title="Import"
        description="Extract → map → categorize → validate → review. High-confidence rows commit; unclear rows hold for Learn About Me."
        actions={
          <Link to="/investments/indmoney" className="btn">
            <FileSpreadsheet size={14} />
            INDmoney portfolio
          </Link>
        }
      />

      <section className="elev-sheet max-w-xl p-5">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--sapphire)]">
          <FileUp size={20} />
        </div>
        <h2 className="text-base font-semibold">Statement upload</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          PDF, Excel, or CSV. Cross-source dedup against SMS + past imports.
        </p>

        {stages.length ? (
          <PipelineTicks stages={stages} current={currentStage} />
        ) : null}

        {needPassword && pendingFile ? (
          <form
            className="mt-5 rounded-xl border border-[var(--sapphire)]/30 bg-[var(--accent-soft)]/40 p-4"
            onSubmit={unlockAndImport}
          >
            <div className="mb-3 flex items-start gap-2">
              <Lock size={16} className="mt-0.5 shrink-0 text-[var(--sapphire)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">Password required</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  <span className="font-medium text-[var(--text)]">{pendingFile.name}</span> is
                  locked. Enter the statement password, then we unlock it and import the rows.
                  Banks often use DOB (DDMMYYYY), PAN, or last 4–6 digits of account/card. Not
                  stored.
                </p>
              </div>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-[var(--text)]">PDF password</span>
              <div className="relative mt-1.5">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="off"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  disabled={busy}
                  placeholder="Enter password"
                  className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 pr-11 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--text)]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Unlocking…' : 'Unlock & import'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setNeedPassword(false)
                  setPendingFile(null)
                  setPdfPassword('')
                  setErr(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <label
            className={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-10 text-sm transition-colors ${
              dragOver
                ? 'border-[var(--sapphire)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-strong)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void saveFile(e.dataTransfer.files?.[0] || null)
            }}
          >
            <FileUp size={18} className="text-[var(--muted)]" />
            <span className="font-medium text-[var(--text)]">
              {busy ? 'Importing…' : 'Drop statement or click to browse'}
            </span>
            <span className="text-xs text-[var(--muted)]">.pdf · .xlsx · .csv</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void saveFile(e.target.files?.[0] || null)}
            />
          </label>
        )}

        {busy && !needPassword ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
            <Sparkles size={14} className="animate-pulse" />
            Extracting → Mapping → Categorizing → Validating → Review…
          </p>
        ) : null}
        {ok ? (
          <p className="mt-4 border border-[var(--credit)]/20 bg-[var(--credit-soft)] px-3 py-2 text-sm text-[var(--credit)]">
            {ok}
          </p>
        ) : null}
        {err ? (
          <p className="mt-4 border border-[var(--debit)]/20 bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]">
            {err}
          </p>
        ) : null}
      </section>

      {agent?.steps?.length ? (
        <section className="elev-sheet mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bot size={14} className="text-[var(--sapphire)]" />
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
            {agent.steps.map((step, i) => {
              const okStep = step.status === 'ok'
              const bad = step.status === 'warn' || step.status === 'error'
              return (
                <li key={`${step.tool}-${i}`} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      okStep
                        ? 'bg-[var(--credit-soft)] text-[var(--credit)]'
                        : bad
                          ? 'bg-[var(--debit-soft)] text-[var(--debit)]'
                          : 'bg-[var(--surface-3)] text-[var(--muted)]'
                    }`}
                    aria-hidden
                  >
                    {okStep ? <Check size={12} /> : <span className="text-[9px] font-bold">{i + 1}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{step.tool}</p>
                    <p className="text-xs text-[var(--muted)]">{step.detail}</p>
                  </div>
                </li>
              )
            })}
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
        <section className="elev-sheet mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">Held for review</h3>
            <p className="text-xs text-[var(--muted)]">
              Debit plaque bar = hold · resolve in AI Insights → Learn About Me
            </p>
          </div>
          <ul className="passbook-list">
            {result.review_queue.map((r, i) => (
              <li key={i} className="passbook-row flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 gap-3">
                  <span className="ledger-rail__bar ledger-rail__bar--debit mt-1 self-stretch" aria-hidden />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--debit)]">
                      Hold
                    </p>
                    <p className="font-medium">{r.merchant || 'Unknown'}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {r.reason || 'needs review'}
                      {r.category ? ` · suggested ${r.category}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <LedgerAmount
                    amount={Number(r.amount) || 0}
                    rail="debit"
                    size="sm"
                    className="ml-auto justify-end py-1"
                  />
                  <p className="mt-0.5 text-[10px] uppercase text-[var(--muted)]">{r.type}</p>
                  {r.confidence != null ? (
                    <p className="text-[10px] text-[var(--muted)]">
                      conf {(Number(r.confidence) * 100).toFixed(0)}%
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result?.detected ? (
        <section className="elev-sheet mt-5 max-w-xl px-4 py-3 text-sm">
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
        <section className="elev-sheet mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={14} className="text-[var(--sapphire)]" />
              Committed analysis
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Credit plaque bar = committed totals
              {analysis.ai_note ? ` · ${analysis.ai_note}` : ''}
            </p>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Debits</p>
              <LedgerAmount amount={analysis.debit_total} rail="debit" size="md" className="py-1" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Credits</p>
              <LedgerAmount amount={analysis.credit_total} rail="credit" size="md" className="py-1" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Investments</p>
              <LedgerAmount amount={analysis.investment_debit} rail="wealth" size="md" className="py-1" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Credit card</p>
              <LedgerAmount amount={analysis.credit_card_spend} rail="sapphire" size="md" className="py-1" />
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
                    className="border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1"
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
        <section className="elev-sheet mt-5 max-w-3xl overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">Likely cross-source duplicates (skipped)</h3>
            <p className="text-xs text-[var(--muted)]">
              Same amount, date, type, and similar merchant as an existing SMS/statement row
            </p>
          </div>
          <ul className="passbook-list">
            {result.likely_duplicates.map((d, i) => (
              <li key={i} className="passbook-row flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 gap-3">
                  <span className="ledger-rail__bar ledger-rail__bar--credit mt-1 self-stretch" aria-hidden />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--credit)]">
                      Skipped · commit-safe
                    </p>
                    <p className="font-medium">{d.incoming_merchant}</p>
                    <p className="text-xs text-[var(--muted)]">
                      Matched {d.matched_existing_merchant || 'existing'} · source{' '}
                      {d.matched_existing_source || 'unknown'}
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--muted)]">
                  <p className="font-mono font-medium tabular-nums text-[var(--text)]">
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
