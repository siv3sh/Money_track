import { AlertTriangle } from 'lucide-react'
import { ChartCard } from '../ui'
import type { AnomalyItem } from './utils'

export function AnomalyFlags({ items }: { items: AnomalyItem[] }) {
  return (
    <ChartCard
      title="Anomaly flags"
      subtitle="Unusual spend vs your history (alerts, or over 1.5× trailing 3-month avg)"
      className="mb-5"
    >
      {!items.length ? (
        <p className="text-sm text-[var(--muted)]">
          No anomalies flagged for this range. Spikes above 1.5× your recent average will appear
          here.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
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
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{item.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  )
}
