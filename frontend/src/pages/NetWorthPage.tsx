import { useMemo } from 'react'
import { Landmark, PiggyBank, TrendingUp, Wallet } from 'lucide-react'
import {
  AssetsLiabilitiesBars,
  DonutChart,
  NetTrendLine,
} from '../components/charts/FinanceCharts'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { EmptyState, LoadingBlock } from '../components/ui/EmptyState'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { useFinanceReport } from '../hooks/useFinanceReport'
import { useFilters } from '../context/FilterContext'
import { latestBalancesByAccount, pctDelta, runningBalanceSeries } from '../lib/analytics'
import { buildDemoPortfolio } from '../lib/investments'
import { formatINR } from '../lib/format'
import { monthLabel } from '../lib/dates'

export function NetWorthPage() {
  const { report, monthly, summary, transactions, loading, error, reload } = useFinanceReport()
  const { sources } = useFilters()
  const portfolio = useMemo(
    () => buildDemoPortfolio(summary?.this_month_credit || 120000),
    [summary?.this_month_credit],
  )

  const balances = useMemo(() => latestBalancesByAccount(transactions), [transactions])
  const liquid = balances.reduce((s, b) => s + Math.max(0, b.balance), 0)
  const invested = portfolio.totalCurrent
  const debtEstimate = Math.max(
    0,
    (report?.by_card_type.find((r) => r.name === 'credit_card')?.debit || 0) * 0.35,
  )
  const assets = liquid + invested
  const liabilities = debtEstimate
  const netWorth = assets - liabilities

  const netWorthTrend = useMemo(() => {
    const base = runningBalanceSeries(monthly, Math.max(0, liquid - monthly.reduce((s, m) => s + m.net, 0)))
    // Blend cumulative cash with growing portfolio
    return base.map((row, i) => {
      const growth = portfolio.growth[Math.min(i, portfolio.growth.length - 1)]
      const investedAt =
        (growth?.Equity || 0) +
        (growth?.Debt || 0) +
        (growth?.Gold || 0) +
        (growth?.International || 0) +
        (growth?.Cash || 0)
      return {
        ...row,
        label: monthLabel(row.month),
        netWorth: row.balance + investedAt * 0.15 + invested * (0.7 + i / (base.length || 1) * 0.3),
      }
    })
  }, [monthly, liquid, invested, portfolio.growth])

  const savingsDelta = summary
    ? pctDelta(summary.this_month_net, summary.last_month_net)
    : null
  const investDelta = pctDelta(portfolio.totalCurrent, portfolio.totalInvested)

  const sourcesList = (report?.by_bank || []).map((r) => r.name)
  const categories = report?.categories || []

  const filteredBalances =
    sources.length === 0
      ? balances
      : balances.filter((b) => sources.includes(b.bank || 'Unknown'))

  return (
    <div>
      <PageHeader
        title="Net worth"
        description="Your complete financial position — liquid cash, investments, and liabilities at a glance."
      />
      <FilterBar
        availableSources={sourcesList}
        availableCategories={categories}
        onRefresh={reload}
        loading={loading}
        showCategoryFilter={false}
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/35 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !summary ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total net worth"
              value={formatINR(netWorth)}
              delta={savingsDelta}
              tone="neutral"
              icon={<Landmark size={18} />}
              hint="Assets − liabilities"
              className="fade-up-delay-1"
            />
            <KpiCard
              label="This month's savings"
              value={formatINR(summary?.this_month_net ?? 0)}
              delta={savingsDelta}
              tone={(summary?.this_month_net ?? 0) >= 0 ? 'credit' : 'debit'}
              icon={<PiggyBank size={18} />}
              hint="Credit − debit"
              className="fade-up-delay-2"
            />
            <KpiCard
              label="Total invested"
              value={formatINR(invested)}
              delta={investDelta}
              tone="credit"
              icon={<TrendingUp size={18} />}
              hint="Portfolio market value"
              className="fade-up-delay-3"
            />
            <KpiCard
              label="Total debt"
              value={formatINR(liabilities)}
              tone={liabilities > 0 ? 'debit' : 'neutral'}
              icon={<Wallet size={18} />}
              hint="Estimated card liability"
              className="fade-up-delay-4"
            />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Net worth trend"
              subtitle="Estimated wealth trajectory across recent months"
              className="xl:col-span-2"
              tall
            >
              {netWorthTrend.length ? (
                <NetTrendLine
                  data={netWorthTrend}
                  dataKey="netWorth"
                  name="Net worth"
                  color="var(--accent)"
                />
              ) : (
                <EmptyState />
              )}
            </ChartCard>
            <ChartCard title="Liquid vs invested" subtitle="Where your assets sit today">
              <DonutChart
                data={[
                  { name: 'Liquid', value: Math.max(liquid, 0) },
                  { name: 'Invested', value: invested },
                ]}
                colors={['var(--chart-1)', 'var(--chart-2)']}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard title="Assets vs liabilities" subtitle="Balance sheet snapshot">
              <AssetsLiabilitiesBars assets={assets} liabilities={liabilities} />
            </ChartCard>
            <ChartCard
              title="Running balances"
              subtitle="Latest reported balances by account"
              className="xl:col-span-2"
            >
              {filteredBalances.length === 0 ? (
                <EmptyState message="No account balances in SMS yet — balances appear when banks send Avl Bal." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="px-2 py-2 font-medium">Account</th>
                        <th className="px-2 py-2 font-medium">Bank</th>
                        <th className="px-2 py-2 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBalances.map((b) => (
                        <tr key={b.account} className="border-t border-[var(--border)]">
                          <td className="px-2 py-2.5 font-medium">{b.account}</td>
                          <td className="px-2 py-2.5 text-[var(--muted)]">{b.bank || '—'}</td>
                          <td
                            className={`px-2 py-2.5 text-right tabular-nums ${
                              b.balance >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                            }`}
                          >
                            {formatINR(b.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}
