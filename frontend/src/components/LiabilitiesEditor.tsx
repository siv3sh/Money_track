import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { fetchLiabilities, saveLiabilities, type LiabilityItem } from '../api'
import { formatDate, formatINR } from '../lib/format'
import { LedgerAmount } from './LedgerAmount'

const TYPES = [
  { value: 'loan', label: 'Loan' },
  { value: 'emi', label: 'EMI' },
  { value: 'bnpl', label: 'BNPL' },
  { value: 'credit_card', label: 'Credit card (manual)' },
  { value: 'other', label: 'Other' },
]

const emptyRow = (): LiabilityItem => ({
  name: '',
  type: 'loan',
  outstanding: 0,
  source: 'manual',
  last_updated: new Date().toISOString().slice(0, 10),
})

function isAutoCard(row: LiabilityItem): boolean {
  return (row.source || '') === 'credit_cards'
}

function dueLabel(due: string | null | undefined): string {
  if (!due) return 'Due date unknown'
  try {
    return `Due ${formatDate(due.includes('T') ? due : `${due}T00:00:00`)}`
  } catch {
    return `Due ${due}`
  }
}

export function LiabilitiesEditor({ onSaved }: { onSaved?: () => void }) {
  const [autoRows, setAutoRows] = useState<LiabilityItem[]>([])
  const [rows, setRows] = useState<LiabilityItem[]>([emptyRow()])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchLiabilities()
      .then((r) => {
        const auto = r.items.filter(isAutoCard)
        const manual = r.items.filter((i) => !isAutoCard(i))
        setAutoRows(auto)
        setRows(
          manual.length
            ? manual.map((i) => ({
                ...i,
                last_updated: (i.updated_at || '').slice(0, 10),
              }))
            : [emptyRow()],
        )
      })
      .catch(() => undefined)
  }, [])

  const manualTotal = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0)
  const autoTotal = autoRows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0)
  const total = manualTotal + autoTotal

  const save = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const cleaned = rows
        .filter((r) => r.name.trim() && Number(r.outstanding) >= 0)
        .map((r) => ({
          name: r.name.trim(),
          type: r.type || 'other',
          outstanding: Number(r.outstanding) || 0,
          last_updated: r.last_updated || null,
        }))
      const res = await saveLiabilities(cleaned)
      const auto = res.items.filter(isAutoCard)
      const manual = res.items.filter((i) => !isAutoCard(i))
      setAutoRows(auto)
      setRows(
        manual.length
          ? manual.map((i) => ({
              ...i,
              last_updated: (i.updated_at || '').slice(0, 10),
            }))
          : [emptyRow()],
      )
      setMsg(`Saved · total ${formatINR(res.total)} (cards auto-synced from SMS)`)
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="elev-sheet mb-5 overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold">Liabilities</h3>
        <p className="text-xs text-[var(--muted)]">
          SMS credit cards sync automatically · add loans / EMI / BNPL manually
        </p>
      </div>
      <div className="space-y-3 p-4">
        {autoRows.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)]/40 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Credit cards (from SMS)
            </p>
            {autoRows.map((row) => (
              <div
                key={row.id || `${row.bank}-${row.last4}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-[var(--muted)]">{dueLabel(row.due_date)}</p>
                </div>
                <LedgerAmount amount={row.outstanding} rail="debit" size="sm" className="py-1" />
              </div>
            ))}
          </div>
        ) : null}

        {rows.map((row, idx) => (
          <div key={idx} className="grid gap-2 sm:grid-cols-5">
            <input
              className="field sm:col-span-2"
              placeholder="Name"
              value={row.name}
              onChange={(e) => {
                const next = [...rows]
                next[idx] = { ...row, name: e.target.value }
                setRows(next)
              }}
            />
            <select
              className="field"
              value={row.type}
              onChange={(e) => {
                const next = [...rows]
                next[idx] = { ...row, type: e.target.value }
                setRows(next)
              }}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              className="field"
              type="number"
              min={0}
              step="0.01"
              placeholder="Outstanding"
              value={row.outstanding || ''}
              onChange={(e) => {
                const next = [...rows]
                next[idx] = { ...row, outstanding: Number(e.target.value) || 0 }
                setRows(next)
              }}
            />
            <div className="flex gap-2">
              <input
                className="field flex-1"
                type="date"
                value={row.last_updated || ''}
                onChange={(e) => {
                  const next = [...rows]
                  next[idx] = { ...row, last_updated: e.target.value }
                  setRows(next)
                }}
              />
              <button
                type="button"
                className="btn"
                aria-label="Remove"
                onClick={() => setRows(rows.filter((_, i) => i !== idx))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn" onClick={() => setRows([...rows, emptyRow()])}>
            <Plus size={14} />
            Add liability
          </button>
          <div className="flex items-center gap-3">
            <LedgerAmount amount={total} rail="debit" size="sm" className="py-1" />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save liabilities'}
            </button>
          </div>
        </div>
        {msg ? <p className="text-xs text-[var(--credit)]">{msg}</p> : null}
        {err ? <p className="text-xs text-[var(--debit)]">{err}</p> : null}
      </div>
    </section>
  )
}
