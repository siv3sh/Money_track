import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import {
  commitIndmoneyFile,
  previewIndmoneyFile,
  validateIndmoneyFile,
  type IndmoneyPreview,
  type IndmoneyValidateResult,
} from '../api'
import { LedgerAmount } from '../components/LedgerAmount'
import { PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'
import { useFilters } from '../context/FilterContext'

type Step = 'upload' | 'map' | 'preview' | 'done'

const STEPS: Step[] = ['upload', 'map', 'preview', 'done']

function StepTicks({ step }: { step: Step }) {
  const currentIdx = STEPS.indexOf(step)
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]">
      {STEPS.map((s, i) => {
        const done = i <= currentIdx
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 ? <span className="mx-0.5 text-[var(--border-strong)]">·</span> : null}
            <span
              className={`inline-flex items-center gap-1 capitalize ${
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
              {s}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function IndmoneyImportPage() {
  const { refresh } = useFilters()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<IndmoneyPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [validation, setValidation] = useState<IndmoneyValidateResult | null>(null)
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const fields = preview?.fields || []

  const onFile = async (f: File | null) => {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      const data = await previewIndmoneyFile(f)
      setPreview(data)
      setFile(f)
      setMapping({ ...data.suggested_mapping })
      setValidation(null)
      setStep('map')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  const runValidate = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const data = await validateIndmoneyFile(file, mapping)
      if (!data.ok && data.error) throw new Error(data.error)
      setValidation(data)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setBusy(false)
    }
  }

  const runCommit = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const data = await commitIndmoneyFile(file, mapping)
      setResult({ inserted: data.import.inserted, updated: data.import.updated })
      setStep('done')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const headerOptions = useMemo(() => preview?.headers || [], [preview])

  return (
    <div className="fade-in max-w-4xl">
      <PageHeader
        title="Import from INDmoney"
        description="Upload a CSV/Excel portfolio export, map columns, preview, then upsert into your portfolio."
        actions={
          <Link to="/wealth" className="btn">
            <ArrowLeft size={14} />
            Back to Wealth
          </Link>
        }
      />

      <StepTicks step={step} />

      {error ? (
        <div className="mb-4 border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {step === 'upload' ? (
        <section className="elev-sheet p-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--sapphire)]">
            <FileSpreadsheet size={20} />
          </div>
          <h2 className="text-base font-semibold">Choose export file</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Accepts CSV or Excel (.xlsx). Export holdings with invested + current value columns.
          </p>
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
              void onFile(e.dataTransfer.files?.[0] || null)
            }}
          >
            <Upload size={18} className="text-[var(--muted)]" />
            <span className="font-medium">{busy ? 'Reading file…' : 'Drop file or click to browse'}</span>
            <span className="text-xs text-[var(--muted)]">.csv · .xlsx</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </label>
        </section>
      ) : null}

      {step === 'map' && preview ? (
        <section className="elev-sheet overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Column mapping</h2>
            <p className="text-xs text-[var(--muted)]">
              {preview.filename} · {preview.row_count} rows
              {preview.mapping_confidence != null
                ? ` · RAG confidence ${(preview.mapping_confidence * 100).toFixed(0)}%`
                : ' · auto-mapped where possible'}
              {preview.needs_mapping_ui === false
                ? ' · high confidence (still editable)'
                : ' · please confirm mapping'}
            </p>
            {preview.pipeline_stages?.length ? (
              <PipelineTicksInline
                stages={preview.pipeline_stages}
                current={preview.pipeline_stage}
              />
            ) : null}
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                {f.label}
                {f.required ? <span className="text-[var(--debit)]"> *</span> : null}
                <select
                  className="field"
                  value={mapping[f.key] || ''}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [f.key]: e.target.value || null,
                    }))
                  }
                >
                  <option value="">— skip —</option>
                  {headerOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="border-t border-[var(--border)] px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Sample rows
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--muted)]">
                    {preview.headers.slice(0, 6).map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample_rows.slice(0, 4).map((row, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      {preview.headers.slice(0, 6).map((h) => (
                        <td key={h} className="max-w-[140px] truncate px-2 py-1.5">
                          {String(row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-3">
            <button type="button" className="btn" onClick={() => setStep('upload')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !mapping.name}
              onClick={() => void runValidate()}
            >
              {busy ? 'Validating…' : 'Validate & preview'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 'preview' && validation ? (
        <section className="elev-sheet overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Confirm import</h2>
            <p className="text-xs text-[var(--muted)]">
              {validation.summary.valid} valid · {validation.summary.errors} errors ·{' '}
              {validation.summary.duplicates_in_file} duplicate keys in file · Existing holdings
              matched by instrument + date will be updated (source=csv_import)
            </p>
          </div>

          <div className="grid gap-3 border-b border-[var(--border)] p-4 sm:grid-cols-3">
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Rows to commit</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-[var(--sapphire)]">
                {validation.summary.valid}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Invested</p>
              <LedgerAmount
                amount={validation.summary.total_invested || 0}
                rail="wealth"
                size="md"
                className="py-1"
              />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-[var(--muted)]">Current</p>
              <LedgerAmount
                amount={validation.summary.total_current || 0}
                rail="credit"
                size="md"
                className="py-1"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-auto">
            <ul className="passbook-list">
              {validation.valid.slice(0, 50).map((r) => (
                <li
                  key={r.instrument_key}
                  className="passbook-row flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 sm:px-4"
                >
                  <div className="flex min-w-0 gap-3">
                    <span className="ledger-rail__bar ledger-rail__bar--credit mt-1 self-stretch" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--credit)]">
                        Commit
                      </p>
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="text-xs text-[var(--muted)]">{r.asset_class}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-mono tabular-nums text-[var(--wealth)]">
                      {formatINR(r.invested)}
                    </p>
                    <p className="font-mono tabular-nums text-[var(--credit)]">
                      {formatINR(r.current_value)}
                    </p>
                    <p className="text-[var(--muted)]">{r.as_of_date || 'latest'}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {validation.errors.length ? (
            <div className="border-t border-[var(--border)]">
              <ul className="passbook-list">
                {validation.errors.slice(0, 5).map((e) => (
                  <li
                    key={`${e.row}-${e.issue}`}
                    className="passbook-row flex gap-3 px-4 py-2.5 text-xs text-[var(--debit)]"
                  >
                    <span className="ledger-rail__bar ledger-rail__bar--debit mt-0.5 self-stretch" aria-hidden />
                    <p>
                      <span className="font-semibold uppercase tracking-wide">Hold · row {e.row}</span>
                      {': '}
                      {e.issue}
                      {e.instrument ? ` (${e.instrument})` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-3">
            <button type="button" className="btn" onClick={() => setStep('map')}>
              Back to mapping
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || validation.summary.valid === 0}
              onClick={() => void runCommit()}
            >
              {busy ? 'Importing…' : `Commit ${validation.summary.valid} holdings`}
            </button>
          </div>
        </section>
      ) : null}

      {step === 'done' && result ? (
        <section className="elev-sheet p-6 text-center">
          <CheckCircle2 className="mx-auto text-[var(--credit)]" size={36} />
          <h2 className="mt-3 text-base font-semibold">Import complete</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Inserted {result.inserted} · updated {result.updated}. Tagged source = csv_import.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/wealth" className="btn btn-primary">
              View wealth
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStep('upload')
                setFile(null)
                setPreview(null)
                setValidation(null)
                setResult(null)
              }}
            >
              Import another file
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function PipelineTicksInline({
  stages,
  current,
}: {
  stages: string[]
  current?: string | null
}) {
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px]">
      {stages.map((s, i) => {
        const done =
          current === 'complete' ||
          (current ? stages.indexOf(s) <= stages.indexOf(current) : false)
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 ? <span className="text-[var(--border-strong)]">·</span> : null}
            <span
              className={`inline-flex items-center gap-0.5 uppercase ${
                done ? 'font-semibold text-[var(--sapphire)]' : 'text-[var(--muted)]'
              }`}
            >
              {done ? <Check size={10} aria-hidden /> : null}
              {s.replaceAll('_', ' ')}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
