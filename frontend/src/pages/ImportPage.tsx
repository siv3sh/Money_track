import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { uploadStatementFile, type StatementImportResult } from '../api'
import { PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

const BANKS = [
  'HDFC Bank',
  'SBI',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Bank',
  'IDFC First Bank',
  'Yes Bank',
  'Federal Bank',
]

export function ImportPage() {
  const [bank, setBank] = useState('HDFC Bank')
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
      const res = await uploadStatementFile(file, bank)
      setResult(res)
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
          `Imported ${res.imported} of ${res.parsed} rows` +
            (res.skipped_duplicates ? ` · skipped ${res.skipped_duplicates} exact duplicates` : '') +
            (res.skipped_likely_duplicates
              ? ` · skipped ${res.skipped_likely_duplicates} likely SMS duplicates`
              : ''),
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Import"
        description="Upload bank statements (CSV, Excel, PDF). Exact and cross-source SMS duplicates are skipped so Cash Flow is not double-counted."
      />

      <section className="panel max-w-xl p-5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileUp size={22} />
        </div>
        <h2 className="text-base font-semibold">Statement upload</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick the bank, then drop a file. Matches on amount + date + similar merchant against
          existing SMS rows are flagged below.
        </p>

        <label className="mt-5 flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
          Bank
          <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}>
            {BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
          File
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
            className="field"
            disabled={busy}
            onChange={(e) => void saveFile(e.target.files?.[0] || null)}
          />
        </label>

        {busy ? <p className="mt-4 text-sm text-[var(--muted)]">Importing…</p> : null}
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
