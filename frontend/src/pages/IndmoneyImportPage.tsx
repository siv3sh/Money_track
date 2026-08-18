import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import {
  commitIndmoneyFile,
  previewIndmoneyFile,
  validateIndmoneyFile,
  type IndmoneyPreview,
  type IndmoneyValidateResult,
} from '../api'
import { PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'
import { useFilters } from '../context/FilterContext'

type Step = 'upload' | 'map' | 'preview' | 'done'

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
      // High-confidence RAG mapping can still be edited — UI always available as fallback
      setStep('map')
      if (data.mapping_confidence != null && data.mapping_confidence >= 0.62) {
        setError(null)
      }
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

      <ol className="mb-5 flex flex-wrap gap-2 text-xs font-medium">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 capitalize ${
              step === s
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--muted)]'
            }`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {step === 'upload' ? (
        <section className="panel p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <FileSpreadsheet size={22} />
          </div>
          <h2 className="text-base font-semibold">Choose export file</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Accepts CSV or Excel (.xlsx). From INDmoney, export holdings with invested + current
            value columns.
          </p>
          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-10 text-sm hover:bg-[var(--surface-3)]">
            <Upload size={20} className="text-[var(--muted)]" />
            <span className="font-medium">{busy ? 'Reading file…' : 'Drop file or click to browse'}</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </label>
        </section>
      ) : null}

      {step === 'map' && preview ? (
        <section className="panel overflow-hidden">
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
              <ol className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold uppercase">
                {preview.pipeline_stages.map((s) => {
                  const stages = preview.pipeline_stages || []
                  const cur = preview.pipeline_stage || ''
                  const active =
                    s === cur || (cur ? stages.indexOf(s) <= stages.indexOf(cur) : false)
                  return (
                    <li
                      key={s}
                      className={
                        active
                          ? 'rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]'
                          : 'rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--muted)]'
                      }
                    >
                      {s.replaceAll('_', ' ')}
                    </li>
                  )
                })}
              </ol>
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
        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Confirm import</h2>
            <p className="text-xs text-[var(--muted)]">
              {validation.summary.valid} valid · {validation.summary.errors} errors ·{' '}
              {validation.summary.duplicates_in_file} duplicate keys in file · Existing holdings
              matched by instrument + date will be updated (source=csv_import)
            </p>
          </div>

          <div className="grid gap-3 border-b border-[var(--border)] p-4 sm:grid-cols-3">
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase text-[var(--muted)]">Rows</p>
              <p className="text-lg font-semibold">{validation.summary.valid}</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase text-[var(--muted)]">Invested</p>
              <p className="text-lg font-semibold">
                {formatINR(validation.summary.total_invested || 0)}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase text-[var(--muted)]">Current</p>
              <p className="text-lg font-semibold text-[var(--credit)]">
                {formatINR(validation.summary.total_current || 0)}
              </p>
            </div>
          </div>

          <div className="max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface)] text-[10px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Instrument</th>
                  <th className="px-3 py-2 text-left font-medium">Class</th>
                  <th className="px-3 py-2 text-right font-medium">Invested</th>
                  <th className="px-3 py-2 text-right font-medium">Current</th>
                  <th className="px-3 py-2 text-right font-medium">As of</th>
                </tr>
              </thead>
              <tbody>
                {validation.valid.slice(0, 50).map((r) => (
                  <tr key={r.instrument_key} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{r.asset_class}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.invested)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--credit)]">
                      {formatINR(r.current_value)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--muted)]">
                      {r.as_of_date || 'latest'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {validation.errors.length ? (
            <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--debit)]">
              {validation.errors.slice(0, 5).map((e) => (
                <p key={`${e.row}-${e.issue}`}>
                  Row {e.row}: {e.issue}
                  {e.instrument ? ` (${e.instrument})` : ''}
                </p>
              ))}
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
        <section className="panel p-6 text-center">
          <CheckCircle2 className="mx-auto text-[var(--credit)]" size={36} />
          <h2 className="mt-3 text-base font-semibold">Import complete</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Inserted {result.inserted} · updated {result.updated}. Tagged source =
            csv_import.
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
