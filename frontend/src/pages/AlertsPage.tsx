import { AlertTriangle, Bell, Info, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { BudgetEditor } from '../components/BudgetEditor'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'
import type { AnalyticsAlert } from '../types'

function severityIcon(severity: AnalyticsAlert['severity']) {
  switch (severity) {
    case 'alert':
      return <AlertTriangle size={16} className="text-[var(--debit)]" />
    case 'warning':
      return <AlertTriangle size={16} className="text-[var(--warning)]" />
    case 'info':
      return <Info size={16} className="text-[var(--accent)]" />
    default: {
      const _exhaustive: never = severity
      return _exhaustive
    }
  }
}

export function AlertsPage() {
  const { data, loading, error, refresh } = useFilters()
  const alerts = data?.alerts || []

  const budgets = alerts.filter((a) => a.type === 'budget')
  const subscriptions = alerts.filter((a) => a.type === 'subscription')
  const anomalies = alerts.filter((a) => a.type === 'anomaly' || a.type === 'trend' || a.type === 'insight')

  const actuals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const row of data?.by_category || []) map[row.name] = row.debit
    return map
  }, [data?.by_category])

  return (
    <div className="fade-in">
      <PageHeader
        title="Alerts & Insights"
        description="Budget progress, recurring subscriptions, and unusual spend signals."
        actions={
          <button type="button" className="btn" onClick={refresh}>
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />
      <FilterBar />

      <BudgetEditor onSaved={refresh} actuals={actuals} />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard
            title="Budget vs actual"
            subtitle="Soft defaults — edit budgets later"
            className="xl:col-span-1"
          >
            {budgets.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">No budget signals</p>
            ) : (
              <ul className="space-y-4">
                {budgets.map((b) => {
                  const pct = Math.min(b.pct || 0, 100)
                  const over = (b.pct || 0) > 100
                  return (
                    <li key={b.category || b.title}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium">{b.category || b.title}</span>
                        <span className="tabular-nums text-[var(--muted)]">
                          {formatINR(b.actual || 0)} / {formatINR(b.budget || 0)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(pct, 100)}%`,
                            background: over ? 'var(--debit)' : pct >= 90 ? 'var(--warning)' : 'var(--accent)',
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--muted)]">{b.pct}% used</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </ChartCard>

          <ChartCard title="Upcoming / recurring subscriptions" subtitle="Detected from repeat merchants">
            {subscriptions.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">
                No recurring subscriptions detected
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {subscriptions.map((s, i) => (
                  <li key={`${s.merchant}-${i}`} className="flex items-start gap-3 py-3">
                    <Bell size={14} className="mt-0.5 text-[var(--accent)]" />
                    <div>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-[var(--muted)]">{s.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>

          <ChartCard title="Anomalies & insights" subtitle="Unusual spends and trend flags">
            {anomalies.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">All quiet for now</p>
            ) : (
              <ul className="space-y-3">
                {anomalies.map((a, i) => (
                  <li
                    key={`${a.title}-${i}`}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                  >
                    <div className="flex items-start gap-2">
                      {severityIcon(a.severity)}
                      <div>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{a.message}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  )
}
