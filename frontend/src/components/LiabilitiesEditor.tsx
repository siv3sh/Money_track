import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { fetchLiabilities, saveLiabilities, type LiabilityItem } from '../api'
import { formatINR } from '../lib/format'

const TYPES = [
  { value: 'credit_card', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'emi', label: 'EMI' },
  { value: 'bnpl', label: 'BNPL' },
  { value: 'other', label: 'Other' },
]

const emptyRow = (): LiabilityItem => ({
  name: '',
  type: 'credit_card',
  outstanding: 0,
  last_updated: new Date().toISOString().slice(0, 10),
})

export function LiabilitiesEditor({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<LiabilityItem[]>([emptyRow()])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchLiabilities()
      .then((r) => {
        if (r.items.length) {
          setRows(
            r.items.map((i) => ({
              ...i,
              last_updated: (i.updated_at || '').slice(0, 10),
            })),
          )
        }
      })
      .catch(() => undefined)
  }, [])

  const total = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0)

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
      setRows(
        res.items.length
          ? res.items.map((i) => ({
              ...i,
              last_updated: (i.updated_at || '').slice(0, 10),
            }))
          : [emptyRow()],
      )
      setMsg(`Saved ${res.items.length} liabilities · total ${formatINR(res.total)}`)
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel mb-5 overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold">Liabilities</h3>
        <p className="text-xs text-[var(--muted)]">
          Credit cards, loans, EMI / BNPL — subtracted from net worth
        </p>
      </div>
      <div className="space-y-3 p-4">
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
            <span className="text-xs text-[var(--muted)]">Total {formatINR(total)}</span>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
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
