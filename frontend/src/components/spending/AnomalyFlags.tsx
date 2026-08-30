import { AlertTriangle } from 'lucide-react'
import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { AnomalyItem } from './utils'

export function AnomalyFlags({
  items,
  onAnomalyClick,
}: {
  items: AnomalyItem[]
  onAnomalyClick: (item: AnomalyItem) => void
}) {
  return (
    <ChartCard
      title="Anomaly flags"
      subtitle="Click a row to open Find transactions — txn spikes and category over 1.5× trailing avg"
      className="mb-5"
    >
      {!items.length ? (
        <p className="text-sm text-[var(--muted)]">
          No anomalies flagged for this range. Spikes above 1.5× your recent average will appear
          here.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const clickable = Boolean(item.merchant || item.category)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onAnomalyClick(item)}
                  className={`flex w-full gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left ${
                    clickable
                      ? 'cursor-pointer hover:border-[var(--sapphire)]/40 hover:bg-[var(--sheet)]'
                      : 'cursor-default'
                  }`}
                >
                  <AlertTriangle
                    size={16}
                    className={`mt-0.5 shrink-0 ${
                      item.severity === 'alert'
                        ? 'text-[var(--debit)]'
                        : item.severity === 'warning'
                          ? 'text-amber-600'
                          : 'text-[var(--muted)]'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                        {item.kind === 'category' ? 'Category' : 'Transaction'}
                        {item.multiple != null ? ` · ${item.multiple}×` : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{item.message}</p>
                    {item.amount != null || item.avg != null ? (
                      <p className="mt-1 text-xs tabular-nums text-[var(--text)]">
                        {item.amount != null ? (
                          <span className="text-[var(--debit)]">{formatINR(item.amount)}</span>
                        ) : null}
                        {item.amount != null && item.avg != null ? (
                          <span className="text-[var(--muted)]"> vs avg </span>
                        ) : null}
                        {item.avg != null ? (
                          <span className="text-[var(--muted)]">{formatINR(item.avg)}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ChartCard>
  )
}
