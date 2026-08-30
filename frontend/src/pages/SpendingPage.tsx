import { useCallback, useMemo, useRef, useState } from 'react'
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
import { TxnSearchPanel } from '../components/spending/TxnSearchPanel'
import {
  EMPTY_SEARCH_FILTERS,
  lifestyleCategories,
  resolveAnomalies,
  resolveMomCompare,
  type SpendingSearchFilters,
} from '../components/spending/utils'

export function SpendingPage() {
  const { data, loading, error, dateFrom, dateTo } = useFilters()
  const [searchFilters, setSearchFilters] = useState<SpendingSearchFilters>(EMPTY_SEARCH_FILTERS)
  const [applyRequest, setApplyRequest] = useState<{
    id: number
    filters: SpendingSearchFilters
  } | null>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)

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

  const pushToSearch = useCallback(
    (patch: Partial<SpendingSearchFilters>) => {
      const next: SpendingSearchFilters = {
        ...EMPTY_SEARCH_FILTERS,
        dateFrom: dateFrom || '',
        dateTo: dateTo || '',
        ...patch,
      }
      setSearchFilters(next)
      setApplyRequest({ id: Date.now(), filters: next })
      requestAnimationFrame(() => {
        searchPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [dateFrom, dateTo],
  )

  const onCategoryClick = useCallback(
    (category: string) => pushToSearch({ category, merchant: '' }),
    [pushToSearch],
  )

  const onMerchantClick = useCallback(
    (merchant: string) => pushToSearch({ merchant, category: '' }),
    [pushToSearch],
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
          <AnomalyFlags items={anomalies} />
          <TxnSearchPanel
            filters={searchFilters}
            onFiltersChange={setSearchFilters}
            applyRequest={applyRequest}
            categoryOptions={cats.map((c) => c.name)}
            panelRef={searchPanelRef}
          />
        </>
      ) : null}
    </div>
  )
}
