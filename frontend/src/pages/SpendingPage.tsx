import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { LoadingBlock, PageHeader } from '../components/ui'
import { AnomalyFlags } from '../components/spending/AnomalyFlags'
import { BudgetVsActual } from '../components/spending/BudgetVsActual'
import { CategoryBreakdown } from '../components/spending/CategoryBreakdown'
import { MomCompareStrip } from '../components/spending/MomCompareStrip'
import { SpendingTrend } from '../components/spending/SpendingTrend'
import { SubscriptionsCard } from '../components/spending/SubscriptionsCard'
import { TopMerchants } from '../components/spending/TopMerchants'
import {
  lifestyleCategories,
  resolveAnomalies,
  resolveMomCompare,
} from '../components/spending/utils'

function buildTxnSearchUrl(opts: {
  merchant?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: string
}): string {
  const p = new URLSearchParams()
  if (opts.merchant) p.set('q', opts.merchant)
  if (opts.category) p.set('category', opts.category)
  if (opts.dateFrom) p.set('date_from', opts.dateFrom)
  if (opts.dateTo) p.set('date_to', opts.dateTo)
  if (opts.amountMin) p.set('amount_min', opts.amountMin)
  p.set('type', 'debit')
  const qs = p.toString()
  return qs ? `/transactions?${qs}` : '/transactions'
}

export function SpendingPage() {
  const navigate = useNavigate()
  const { data, loading, error, dateFrom, dateTo } = useFilters()

  const cats = useMemo(
    () => lifestyleCategories(data?.by_category_lifestyle, data?.by_category),
    [data?.by_category_lifestyle, data?.by_category],
  )

  const mom = useMemo(
    () => resolveMomCompare(data?.monthly, data?.mom),
    [data?.monthly, data?.mom],
  )

  const anomalies = useMemo(
    () =>
      resolveAnomalies({
        alerts: data?.alerts,
        categoryMonthly: data?.lifestyle_category_monthly?.length
          ? data.lifestyle_category_monthly
          : data?.category_monthly,
        lifestyleCats: cats,
      }),
    [data?.alerts, data?.lifestyle_category_monthly, data?.category_monthly, cats],
  )

  const openFindTxns = useCallback(
    (opts: { merchant?: string; category?: string; amountMin?: string }) => {
      navigate(
        buildTxnSearchUrl({
          ...opts,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      )
    },
    [navigate, dateFrom, dateTo],
  )

  const onCategoryClick = useCallback(
    (category: string) => openFindTxns({ category }),
    [openFindTxns],
  )

  const onMerchantClick = useCallback(
    (merchant: string) => openFindTxns({ merchant }),
    [openFindTxns],
  )

  const onAnomalyClick = useCallback(
    (item: { merchant?: string; category?: string; amount?: number }) => {
      const amountMin =
        item.amount != null && item.amount > 0
          ? String(Math.floor(item.amount * 0.95))
          : undefined
      openFindTxns({
        merchant: item.merchant || undefined,
        category: item.category || undefined,
        amountMin,
      })
    },
    [openFindTxns],
  )

  return (
    <div className="fade-in">
      <PageHeader
        title="Spending"
        description="Category mix, trends, merchants, budgets, and subscriptions for the selected range."
      />
      <FilterBar />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingBlock />
      ) : data ? (
        <>
          <MomCompareStrip compare={mom} />
          <CategoryBreakdown categories={cats} onCategoryClick={onCategoryClick} />
          <SpendingTrend daily={data.daily || []} />
          <TopMerchants merchants={data.merchants || []} onMerchantClick={onMerchantClick} />
          <BudgetVsActual budgets={data.budgets} categories={cats} />
          <SubscriptionsCard merchants={data.recurring?.merchants || []} />
          <AnomalyFlags items={anomalies} onAnomalyClick={onAnomalyClick} />
        </>
      ) : !error ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          No spending data for this range yet. Connect SMS or import a statement to see categories
          and merchants.
        </p>
      ) : null}
    </div>
  )
}
