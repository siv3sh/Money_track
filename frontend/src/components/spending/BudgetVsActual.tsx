import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { BreakdownRow } from '../../types'

export function BudgetVsActual({
  budgets,
  categories,
}: {
  budgets: Record<string, number> | undefined
  categories: BreakdownRow[]
}) {
  const entries = Object.entries(budgets || {})
    .filter(([, amt]) => amt > 0)
    .map(([name, budget]) => {
      const actual = categories.find((c) => c.name === name)?.debit ?? 0
      const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0
      const over = actual > budget
      return { name, budget, actual, pct, over }
    })
    .sort((a, b) => b.actual / b.budget - a.actual / a.budget)

  return (
    <ChartCard
      title="Budget vs actual"
      subtitle="Only categories with a budget set"
      className="mb-5"
    >
      {!entries.length ? (
        <p className="text-sm text-[var(--muted)]">
          No budgets set yet. Add category caps in Profile to track progress here.
        </p>
      ) : (
        <ul className="space-y-4">
          {entries.map((row) => (
            <li key={row.name}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-[var(--text)]">{row.name}</span>
                <span className="tabular-nums text-[var(--muted)]">
                  <span className={row.over ? 'text-[var(--debit)]' : 'text-[var(--text)]'}>
                    {formatINR(row.actual)}
                  </span>
                  {' / '}
                  {formatINR(row.budget)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className={`h-full rounded-full transition-[width] ${
                    row.over ? 'bg-[var(--debit)]' : 'bg-[var(--sapphire)]'
                  }`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  )
}
