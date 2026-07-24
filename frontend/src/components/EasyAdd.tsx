import { useState } from 'react'
import { FileUp, Plus, MessageSquareText } from 'lucide-react'
import {
  createManualTransaction,
  importStatementText,
  uploadStatementFile,
} from '../api'

interface Props {
  onImported: () => void
}

type Tab = 'quick' | 'upload' | 'sms'

const BANKS = ['HDFC Bank', 'SBI', 'ICICI Bank', 'Axis Bank', 'Kotak Bank', 'IDFC First Bank', 'Yes Bank']

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)]'

export function EasyAdd({ onImported }: Props) {
  const [tab, setTab] = useState<Tab>('quick')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Quick add
  const [type, setType] = useState<'debit' | 'credit'>('debit')
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [bank, setBank] = useState('HDFC Bank')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  // SMS paste
  const [sms, setSms] = useState('')
  const [smsBank, setSmsBank] = useState('HDFC Bank')

  // Upload bank
  const [fileBank, setFileBank] = useState('HDFC Bank')

  const resetFeedback = () => {
    setOk(null)
    setErr(null)
  }

  const saveQuick = async () => {
    const value = Number(amount)
    if (!value || value <= 0) {
      setErr('Enter an amount greater than 0')
      return
    }
    setBusy(true)
    resetFeedback()
    try {
      await createManualTransaction({
        type,
        amount: value,
        merchant: merchant.trim() || undefined,
        bank,
        date,
        card_type: 'bank_account',
      })
      setOk('Saved!')
      setAmount('')
      setMerchant('')
      onImported()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const saveSms = async () => {
    if (!sms.trim()) {
      setErr('Paste the bank SMS text')
      return
    }
    setBusy(true)
    resetFeedback()
    try {
      const result = await importStatementText({
        content: `${date} ${sms.trim()}`,
        bank: smsBank,
        format: 'text',
      })
      if (result.imported === 0) {
        setErr(
          result.parsed === 0
            ? 'Could not read a transaction in that text (OTP/spam are blocked)'
            : 'Already imported (duplicate)',
        )
      } else {
        setOk('SMS saved!')
        setSms('')
        onImported()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save SMS')
    } finally {
      setBusy(false)
    }
  }

  const saveFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    resetFeedback()
    try {
      const result = await uploadStatementFile(file, fileBank)
      if (result.imported === 0) {
        setErr(
          result.parsed === 0
            ? 'No transactions found in that file'
            : `Nothing new (${result.skipped_duplicates} already imported)`,
        )
      } else {
        setOk(`Added ${result.imported} transactions`)
        onImported()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Plus }[] = [
    { id: 'quick', label: 'Quick add', icon: Plus },
    { id: 'sms', label: 'Paste SMS', icon: MessageSquareText },
    { id: 'upload', label: 'Upload file', icon: FileUp },
  ]

  return (
    <section className="panel p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Add money</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Quick add, paste an SMS, or upload CSV / Excel / PDF from your bank.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${
              tab === id
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
            }`}
            onClick={() => {
              setTab(id)
              resetFeedback()
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'quick' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${
                type === 'debit'
                  ? 'bg-[var(--debit)] text-white'
                  : 'border border-[var(--border)]'
              }`}
              onClick={() => setType('debit')}
            >
              Spent (debit)
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${
                type === 'credit'
                  ? 'bg-[var(--credit)] text-white'
                  : 'border border-[var(--border)]'
              }`}
              onClick={() => setType('credit')}
            >
              Received (credit)
            </button>
          </div>
          <label className="text-xs text-[var(--muted)]">
            Amount (₹)
            <input
              className={`${field} mt-1`}
              inputMode="decimal"
              placeholder="e.g. 249"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Date
            <input
              type="date"
              className={`${field} mt-1`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Where? (merchant)
            <input
              className={`${field} mt-1`}
              placeholder="Swiggy, Amazon, Salary…"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Bank
            <select className={`${field} mt-1`} value={bank} onChange={(e) => setBank(e.target.value)}>
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn sm:col-span-2 justify-center bg-[var(--accent)] text-white border-transparent"
            disabled={busy}
            onClick={() => void saveQuick()}
          >
            {busy ? 'Saving…' : 'Save transaction'}
          </button>
        </div>
      ) : null}

      {tab === 'sms' ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Copy a bank SMS from Messages → paste here → Save.
          </p>
          <label className="text-xs text-[var(--muted)]">
            Bank
            <select
              className={`${field} mt-1`}
              value={smsBank}
              onChange={(e) => setSmsBank(e.target.value)}
            >
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Date (if SMS has no date)
            <input
              type="date"
              className={`${field} mt-1`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <textarea
            className={`${field} min-h-[110px] font-sans`}
            placeholder="Paste full SMS here…"
            value={sms}
            onChange={(e) => setSms(e.target.value)}
          />
          <button
            type="button"
            className="btn w-full justify-center bg-[var(--accent)] text-white border-transparent"
            disabled={busy}
            onClick={() => void saveSms()}
          >
            {busy ? 'Saving…' : 'Save SMS'}
          </button>
        </div>
      ) : null}

      {tab === 'upload' ? (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-[var(--muted)]">
            <li>Open your bank app / net banking</li>
            <li>Download statement as CSV, Excel, or PDF</li>
            <li>Upload that file below</li>
          </ol>
          <label className="text-xs text-[var(--muted)]">
            Bank
            <select
              className={`${field} mt-1`}
              value={fileBank}
              onChange={(e) => setFileBank(e.target.value)}
            >
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-8 text-sm hover:border-[var(--accent)]">
            <FileUp size={22} className="text-[var(--accent)]" />
            <span className="font-medium text-[var(--text)]">
              Tap to choose CSV / Excel / PDF
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
        </div>
      ) : null}

      {ok ? <p className="mt-3 text-sm text-[var(--credit)]">{ok}</p> : null}
      {err ? <p className="mt-3 text-sm text-[var(--debit)]">{err}</p> : null}
    </section>
  )
}
