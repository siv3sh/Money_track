import { useMemo } from 'react'
import { CreditCard, Repeat, Store, Tags } from 'lucide-react'
import {
  DonutChart,
  HorizontalRankBars,
  SimpleBars,
  StackedAreaChart,
} from '../components/charts/FinanceCharts'
import { SpendHeatmap } from '../components/charts/SpendHeatmap'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { LoadingBlock } from '../components/ui/EmptyState'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { CARD_TYPE_LABELS, type CardType } from '../types'
import { useFinanceReport } from '../hooks/useFinanceReport'
import {
  accountSpend,
  categorySpend,
  categoryTrendOverMonths,
  pctDelta,
  recurringVsOneTime,
  spendingHeatmap,
} from '../lib/analytics'
import { formatINR } from '../lib/format'

function labelCard(name: string): string {
  if (name in CARD_TYPE_LABELS) return CARD_TYPE_LABELS[name as CardType]
  return name
}

export function SpendingPage() {
  const { report, summary, transactions, loading, error, reload } = useFinanceReport({
    txnLimit: 800,
  })

  const categories = useMemo(
    () => (report ? categorySpend(report) : []),
    [report],
  )
  const trend = useMemo(() => categoryTrendOverMonths(transactions), [transactions])
  const recurring = useMemo(() => recurringVsOneTime(transactions), [transactions])
  const heat = useMemo(() => spendingHeatmap(transactions), [transactions])
  const accounts = useMemo(() => (report ? accountSpend(report) : []), [report])

  const merchants = (report?.merchants || []).map((m) => ({
    name: m.merchant,
    value: m.amount,
  }))

  const o = report?.overview
  const debitDelta = summary
    ? pctDelta(summary.this_month_debit, summary.last_month_debit)
    : null

  return (
    <div>
      <PageHeader
        title="Spending analysis"
        description="Category mix, merchant concentration, recurring charges, and when you spend."
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
              label="Total spend"
              value={formatINR(o.total_debit)}
              tone="debit"
              delta={debitDelta}
              deltaInvert
              icon={<Tags size={18} />}
            />
            <KpiCard
              label="Top category"
              value={categories[0]?.name || '—'}
              hint={categories[0] ? formatINR(categories[0].value) : undefined}
              icon={<Store size={18} />}
            />
            <KpiCard
              label="Recurring spend"
              value={formatINR(recurring.recurring)}
              tone="warning"
              hint="Merchants seen 3+ months"
              icon={<Repeat size={18} />}
            />
            <KpiCard
              label="Avg expense"
              value={formatINR(o.avg_debit)}
              tone="debit"
              icon={<CreditCard size={18} />}
              hint={`${o.debit_count} debits`}
            />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <ChartCard title="Spend by category" subtitle="Donut breakdown of expenses">
              <DonutChart data={categories.slice(0, 8)} />
            </ChartCard>
            <ChartCard
              title="Category trend"
              subtitle="Stacked area across months"
              className="xl:col-span-2"
            >
              <StackedAreaChart data={trend.rows} series={trend.series} />
            </ChartCard>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Top merchants" subtitle="Ranked by debit amount">
              <HorizontalRankBars data={merchants.slice(0, 10)} color="var(--chart-debit)" />
            </ChartCard>
            <ChartCard title="Recurring vs one-time" subtitle="Heuristic based on merchant frequency">
              <DonutChart
                data={[
                  { name: 'Recurring', value: recurring.recurring },
                  { name: 'One-time', value: recurring.oneTime },
                ]}
                colors={['var(--warning)', 'var(--chart-debit)']}
              />
            </ChartCard>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Account / card spend" subtitle="Debit volume by payment rail">
              <SimpleBars
                data={accounts.map((a) => ({
                  label: labelCard(a.name),
                  value: a.debit,
                }))}
                dataKey="value"
                name="Spend"
                color="var(--chart-3)"
              />
            </ChartCard>
            <ChartCard
              title="Spending heatmap"
              subtitle="Weekday × day-of-month intensity"
              tall
            >
              <SpendHeatmap matrix={heat.matrix} max={heat.max} />
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
