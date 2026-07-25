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

  const lifestyleCats = data?.by_category_lifestyle?.length
    ? data.by_category_lifestyle
    : (data?.by_category || []).filter(
        (c) => !['Transfers', 'Investments', 'Income'].includes(c.name) && c.debit > 0,
      )

  const lifestyleMonthly = data?.lifestyle_category_monthly?.length
    ? data.lifestyle_category_monthly
    : data?.category_monthly || []

  const categoryKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of lifestyleMonthly) {
      for (const k of Object.keys(row)) {
        if (k !== 'month' && !['Transfers', 'Investments', 'Income'].includes(k)) {
          keys.add(k)
        }
      }
    }
    return [...keys].slice(0, 8)
  }, [lifestyleMonthly])

  const topCat = lifestyleCats[0]

  return (
    <div className="fade-in">
      <PageHeader
        title="Spending Analysis"
        description="Lifestyle spend excludes Transfers and Investments so self-moves and SIPs don’t look like shopping."
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
            <KpiCard
              label="Lifestyle spend"
              value={formatINR(o.lifestyle_spend ?? o.total_debit)}
              tone="debit"
              hint="Excludes transfers & investments"
            />
            <KpiCard
              label="All bank debits"
              value={formatINR(o.total_debit)}
              hint={`Transfers ${formatINR(o.transfers_debit ?? 0)} · Invest ${formatINR(o.investments_debit ?? 0)}`}
            />
            <KpiCard
              label="Top lifestyle category"
              value={topCat?.name || '—'}
              hint={topCat ? formatINR(topCat.debit) : undefined}
            />
            <KpiCard
              label="Avg daily lifestyle"
              value={formatINR(o.avg_daily_lifestyle ?? o.avg_daily_debit)}
              hint={`${o.active_days} active days`}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Lifestyle categories"
              subtitle="Transfers & Investments excluded"
            >
              <DonutChart
                data={lifestyleCats.map((c) => ({ name: c.name, value: c.debit }))}
              />
            </ChartCard>
            <ChartCard title="Lifestyle category trend" subtitle="Stacked monthly (excludes transfers & investments)">
              <StackedAreaChart data={lifestyleMonthly} keys={categoryKeys} />
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
