import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { uploadStatementFile } from '../api'
import { PageHeader } from '../components/ui'

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

  const saveFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setOk(null)
    setErr(null)
    try {
      const result = await uploadStatementFile(file, bank)
      if (result.imported === 0) {
        setErr(
          result.parsed === 0
            ? 'No transactions found in that file'
            : `Nothing new (${result.skipped_duplicates} already imported)`,
        )
      } else {
        setOk(
          `Imported ${result.imported} of ${result.parsed} rows` +
            (result.skipped_duplicates
              ? ` · skipped ${result.skipped_duplicates} duplicates`
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
        description="Upload bank statements (CSV, Excel, PDF) to backfill history alongside live SMS."
      />

      <section className="panel max-w-xl p-5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileUp size={22} />
        </div>
        <h2 className="text-base font-semibold">Statement upload</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick the bank, then drop a file. Duplicates are skipped automatically.
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
    </div>
  )
}
