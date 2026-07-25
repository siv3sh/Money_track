import { useMemo } from 'react'
import { AlertTriangle, Bell, CalendarClock, ShieldAlert } from 'lucide-react'
import { FilterBar } from '../components/layout/FilterBar'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { ProgressBar } from '../components/ui/ProgressBar'
import { LoadingBlock } from '../components/ui/EmptyState'
import { useFinanceReport } from '../hooks/useFinanceReport'
import { budgetVsActual, detectAnomalies, upcomingSubscriptions } from '../lib/alerts'
import { formatDate, formatINR } from '../lib/format'

export function AlertsPage() {
  const { report, transactions, loading, error, reload } = useFinanceReport({ txnLimit: 500 })

  const budgets = useMemo(
    () => (report ? budgetVsActual(report) : []),
    [report],
  )
  const subs = useMemo(() => upcomingSubscriptions(transactions), [transactions])
  const anomalies = useMemo(
    () => (report ? detectAnomalies(transactions, report) : []),
    [transactions, report],
  )

  const overBudget = budgets.filter((b) => b.pct > 100).length

  return (
    <div>
      <PageHeader
        title="Alerts & insights"
        description="Budget tracking, upcoming renewals, and unusual spend signals."
      />
      <FilterBar
        availableSources={(report?.by_bank || []).map((r) => r.name)}
        availableCategories={report?.categories || []}
        onRefresh={reload}
        loading={loading}
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/35 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Categories over budget"
              value={String(overBudget)}
              tone={overBudget > 0 ? 'warning' : 'credit'}
              icon={<Bell size={18} />}
            />
            <KpiCard
              label="Upcoming renewals"
              value={String(subs.length)}
              icon={<CalendarClock size={18} />}
            />
            <KpiCard
              label="Anomalies flagged"
              value={String(anomalies.length)}
              tone={anomalies.length > 0 ? 'debit' : 'neutral'}
              icon={<ShieldAlert size={18} />}
            />
            <KpiCard
              label="Period spend"
              value={formatINR(report?.overview.total_debit || 0)}
              tone="debit"
              icon={<AlertTriangle size={18} />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="panel p-5 fade-up xl:col-span-1">
              <h3 className="text-sm font-semibold">Budget vs actual</h3>
              <p className="mt-0.5 mb-4 text-xs text-[var(--muted)]">
                Default monthly budgets — over 100% means overspend
              </p>
              <div className="space-y-4">
                {budgets.map((b) => (
                  <div key={b.category}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{b.category}</span>
                      <span className="text-xs tabular-nums text-[var(--muted)]">
                        {formatINR(b.actual)} / {formatINR(b.budget)}
                      </span>
                    </div>
                    <ProgressBar
                      value={b.actual}
                      max={b.budget}
                      tone={b.pct > 100 ? 'debit' : b.pct > 80 ? 'warning' : 'credit'}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="panel p-5 fade-up">
              <h3 className="text-sm font-semibold">Upcoming subscription renewals</h3>
              <p className="mt-0.5 mb-4 text-xs text-[var(--muted)]">
                Detected from subscription-like merchants
              </p>
              {subs.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No upcoming renewals detected.</p>
              ) : (
                <ul className="space-y-3">
                  {subs.map((s) => (
                    <li
                      key={`${s.merchant}-${s.nextDate}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{s.merchant}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {s.cadence} · next {s.nextDate}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--debit)]">
                        {formatINR(s.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel p-5 fade-up">
              <h3 className="text-sm font-semibold">Unusual spend alerts</h3>
              <p className="mt-0.5 mb-4 text-xs text-[var(--muted)]">
                Spikes vs median and category concentration
              </p>
              {anomalies.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No anomalies in this period.</p>
              ) : (
                <ul className="space-y-3">
                  {anomalies.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{a.title}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">{a.detail}</p>
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            {formatDate(a.date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              a.severity === 'high'
                                ? 'bg-[var(--debit-soft)] text-[var(--debit)]'
                                : a.severity === 'medium'
                                  ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                                  : 'bg-[var(--surface-3)] text-[var(--muted)]'
                            }`}
                          >
                            {a.severity}
                          </span>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--debit)]">
                            {formatINR(a.amount)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
