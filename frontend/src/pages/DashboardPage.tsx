import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, Clock3, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import {
  deleteTransaction,
  fetchDetailedReport,
  fetchMerchants,
  fetchMonthly,
  fetchTransactions,
  updateTransactionCategory,
} from '../api'
import {
  DailyCashflowChart,
  DonutBreakdownChart,
  MerchantHorizontalChart,
  MonthlyCashflowChart,
  WeekdaySpendChart,
} from '../components/ReportCharts'
import { TransactionTable, type Filters } from '../components/TransactionTable'
import { formatINR } from '../lib/format'
import type { DetailedReport, MerchantSpend, MonthlyBucket, Transaction } from '../types'

const PAGE_SIZE = 25

type Period = 'today' | 'week' | 'month' | 'recent'

function toInputDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function periodRange(period: Period): { from?: string; to?: string; label: string } {
  const today = new Date()
  const end = toInputDate(today)
  switch (period) {
    case 'today':
      return { from: end, to: end, label: 'Today' }
    case 'week': {
      const start = new Date(today)
      start.setDate(today.getDate() - 6)
      return { from: toInputDate(start), to: end, label: 'Last 7 days' }
    }
    case 'month':
      return {
        from: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: end,
        label: 'This month',
      }
    case 'recent':
      return { label: 'Recent activity' }
    default: {
      const exhaustive: never = period
      return exhaustive
    }
  }
}

