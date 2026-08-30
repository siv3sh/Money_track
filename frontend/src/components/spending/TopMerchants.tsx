import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { MerchantRow } from '../../types'

export function TopMerchants({
  merchants,
  onMerchantClick,
  limit = 10,
}: {
  merchants: MerchantRow[]
  onMerchantClick: (merchant: string) => void
  limit?: number
}) {
  const rows = merchants.slice(0, limit)

  return (
    <ChartCard
      title="Top merchants"
      subtitle="Ranked by spend — click a row to filter transactions"
      className="mb-5"
    >
      {!rows.length ? (
        <p className="text-sm text-[var(--muted)]">No merchant spend in this range.</p>
      ) : (
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((m, i) => (
            <li key={m.merchant}>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-[var(--surface)]"
                onClick={() => onMerchantClick(m.merchant)}
              >
                <span className="w-6 shrink-0 text-xs tabular-nums text-[var(--muted)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]">
                  {m.merchant}
                </span>
                <span className="shrink-0 text-xs text-[var(--muted)]">×{m.count}</span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums text-[var(--debit)]">
                  {formatINR(m.amount)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  )
}
