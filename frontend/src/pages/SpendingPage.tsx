import { useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
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
import { formatINR } from '../lib/format'

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

/** One coaching line from MoM + top category — not noise. */
function spendingCoach(opts: {
  totalDebit: number
  topCategory: string | null
  topShare: number | null
  momPct: number | null
}): string {
  const { totalDebit, topCategory, topShare, momPct } = opts
  if (totalDebit <= 0) {
    return 'No lifestyle spend in this range yet. Once SMS lands, categories tell you where money actually went.'
  }
  const parts: string[] = []
  if (topCategory && topShare != null) {
    parts.push(`${topCategory} is ${topShare}% of spend`)
  }
  if (momPct != null) {
    if (momPct > 8) parts.push(`${momPct}% higher than last month`)
    else if (momPct < -8) parts.push(`${Math.abs(momPct)}% lower than last month`)
    else parts.push('roughly flat vs last month')
  }
  if (!parts.length) return `Lifestyle spend ${formatINR(totalDebit)} — tap a category to audit the rows.`
  return `${parts.join(' · ')}. Tap a slice to open those transactions.`
}

/**
 * Spending — “where did it go?”
 * Order: story (MoM) → categories → merchants → trend → budgets/subs/anomalies only when useful.
 */
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

  const totalDebit = useMemo(() => cats.reduce((s, c) => s + c.debit, 0), [cats])
  const top = cats[0]
  const topShare =
    top && totalDebit > 0 ? Math.round((top.debit / totalDebit) * 1000) / 10 : null

  const insight = useMemo(
    () =>
      spendingCoach({
        totalDebit,
        topCategory: top?.name ?? null,
        topShare,
        momPct: mom?.pct ?? null,
      }),
    [totalDebit, top?.name, topShare, mom?.pct],
  )

  const budgetEntries = Object.entries(data?.budgets || {}).filter(([, amt]) => Number(amt) > 0)
  const recurring = data?.recurring?.merchants || []

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
        description="Where the money went — categories first, then merchants. Click anything to open the ledger rows."
        actions={
          <Link to="/dashboard" className="btn text-sm">
            Back to Home
          </Link>
        }
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
          <div className="elev-sheet mb-5 border-l-4 border-l-[var(--debit)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              The story
            </p>
            <p className="mt-1 text-sm leading-snug text-[var(--text)]">{insight}</p>
            {totalDebit > 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Lifestyle spend {formatINR(totalDebit)}
                {dateFrom && dateTo ? ` · ${dateFrom} → ${dateTo}` : ''}
              </p>
            ) : null}
          </div>

          <MomCompareStrip compare={mom} />
          <CategoryBreakdown categories={cats} onCategoryClick={onCategoryClick} />
          <TopMerchants merchants={data.merchants || []} onMerchantClick={onMerchantClick} />
          <SpendingTrend daily={data.daily || []} />

          {budgetEntries.length > 0 ? (
            <BudgetVsActual budgets={data.budgets} categories={cats} />
          ) : (
            <p className="mb-5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--sheet)] px-4 py-3 text-sm text-[var(--muted)]">
              Optional:{' '}
              <Link to="/profile" className="font-medium text-[var(--sapphire)] hover:underline">
                set category budgets in Profile
              </Link>{' '}
              if you want soft caps here.
            </p>
          )}

          {recurring.length > 0 ? <SubscriptionsCard merchants={recurring} /> : null}

          {anomalies.length > 0 ? (
            <AnomalyFlags items={anomalies} onAnomalyClick={onAnomalyClick} />
          ) : null}

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-3 text-sm">
            <p className="text-[var(--muted)]">See a wrong category? Fix it on the row.</p>
            <Link to="/transactions?type=debit" className="inline-flex items-center gap-1 font-medium text-[var(--sapphire)] hover:underline">
              Open transactions
              <ArrowRight size={14} />
            </Link>
          </div>
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
