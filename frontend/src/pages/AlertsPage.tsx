import { AlertTriangle, Bell, Info, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { BudgetEditor } from '../components/BudgetEditor'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'
import { markSipInvested } from '../api'
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
  const sipAlerts = alerts.filter((a) => a.type === 'sip')
  const driftAlerts = alerts.filter((a) => a.type === 'drift')
  const anomalies = alerts.filter(
    (a) => a.type === 'anomaly' || a.type === 'trend' || a.type === 'insight',
  )

  const creepItems = data?.smart?.subscription_creep?.items || []
  const flaggedCreep = creepItems.filter((i) => i.status !== 'ok')
  const sipRows = (data?.smart?.sip?.sips || []).filter(
    (s) => !['ok', 'marked'].includes(s.status),
  )

  const actuals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const row of data?.by_category || []) map[row.name] = row.debit
    return map
  }, [data?.by_category])

  return (
    <div className="fade-in">
      <PageHeader
        title="Alerts & Insights"
        description="Budgets, SIP misses, subscription price changes, and unusual spend signals."
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
                            background: over
                              ? 'var(--debit)'
                              : pct >= 90
                                ? 'var(--warning)'
                                : 'var(--accent)',
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

          <ChartCard title="Subscriptions & bill creep" subtitle="Price hikes and missing charges">
            {flaggedCreep.length === 0 && subscriptions.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">
                No subscription issues detected
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {flaggedCreep.map((s) => (
                  <li key={`${s.merchant}-${s.status}`} className="flex items-start gap-3 py-3">
                    <Bell
                      size={14}
                      className={
                        s.status === 'price_up'
                          ? 'mt-0.5 text-[var(--warning)]'
                          : 'mt-0.5 text-[var(--debit)]'
                      }
                    />
                    <div>
                      <p className="text-sm font-medium">{s.merchant}</p>
                      <p className="text-xs text-[var(--muted)]">{s.message}</p>
                    </div>
                  </li>
                ))}
                {subscriptions
                  .filter(
                    (s) =>
                      !flaggedCreep.some(
                        (c) => c.merchant.toLowerCase() === (s.merchant || '').toLowerCase(),
                      ),
                  )
                  .map((s, i) => (
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

          <ChartCard title="Anomalies & insights" subtitle="Unusual spends, SIP & drift flags">
            {anomalies.length === 0 && sipAlerts.length === 0 && driftAlerts.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">All quiet for now</p>
            ) : (
              <ul className="space-y-3">
                {[...sipAlerts, ...driftAlerts, ...anomalies].map((a, i) => (
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

          {sipRows.length > 0 ? (
            <ChartCard
              title="SIP consistency"
              subtitle="Missing or drifted investment schedules"
              className="xl:col-span-3"
            >
              <ul className="space-y-3">
                {sipRows.map((s) => (
                  <li
                    key={s.name}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        SIP: {s.name}
                        {s.status === 'missing'
                          ? ` — expected on day ${s.typical_day}, not yet detected this month`
                          : ''}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{s.message}</p>
                    </div>
                    {(s.status === 'missing' || s.status === 'stopped') && (
                      <button
                        type="button"
                        className="btn text-xs"
                        onClick={async () => {
                          await markSipInvested(s.name, s.current_month)
                          refresh()
                        }}
                      >
                        Mark as invested
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </ChartCard>
          ) : null}
        </div>
      )}
    </div>
  )
}
