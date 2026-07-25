import { useMemo } from 'react'
import { CalendarDays, PiggyBank, Store, TrendingUp } from 'lucide-react'
import {
  DonutChart,
  HorizontalRankBars,
  NetTrendLine,
  SimpleBars,
} from '../components/charts/FinanceCharts'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { EmptyState, LoadingBlock } from '../components/ui/EmptyState'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { useFinanceReport } from '../hooks/useFinanceReport'
import { pctDelta } from '../lib/analytics'
import { buildInvestmentSnapshot } from '../lib/investments'
import { formatDate, formatINR } from '../lib/format'

export function InvestmentsPage() {
  const { summary, report, monthly, transactions, loading, error, reload } = useFinanceReport({
    txnLimit: 500,
  })

  const portfolio = useMemo(
    () => buildInvestmentSnapshot(transactions, monthly),
    [transactions, monthly],
  )

  const income = summary?.this_month_credit || 0
  const investRatio =
    income > 0 ? (portfolio.thisMonthInvested / income) * 100 : null
  const monthDelta =
    portfolio.byMonth.length >= 2
      ? pctDelta(
          portfolio.byMonth[portfolio.byMonth.length - 1]?.invested || 0,
          portfolio.byMonth[portfolio.byMonth.length - 2]?.invested || 0,
        )
      : null

  const merchantDonut = portfolio.merchants.slice(0, 8).map((m) => ({
    name: m.name.length > 28 ? `${m.name.slice(0, 26)}…` : m.name,
    value: m.amount,
  }))

  return (
    <div>
      <PageHeader
        title="Investments"
        description="Tracked from your real Investment-category transactions and known investment merchants — no demo holdings."
      />
      <FilterBar
        availableSources={(report?.by_bank || []).map((r) => r.name)}
        onRefresh={reload}
        loading={loading}
        showCategoryFilter={false}
        showSourceFilter={false}
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
              label="Total invested"
              value={formatINR(portfolio.totalInvested)}
              tone="credit"
              delta={monthDelta}
              icon={<PiggyBank size={18} />}
              hint="Outflows tagged as investments"
            />
            <KpiCard
              label="This month"
              value={formatINR(portfolio.thisMonthInvested)}
              tone="credit"
              icon={<CalendarDays size={18} />}
              hint={
                investRatio != null
                  ? `${investRatio.toFixed(1)}% of this month's income`
                  : 'No income recorded this month'
              }
            />
            <KpiCard
              label="Investment txns"
              value={String(portfolio.txnCount)}
              icon={<TrendingUp size={18} />}
            />
            <KpiCard
              label="Platforms / merchants"
              value={String(portfolio.merchants.length)}
              icon={<Store size={18} />}
              hint={portfolio.merchants[0]?.name || 'None yet'}
            />
          </div>

          {portfolio.txnCount === 0 ? (
            <div className="panel p-8 fade-up">
              <EmptyState message="No investment transactions in this range. Categorize buys as Investments or import statements that include SIPs / broker outflows." />
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-4 xl:grid-cols-3">
                <ChartCard title="By platform / merchant" subtitle="Where investment outflows went">
                  <DonutChart data={merchantDonut} />
                </ChartCard>
                <ChartCard
                  title="Invested by month"
                  subtitle="Cash deployed into investments"
                  className="xl:col-span-2"
                >
                  <SimpleBars
                    data={portfolio.byMonth.map((m) => ({
                      label: m.label,
                      value: m.invested,
                    }))}
                    dataKey="value"
                    name="Invested"
                    color="var(--chart-credit)"
                  />
                </ChartCard>
              </div>

              <div className="mb-4 grid gap-4 xl:grid-cols-2">
                <ChartCard
                  title="Investment-to-income ratio"
                  subtitle="% of monthly income invested (from real cash flow)"
                >
                  <NetTrendLine
                    data={portfolio.byMonth}
                    dataKey="ratio"
                    name="Invested / income %"
                    color="var(--chart-4)"
                  />
                </ChartCard>
                <ChartCard title="Top investment destinations" subtitle="Ranked by amount">
                  <HorizontalRankBars
                    data={portfolio.merchants.slice(0, 10).map((m) => ({
                      name: m.name.length > 22 ? `${m.name.slice(0, 20)}…` : m.name,
                      value: m.amount,
                    }))}
                    color="var(--chart-2)"
                  />
                </ChartCard>
              </div>

              <section className="panel overflow-hidden fade-up">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-semibold">Investment transactions</h3>
                  <p className="text-xs text-[var(--muted)]">
                    Debits categorized as Investments or matching known brokers
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">Date</th>
                        <th className="px-4 py-2 font-medium">Merchant</th>
                        <th className="px-4 py-2 font-medium">Category</th>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.transactions.slice(0, 40).map((t) => (
                        <tr key={t._id} className="border-t border-[var(--border)]">
                          <td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted)]">
                            {formatDate(t.received_at)}
                          </td>
                          <td className="max-w-[260px] truncate px-4 py-2.5 font-medium">
                            {t.merchant || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--muted)]">
                            {t.category || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--debit)]">
                            {formatINR(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
