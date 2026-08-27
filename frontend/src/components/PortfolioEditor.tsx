import { useEffect, useState } from 'react'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { fetchPortfolio, savePortfolio, type PortfolioHolding } from '../api'
import { formatINR } from '../lib/format'

const ASSET_CLASSES = [
  'Equity / Brokerage',
  'US Stocks',
  'Mutual Funds',
  'Digital Gold',
  'Fixed Deposits',
  'Other Investments',
]

export function PortfolioEditor({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<PortfolioHolding[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void fetchPortfolio()
      .then((res) => {
        setRows(res.holdings)
        setLoaded(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load portfolio'))
  }, [])

  const update = (i: number, patch: Partial<PortfolioHolding>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const cleaned = rows.filter((r) => r.name.trim())
      const res = await savePortfolio(cleaned)
      setRows(res.holdings)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && !error) return null

  return (
    <section className="elev-sheet mb-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Portfolio market values</h3>
          <p className="text-xs text-[var(--muted)]">
            Enter current values from INDmoney / broker apps — P&L is computed from these
          </p>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    { name: '', asset_class: 'Equity / Brokerage', invested: 0, current_value: 0 },
                  ])
                }
              >
                <Plus size={14} />
                Add
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                <Save size={14} />
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                <X size={14} />
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              {rows.length ? 'Update values' : 'Add holdings'}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-[var(--debit)]">{error}</p>
      ) : null}

      {editing ? (
        <div className="overflow-x-auto p-3">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <th className="px-2 py-1.5 font-medium">Holding</th>
                <th className="px-2 py-1.5 font-medium">Asset class</th>
                <th className="px-2 py-1.5 font-medium">Invested (₹)</th>
                <th className="px-2 py-1.5 font-medium">Current value (₹)</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5">
                    <input
                      className="field w-44"
                      value={r.name}
                      placeholder="e.g. US Stocks"
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="field"
                      value={r.asset_class}
                      onChange={(e) => update(i, { asset_class: e.target.value })}
                    >
                      {ASSET_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      className="field w-28"
                      value={r.invested}
                      min={0}
                      onChange={(e) => update(i, { invested: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      className="field w-28"
                      value={r.current_value}
                      min={0}
                      onChange={(e) => update(i, { current_value: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      className="btn"
                      aria-label="Remove"
                      onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length ? (
        <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-[var(--muted)]">
          {rows.map((r) => (
            <span key={r.name}>
              <span className="font-medium text-[var(--text)]">{r.name}</span>{' '}
              {formatINR(r.current_value)}
              {r.updated_at
                ? ` · ${new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                : ''}
            </span>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-[var(--muted)]">
          No market values yet — showing cost basis from transactions. Click "Add holdings" to
          enter your INDmoney portfolio.
        </p>
      )}
    </section>
  )
}
