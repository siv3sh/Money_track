import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { uploadStatementFile } from '../api'

const BANKS = [
  'HDFC Bank',
  'SBI',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Bank',
  'IDFC First Bank',
  'Yes Bank',
]

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)]'

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
              ? ` · ${result.skipped_duplicates} duplicates skipped`
              : ''),
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 xl:max-w-3xl">
      <section className="panel p-5">
        <h2 className="text-lg font-semibold tracking-tight">Import statement</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload a bank statement file. Supported: CSV, Excel (.xlsx / .xls), PDF.
        </p>

        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-[var(--muted)]">
          <li>Open net banking or your bank app</li>
          <li>Download account statement for the month you want</li>
          <li>Choose bank below and upload the file</li>
        </ol>

        <label className="mt-5 block text-xs text-[var(--muted)]">
          Bank
          <select
            className={`${field} mt-1`}
            value={bank}
            onChange={(e) => setBank(e.target.value)}
          >
            {BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-10 text-sm hover:border-[var(--accent)]">
          <FileUp size={28} className="text-[var(--accent)]" />
          <span className="font-medium text-[var(--text)]">
            {busy ? 'Uploading…' : 'Tap to choose CSV / Excel / PDF'}
          </span>
          <span className="text-xs text-[var(--muted)]">.csv .xlsx .xls .pdf · max ~8MB</span>
          <input
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls,.pdf,text/csv,text/plain,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={busy}
            onChange={(e) => void saveFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {ok ? <p className="mt-4 text-sm text-[var(--credit)]">{ok}</p> : null}
        {err ? <p className="mt-4 text-sm text-[var(--debit)]">{err}</p> : null}
      </section>

      <p className="text-center text-xs text-[var(--muted)]">
        After import, open <strong>Dashboard</strong> or <strong>Reports</strong> to see the data.
      </p>
    </div>
  )
}
