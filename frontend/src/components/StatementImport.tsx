import { useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { importStatementText, uploadStatementFile } from '../api'

interface Props {
  onImported: () => void
}

const BANKS = [
  '',
  'HDFC Bank',
  'SBI',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Bank',
  'IDFC First Bank',
  'Yes Bank',
]

export function StatementImport({ onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [bank, setBank] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePasteImport = async () => {
    if (!text.trim()) {
      setError('Paste CSV or statement lines first')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await importStatementText({
        content: text,
        bank: bank || undefined,
        format: 'auto',
      })
      setMessage(
        `Imported ${result.imported} of ${result.parsed} rows` +
          (result.skipped_duplicates ? ` (${result.skipped_duplicates} duplicates skipped)` : ''),
      )
      setText('')
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await uploadStatementFile(file, bank || undefined)
      setMessage(
        `Imported ${result.imported} of ${result.parsed} rows` +
          (result.skipped_duplicates ? ` (${result.skipped_duplicates} duplicates skipped)` : ''),
      )
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Import statement
          </div>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Add July (or any month) history from a bank CSV / TXT export
          </p>
        </div>
        <Upload size={16} className="text-[var(--muted)]" />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Bank (optional)
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)]"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            >
              <option value="">Auto / unknown</option>
              {BANKS.filter(Boolean).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--muted)] hover:border-[var(--accent)]">
            <FileUp size={20} />
            <span>Upload .csv / .txt / .tsv</span>
            <input
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="hidden"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="text-center text-xs text-[var(--muted)]">or paste</div>

          <textarea
            className="min-h-[120px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)]"
            placeholder={`date,description,debit,credit\n2026-07-05,SWIGGY BANGALORE,249.00,\n2026-07-06,SALARY CREDIT,,50000.00\n\n# or one SMS-like line per day:\n2026-07-10 Rs.150 debited via UPI to merchant@oksbi`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />

          <button type="button" className="btn" disabled={busy} onClick={() => void handlePasteImport()}>
            {busy ? 'Importing…' : 'Import pasted text'}
          </button>

          <p className="text-xs text-[var(--muted)]">
            Tip: download CSV from net banking (Account statement). Columns like Date,
            Narration/Description, Debit, Credit work best.
          </p>

          {message ? <p className="text-sm text-[var(--credit)]">{message}</p> : null}
          {error ? <p className="text-sm text-[var(--debit)]">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
