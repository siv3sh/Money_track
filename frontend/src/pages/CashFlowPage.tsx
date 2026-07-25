import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Scale, Waves } from 'lucide-react'
import {
  DonutChart,
  GroupedCreditDebitBars,
  NetTrendLine,
  SimpleBars,
} from '../components/charts/FinanceCharts'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { LoadingBlock } from '../components/ui/EmptyState'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { useFilters } from '../context/FilterContext'
import { useFinanceReport } from '../hooks/useFinanceReport'
import {
  incomeSourceBreakdown,
  latestBalancesByAccount,
  netSavingsTrend,
  pctDelta,
  runningBalanceSeries,
} from '../lib/analytics'
import { monthLabel } from '../lib/dates'
import { formatDate, formatINR } from '../lib/format'

export function CashFlowPage() {
  const { report, monthly, summary, transactions, loading, error, reload } = useFinanceReport()
  const { sources } = useFilters()

  const filteredMonthly = useMemo(() => {
    if (sources.length === 0) return monthly
    // Approximate: scale monthly by source share when filtering
    const banks = report?.by_bank || []
    const total = banks.reduce((s, b) => s + b.debit + b.credit, 0) || 1
    const selected = banks
      .filter((b) => sources.includes(b.name))
      .reduce((s, b) => s + b.debit + b.credit, 0)
    const ratio = selected / total
    return monthly.map((m) => ({
      ...m,
      debit: m.debit * ratio,
      credit: m.credit * ratio,
      net: m.net * ratio,
    }))
  }, [monthly, sources, report])

  const barData = filteredMonthly.map((m) => ({
    label: monthLabel(m.month),
    credit: m.credit,
    debit: m.debit,
  }))
  const netTrend = netSavingsTrend(filteredMonthly)
  const incomeSources = report ? incomeSourceBreakdown(report) : []
  const balances = latestBalancesByAccount(transactions)
  const running = runningBalanceSeries(filteredMonthly)

  const o = report?.overview
  const creditDelta = summary
    ? pctDelta(summary.this_month_credit, summary.last_month_credit)
    : null
  const debitDelta = summary
    ? pctDelta(summary.this_month_debit, summary.last_month_debit)
    : null

  return (
    <div>
      <PageHeader
        title="Cash flow"
        description="Monthly credits vs debits, net savings trajectory, and income composition."
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

      {loading && !o ? (
        <LoadingBlock />
      ) : o ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total credited"
              value={formatINR(o.total_credit)}
              tone="credit"
              delta={creditDelta}
              icon={<ArrowUpRight size={18} />}
              hint={`${o.credit_count} credits`}
            />
            <KpiCard
              label="Total debited"
              value={formatINR(o.total_debit)}
              tone="debit"
              delta={debitDelta}
              deltaInvert
              icon={<ArrowDownRight size={18} />}
              hint={`${o.debit_count} debits`}
            />
            <KpiCard
              label="Net savings"
              value={formatINR(o.net)}
              tone={o.net >= 0 ? 'credit' : 'debit'}
              icon={<Scale size={18} />}
              hint="Credit − debit"
            />
            <KpiCard
              label="Avg daily spend"
              value={formatINR(o.avg_daily_debit)}
              icon={<Waves size={18} />}
              hint={`${o.active_days} active days`}
            />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Monthly credited vs debited"
              subtitle="Grouped bars by calendar month"
              className="xl:col-span-2"
            >
              <GroupedCreditDebitBars data={barData} />
            </ChartCard>
            <ChartCard title="Income by source" subtitle="Where money came from">
              <DonutChart
                data={incomeSources.slice(0, 8)}
                colors={[
                  'var(--chart-2)',
                  'var(--chart-1)',
                  'var(--chart-5)',
                  'var(--chart-4)',
                  'var(--chart-8)',
                  'var(--chart-6)',
                ]}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Net savings trend" subtitle="Credit − debit over time">
              <NetTrendLine data={netTrend} dataKey="net" name="Net" color="var(--chart-credit)" />
            </ChartCard>
            <ChartCard title="Running balance" subtitle="Cumulative net across months">
              <SimpleBars
                data={running.map((r) => ({ ...r, label: r.label, value: r.balance }))}
                dataKey="value"
                name="Balance"
                color="var(--chart-1)"
              />
            </ChartCard>
          </div>

          {balances.length > 0 ? (
            <div className="panel mt-4 overflow-hidden fade-up">
              <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">
                Account balances
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Account</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => (
                      <tr key={b.account} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2.5">{b.account}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(b.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="panel mt-4 overflow-hidden fade-up">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold">Recent transactions</h3>
              <p className="text-xs text-[var(--muted)]">Latest activity in the selected range</p>
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
                  {transactions.slice(0, 15).map((t) => (
                    <tr key={t._id} className="border-t border-[var(--border)]">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted)]">
                        {formatDate(t.received_at)}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 font-medium">
                        {t.merchant || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted)]">{t.category || '—'}</td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                          t.type === 'credit' ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                        }`}
                      >
                        {t.type === 'credit' ? '+' : '−'}
                        {formatINR(t.amount)}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[var(--muted)]">
                        No transactions in this range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
