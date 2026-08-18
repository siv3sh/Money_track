import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  DonutChart,
  HeatmapGrid,
  HorizontalBars,
  StackedAreaChart,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { AdvisorVoiceBanner } from '../components/AdvisorVoiceBanner'
import { CARD_TYPE_LABELS, type CardType } from '../types'
import { formatINR } from '../lib/format'
import { transactionsHref } from '../lib/transactionsLink'

export function SpendingPage() {
  const navigate = useNavigate()
  const { data, loading, error, dateFrom, dateTo } = useFilters()
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
  const periodLink = transactionsHref({
    type: 'debit',
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  })

  return (
    <div className="fade-in">
      <PageHeader
        title="Spending Analysis"
        description="Lifestyle spend excludes Transfers and Investments. Click a category or merchant to open matching transactions."
      />
      <FilterBar />
      {data?.advisor ? <AdvisorVoiceBanner advisor={data.advisor} /> : null}

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
              label="Bank / UPI spend"
              value={formatINR(o.bank_upi_spend ?? Math.max((o.lifestyle_spend ?? 0) - (o.credit_card_spend ?? 0), 0))}
              tone="debit"
              hint="Lifestyle excluding credit cards"
              to={periodLink}
            />
            <KpiCard
              label="Credit card spend"
              value={formatINR(o.credit_card_spend ?? 0)}
              tone="debit"
              hint={
                o.credit_card_count
                  ? `${o.credit_card_count} card purchase(s) · ICICI style SMS`
                  : 'From “spent using … Card” SMS'
              }
              to={transactionsHref({
                type: 'debit',
                card_type: 'credit_card',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            {data.smart?.spend_forecast ? (
              <KpiCard
                label="Month pace"
                value={formatINR(data.smart.spend_forecast.projected_month)}
                tone={
                  data.smart.spend_forecast.status === 'over'
                    ? 'debit'
                    : data.smart.spend_forecast.status === 'under'
                      ? 'credit'
                      : 'neutral'
                }
                hint={
                  data.smart.spend_forecast.usual_month
                    ? `vs usual ${formatINR(data.smart.spend_forecast.usual_month)}${
                        data.smart.spend_forecast.pace_pct != null
                          ? ` (${data.smart.spend_forecast.pace_pct}%)`
                          : ''
                      }`
                    : data.smart.spend_forecast.message
                }
              />
            ) : null}
            <KpiCard
              label="All lifestyle"
              value={formatINR(o.lifestyle_spend ?? o.total_debit)}
              hint={`Bank/UPI ${formatINR(o.bank_upi_spend ?? 0)} + card ${formatINR(o.credit_card_spend ?? 0)}`}
              to={periodLink}
            />
          </div>

          {(data.credit_card?.merchants?.length || 0) > 0 ? (
            <ChartCard
              title="Credit card purchases"
              subtitle={`${data.credit_card?.count || 0} txn(s) · total ${formatINR(data.credit_card?.total || 0)} — separate from bank/UPI`}
              className="mb-5"
            >
              <div className="mb-3">
                <HorizontalBars
                  data={(data.credit_card?.merchants || []).map((m) => ({
                    name: m.merchant.length > 28 ? `${m.merchant.slice(0, 26)}…` : m.merchant,
                    value: m.amount,
                  }))}
                  color="var(--debit)"
                  onBarClick={(name) => {
                    const full =
                      data.credit_card?.merchants.find(
                        (m) => m.merchant === name || m.merchant.startsWith(name.replace(/…$/, '')),
                      )?.merchant || name.replace(/…$/, '')
                    navigate(
                      transactionsHref({
                        q: full,
                        type: 'debit',
                        card_type: 'credit_card',
                        date_from: dateFrom || undefined,
                        date_to: dateTo || undefined,
                      }),
                    )
                  }}
                />
              </div>
              <ul className="divide-y divide-[var(--border)] text-sm">
                {(data.credit_card?.merchants || []).map((m) => (
                  <li key={m.merchant} className="flex items-center justify-between py-2">
                    <span>
                      {m.merchant}
                      <span className="ml-2 text-xs text-[var(--muted)]">×{m.count}</span>
                    </span>
                    <span className="tabular-nums text-[var(--debit)]">{formatINR(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </ChartCard>
          ) : (
            <div className="mb-5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--muted)]">
              No credit-card purchases in this range yet. ICICI “spent using … Card XX####” SMS are
              tagged as credit card automatically.
            </div>
          )}

          {(data.wallet?.count || 0) > 0 ? (
            <ChartCard
              title="Wallet / FASTag spends (not counted)"
              subtitle={`${data.wallet?.count || 0} txn(s) · ${formatINR(data.wallet?.total || 0)} — money already left your bank at recharge time, so these are excluded from all totals`}
              className="mb-5"
            >
              <ul className="divide-y divide-[var(--border)] text-sm">
                {(data.wallet?.recent || []).map((w, i) => (
                  <li key={`${w.merchant}-${i}`} className="flex items-center justify-between py-2">
                    <span>
                      {w.merchant}
                      {w.received_at ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {new Date(w.received_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-[var(--muted)]">{formatINR(w.amount)}</span>
                  </li>
                ))}
              </ul>
            </ChartCard>
          ) : null}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="All bank debits"
              value={formatINR(o.total_debit)}
              hint={`Transfers ${formatINR(o.transfers_debit ?? 0)} · Invest ${formatINR(o.investments_debit ?? 0)}`}
              to={transactionsHref({
                type: 'debit',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            <KpiCard
              label="Top lifestyle category"
              value={topCat?.name || '—'}
              hint={topCat ? formatINR(topCat.debit) : undefined}
              to={
                topCat
                  ? transactionsHref({
                      category: topCat.name,
                      type: 'debit',
                      date_from: dateFrom || undefined,
                      date_to: dateTo || undefined,
                    })
                  : undefined
              }
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
              subtitle="Click a slice to view transactions"
            >
              <DonutChart
                data={lifestyleCats.map((c) => ({ name: c.name, value: c.debit }))}
                onSliceClick={(name) =>
                  navigate(
                    transactionsHref({
                      category: name,
                      type: 'debit',
                      date_from: dateFrom || undefined,
                      date_to: dateTo || undefined,
                    }),
                  )
                }
              />
            </ChartCard>
            <ChartCard
              title="Lifestyle category trend"
              subtitle="Stacked monthly (excludes transfers & investments)"
            >
              <StackedAreaChart data={lifestyleMonthly} keys={categoryKeys} />
            </ChartCard>
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Top merchants" subtitle="Click a bar to search transactions">
              <HorizontalBars
                data={data.merchants.map((m) => ({
                  name: m.merchant.length > 22 ? `${m.merchant.slice(0, 20)}…` : m.merchant,
                  value: m.amount,
                  full: m.merchant,
                }))}
                onBarClick={(name) => {
                  const full =
                    data.merchants.find(
                      (m) => m.merchant === name || m.merchant.startsWith(name.replace(/…$/, '')),
                    )?.merchant || name.replace(/…$/, '')
                  navigate(
                    transactionsHref({
                      q: full,
                      type: 'debit',
                      date_from: dateFrom || undefined,
                      date_to: dateTo || undefined,
                    }),
                  )
                }}
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