function Kpi({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'debit' | 'credit' | 'neutral'
  icon: ReactNode
}) {
  const color =
    tone === 'debit'
      ? 'text-[var(--debit)]'
      : tone === 'credit'
        ? 'text-[var(--credit)]'
        : 'text-[var(--text)]'
  return (
    <div className="panel relative overflow-hidden px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            {label}
          </p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
        </div>
        <span className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--muted)]">{icon}</span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('week')
  const [report, setReport] = useState<DetailedReport | null>(null)
  const [monthly, setMonthly] = useState<MonthlyBucket[]>([])
  const [merchants, setMerchants] = useState<MerchantSpend[]>([])
  const [rows, setRows] = useState<Transaction[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingTable, setLoadingTable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tableFilters, setTableFilters] = useState<
    Pick<Filters, 'card_type' | 'type' | 'category' | 'sort' | 'order'>
  >({
    card_type: '',
    type: '',
    category: '',
    sort: 'received_at',
    order: 'desc',
  })

  const range = useMemo(() => periodRange(period), [period])

  const filters: Filters = useMemo(
    () => ({
      ...tableFilters,
      date_from: range.from || '',
      date_to: range.to || '',
    }),
    [range.from, range.to, tableFilters],
  )

  const loadDash = useCallback(async () => {
    setLoading(true)
    try {
      const [rep, mon, mer] = await Promise.all([
        fetchDetailedReport({
          date_from: range.from,
          date_to: range.to,
          merchant_limit: 12,
        }),
        fetchMonthly(6),
        fetchMerchants(8),
      ])
      setReport(rep)
      setMonthly(mon)
      setMerchants(mer)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  const loadTransactions = useCallback(async () => {
    setLoadingTable(true)
    try {
      const dateTo = filters.date_to ? `${filters.date_to}T23:59:59.999Z` : undefined
      const dateFrom = filters.date_from ? `${filters.date_from}T00:00:00.000Z` : undefined
      const data = await fetchTransactions({
        limit: PAGE_SIZE + 1,
        skip: page * PAGE_SIZE,
        card_type: filters.card_type || undefined,
        category: filters.category || undefined,
        type: filters.type || undefined,
        date_from: dateFrom,
        date_to: dateTo,
        sort: filters.sort,
        order: filters.order,
      })
      setHasMore(data.length > PAGE_SIZE)
      setRows(data.slice(0, PAGE_SIZE))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setLoadingTable(false)
    }
  }, [filters, page])

  useEffect(() => {
    void loadDash()
  }, [loadDash])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  const o = report?.overview
  const topMerchant = report?.merchants[0]
  const busiestDay = report?.weekday.reduce<(typeof report.weekday)[number] | null>(
    (best, day) => (!best || day.amount > best.amount ? day : best),
    null,
  )

  const merchantChartData = (report?.merchants?.length ? report.merchants : merchants).map((m) => {
    const withShare = m as MerchantSpend & { share?: number; avg?: number }
    return {
      merchant: m.merchant,
      amount: m.amount,
      count: m.count,
      share: withShare.share ?? 0,
      avg: withShare.avg ?? (m.count ? m.amount / m.count : 0),
    }
  })

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Money flow overview</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Switch between today, this week, this month, or recent activity
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            {(
              [
                ['today', 'Today'],
                ['week', 'This week'],
                ['month', 'This month'],
                ['recent', 'Recent'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  period === id
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
                onClick={() => {
                  setPeriod(id)
                  setPage(0)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void loadDash()
              void loadTransactions()
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/35 bg-[var(--debit)]/10 px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <p className="text-sm text-[var(--muted)]">Loading dashboard…</p>
      ) : o ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={`${range.label} · spent`}
              value={formatINR(o.total_debit)}
              hint={`${o.debit_count} debit transactions`}
              tone="debit"
              icon={<TrendingDown size={18} />}
            />
            <Kpi
              label={`${range.label} · received`}
              value={formatINR(o.total_credit)}
              hint={`${o.credit_count} credit transactions`}
              tone="credit"
              icon={<TrendingUp size={18} />}
            />
            <Kpi
              label="Net cash flow"
              value={formatINR(o.net)}
              hint={o.net >= 0 ? 'Surplus in this period' : 'Spending ahead of income'}
              tone={o.net >= 0 ? 'credit' : 'debit'}
              icon={<Wallet size={18} />}
            />
            <Kpi
              label="Avg daily spend"
              value={formatINR(o.avg_daily_debit)}
              hint={`${o.active_days} active days · ${o.count} total txns`}
              icon={<CalendarDays size={18} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <article className="panel px-5 py-4">
              <p className="text-xs font-medium text-[var(--muted)]">Top spend destination</p>
              <p className="mt-2 truncate text-base font-semibold">
                {topMerchant?.merchant || 'Not enough data'}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {topMerchant
                  ? `${formatINR(topMerchant.amount)} · ${topMerchant.share}% of spend`
                  : 'Import a statement or wait for SMS capture'}
              </p>
            </article>
            <article className="panel px-5 py-4">
              <p className="text-xs font-medium text-[var(--muted)]">Heaviest weekday</p>
              <p className="mt-2 text-base font-semibold">{busiestDay?.day || '—'}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {busiestDay
                  ? `${formatINR(busiestDay.amount)} across ${busiestDay.count} transactions`
                  : 'No weekday pattern yet'}
              </p>
            </article>
            <article className="panel px-5 py-4">
              <p className="text-xs font-medium text-[var(--muted)]">Largest single expense</p>
              <p className="mt-2 text-base font-semibold text-[var(--debit)]">
                {formatINR(o.max_debit)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Watch large one-offs — they skew weekly averages
              </p>
            </article>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="panel p-4 xl:col-span-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                    {period === 'month' || period === 'recent'
                      ? 'Monthly cash flow'
                      : 'Day-by-day cash flow'}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Income vs expenses so you can spot spikes quickly
                  </p>
                </div>
                <Clock3 size={16} className="text-[var(--muted)]" />
              </div>
              {period === 'month' || period === 'recent' ? (
                <MonthlyCashflowChart data={monthly} />
              ) : (
                <DailyCashflowChart data={report?.daily || []} />
              )}
            </section>

            <section className="panel p-4">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Spend by weekday
              </h3>
              <p className="mb-2 text-xs text-[var(--muted)]">Where the week leaks money</p>
              <WeekdaySpendChart data={report?.weekday || []} />
            </section>

            <section className="panel p-4">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Spend by category
              </h3>
              <p className="mb-2 text-xs text-[var(--muted)]">MCC + keyword classification</p>
              <DonutBreakdownChart data={report?.by_category || []} />
            </section>

            <section className="panel p-4 xl:col-span-2">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Top merchants
              </h3>
              <p className="mb-2 text-xs text-[var(--muted)]">
                Concentrate cuts on the bars that dominate spend
              </p>
              <MerchantHorizontalChart data={merchantChartData} />
            </section>
          </div>
        </>
      ) : null}

      <section>
        <div className="mb-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            {range.label} · transactions
          </h3>
          <p className="text-xs text-[var(--muted)]">Newest first · expand a row for full SMS</p>
        </div>
        <TransactionTable
          rows={rows}
          filters={filters}
          page={page}
          pageSize={PAGE_SIZE}
          hasMore={hasMore}
          loading={loadingTable}
          onFiltersChange={(next) => {
            setPage(0)
            setTableFilters({
              card_type: next.card_type,
              type: next.type,
              category: next.category,
              sort: next.sort,
              order: next.order,
            })
          }}
          onPageChange={setPage}
          onDelete={(id) => {
            void (async () => {
              try {
                await deleteTransaction(id)
                await Promise.all([loadDash(), loadTransactions()])
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed')
              }
            })()
          }}
          onCategoryChange={(id, category) => {
            void (async () => {
              try {
                const res = await updateTransactionCategory(id, category, true)
                setRows((prev) =>
                  prev.map((row) => (row._id === id ? { ...row, ...res.transaction } : row)),
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Category update failed')
              }
            })()
          }}
        />
      </section>
    </div>
  )
}
