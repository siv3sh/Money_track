import { useEffect, useState } from 'react'
import { fetchBudgets, saveBudgets } from '../api'
import { DEFAULT_CATEGORIES } from '../types'
import { formatINR } from '../lib/format'

const EDITABLE = DEFAULT_CATEGORIES.filter((c) => !['Income', 'Transfers', 'Investments'].includes(c))

export function BudgetEditor({
  onSaved,
  actuals,
}: {
  onSaved?: () => void
  actuals?: Record<string, number>
}) {
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchBudgets()
      .then((r) => {
        const map: Record<string, number> = {}
        for (const b of r.budgets) map[b.category] = b.amount
        setAmounts(map)
      })
      .catch(() => undefined)
  }, [])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const budgets = Object.entries(amounts)
        .filter(([, amt]) => amt > 0)
        .map(([category, amount]) => ({ category, amount }))
      await saveBudgets(budgets)
      setMsg(`Saved ${budgets.length} budget targets`)
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
        <h3 className="text-sm font-semibold">Monthly budget targets</h3>
        <p className="text-xs text-[var(--muted)]">
          Alerts use these amounts. Leave blank to keep soft defaults for that category.
        </p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {EDITABLE.map((cat) => (
          <label key={cat} className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            <span className="font-medium text-[var(--text)]">{cat}</span>
            <input
              className="field"
              type="number"
              min={0}
              step="100"
              placeholder="₹ target"
              value={amounts[cat] ?? ''}
              onChange={(e) =>
                setAmounts((prev) => ({
                  ...prev,
                  [cat]: Number(e.target.value) || 0,
                }))
              }
            />
            {actuals?.[cat] != null ? (
              <span className="text-[10px]">Actual {formatINR(actuals[cat])}</span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
        <div>
          {msg ? <p className="text-xs text-[var(--credit)]">{msg}</p> : null}
          {err ? <p className="text-xs text-[var(--debit)]">{err}</p> : null}
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save budgets'}
        </button>
      </div>
    </section>
  )
}
