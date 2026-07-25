import { useMemo } from 'react'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  DonutChart,
  HeatmapGrid,
  HorizontalBars,
  StackedAreaChart,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { CARD_TYPE_LABELS, type CardType } from '../types'
import { formatINR } from '../lib/format'

export function SpendingPage() {
  const { data, loading, error } = useFilters()
  const o = data?.overview

  const categoryKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of data?.category_monthly || []) {
      for (const k of Object.keys(row)) {
        if (k !== 'month') keys.add(k)
      }
    }
    return [...keys].slice(0, 8)
  }, [data?.category_monthly])

  const topCat = data?.by_category?.[0]

  return (
    <div className="fade-in">
      <PageHeader
        title="Spending Analysis"
        description="Category mix, merchant concentration, recurring charges, and calendar patterns."
      />
      <FilterBar />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <LoadingBlock />
      ) : o && data ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total spent" value={formatINR(o.total_debit)} tone="debit" />
            <KpiCard
              label="Top category"
              value={topCat?.name || '—'}
              hint={topCat ? formatINR(topCat.debit) : undefined}
            />
            <KpiCard
              label="Recurring spend"
              value={formatINR(data.recurring.recurring_amount)}
              hint="Merchants with 3+ debits"
            />
            <KpiCard
              label="One-time spend"
              value={formatINR(data.recurring.onetime_amount)}
              hint="Everything else"
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Category-wise expenses" subtitle="Donut of debit spend">
              <DonutChart
                data={data.by_category
                  .filter((c) => c.name !== 'Income')
                  .map((c) => ({ name: c.name, value: c.debit }))}
              />
            </ChartCard>
            <ChartCard title="Category trend" subtitle="Stacked monthly spend">
              <StackedAreaChart data={data.category_monthly} keys={categoryKeys} />
            </ChartCard>
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Top merchants" subtitle="Ranked by debit amount">
              <HorizontalBars
                data={data.merchants.map((m) => ({
                  name: m.merchant.length > 22 ? `${m.merchant.slice(0, 20)}…` : m.merchant,
                  value: m.amount,
                }))}
              />
            </ChartCard>
            <ChartCard title="Recurring vs one-time" subtitle="Split of debit volume">
              <DonutChart
                data={[
                  { name: 'Recurring', value: data.recurring.recurring_amount },
                  { name: 'One-time', value: data.recurring.onetime_amount },
                ]}
              />
            </ChartCard>
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Account / card-wise spend" subtitle="Debits by payment rail">
              <HorizontalBars
                data={data.by_card_type.map((r) => ({
                  name:
                    r.name in CARD_TYPE_LABELS
                      ? CARD_TYPE_LABELS[r.name as CardType]
                      : r.name,
                  value: r.debit,
                }))}
              />
            </ChartCard>
            <ChartCard title="Day-of-week spend" subtitle="Which weekdays leak money">
              <HorizontalBars
                data={data.weekday.map((d) => ({ name: d.day, value: d.amount }))}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Day-of-month spending heatmap"
            subtitle="Intensity by calendar day — brighter means heavier spend"
          >
            <HeatmapGrid cells={data.day_of_month} />
          </ChartCard>
        </>
      ) : null}
    </div>
  )
}
