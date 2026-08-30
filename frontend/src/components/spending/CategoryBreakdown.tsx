import { DonutChart } from '../charts'
import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { BreakdownRow } from '../../types'

export function CategoryBreakdown({
  categories,
  onCategoryClick,
}: {
  categories: BreakdownRow[]
  onCategoryClick: (category: string) => void
}) {
  const total = categories.reduce((s, c) => s + c.debit, 0)

  return (
    <ChartCard
      title="Category breakdown"
      subtitle="Share of lifestyle spend — click a slice to filter transactions"
      className="mb-5"
    >
      {!categories.length ? (
        <p className="text-sm text-[var(--muted)]">No lifestyle spend in this range.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,14rem)]">
          <DonutChart
            data={categories.map((c) => ({ name: c.name, value: c.debit }))}
            onSliceClick={onCategoryClick}
          />
          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {categories.map((c) => {
              const share = total > 0 ? Math.round((c.debit / total) * 1000) / 10 : 0
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface)]"
                    onClick={() => onCategoryClick(c.name)}
                  >
                    <span className="min-w-0 truncate text-[var(--text)]">
                      {c.name}
                      <span className="ml-1.5 text-xs text-[var(--muted)]">{share}%</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--debit)]">
                      {formatINR(c.debit)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}
