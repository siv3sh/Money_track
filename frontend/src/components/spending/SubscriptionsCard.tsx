import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'

type RecurringMerchant = {
  merchant: string
  amount: number
  count: number
  avg?: number
}

export function SubscriptionsCard({ merchants }: { merchants: RecurringMerchant[] }) {
  const rows = [...merchants].sort((a, b) => b.amount - a.amount).slice(0, 12)

  return (
    <ChartCard
      title="Subscriptions"
      subtitle="Merchants that look recurring (3+ similar debits)"
      className="mb-5"
    >
      {!rows.length ? (
        <p className="text-sm text-[var(--muted)]">
          No recurring merchants detected yet. Subscriptions and regular bills will show up here
          once enough history lands.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((m, i) => (
            <li
              key={m.merchant}
              className="flex items-center gap-3 py-2.5 text-sm"
            >
              <span className="w-6 shrink-0 text-xs tabular-nums text-[var(--muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">
                {m.merchant}
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {m.count}× · ~{formatINR(m.avg ?? m.amount / Math.max(m.count, 1))}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-[var(--debit)]">
                {formatINR(m.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  )
}
