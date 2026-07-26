import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchAnalytics, fetchTransactions, updateTransactionCategory, deleteTransaction } from '../api'
import { DailyCashflowBars } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { TransactionRow } from '../components/TransactionTable'
import { formatDate, formatINR, toInputDate } from '../lib/format'
import { DEFAULT_CATEGORIES, type AnalyticsPayload, type Transaction } from '../types'

type Period = 'day' | 'week' | 'month'

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function startOfWeek(d: Date): Date {
  const s = startOfDay(d)
  const dow = (s.getDay() + 6) % 7 // Monday = 0
  return addDays(s, -dow)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function periodRange(period: Period, anchor: Date): { from: string; to: string; label: string } {
  const today = startOfDay(new Date())
  if (period === 'day') {
    const day = startOfDay(anchor)
    return {
      from: toInputDate(day),
      to: toInputDate(day),
      label: formatDate(`${toInputDate(day)}T12:00:00`),
    }
  }
  if (period === 'week') {
    const from = startOfWeek(anchor)
    const to = addDays(from, 6)
    const clippedTo = to > today ? today : to
    return {
      from: toInputDate(from),
      to: toInputDate(clippedTo),
      label: `${formatDate(`${toInputDate(from)}T12:00:00`)} – ${formatDate(`${toInputDate(clippedTo)}T12:00:00`)}`,
    }
  }
  const from = startOfMonth(anchor)
  const monthEnd = endOfMonth(anchor)
  const clippedTo = monthEnd > today ? today : monthEnd
  return {
    from: toInputDate(from),
    to: toInputDate(clippedTo),
    label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
  }
}

function shiftAnchor(period: Period, anchor: Date, dir: -1 | 1): Date {
  if (period === 'day') return addDays(startOfDay(anchor), dir)
  if (period === 'week') return addDays(startOfWeek(anchor), dir * 7)
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
}

function fillDailySeries(
  from: string,
  to: string,
  daily: AnalyticsPayload['daily'],
): Array<{ key: string; label: string; debit: number; credit: number; net: number }> {
  const byDate = new Map(daily.map((d) => [d.date.slice(0, 10), d]))
  const rows: Array<{ key: string; label: string; debit: number; credit: number; net: number }> = []
  let cur = startOfDay(new Date(from + 'T00:00:00'))
  const end = startOfDay(new Date(to + 'T00:00:00'))
  while (cur <= end) {
    const key = toInputDate(cur)
    const hit = byDate.get(key)
    rows.push({
      key,
      label: cur.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      debit: hit?.debit ?? 0,
      credit: hit?.credit ?? 0,
      net: hit?.net ?? 0,
    })
    cur = addDays(cur, 1)
  }
  return rows
}

function hourlySeries(
  txns: Transaction[],
): Array<{ key: string; label: string; debit: number; credit: number; net: number }> {
  const buckets = Array.from({ length: 24 }, (_, h) => ({
    key: String(h),
    label: `${String(h).padStart(2, '0')}:00`,
    debit: 0,
    credit: 0,
    net: 0,
  }))
  for (const t of txns) {
    const h = new Date(t.received_at).getHours()
    if (Number.isNaN(h) || h < 0 || h > 23) continue
    if (t.type === 'debit') buckets[h].debit += t.amount
    else buckets[h].credit += t.amount
    buckets[h].net = buckets[h].credit - buckets[h].debit
  }
  // Keep hours that have activity, plus a small padding around first/last
  const active = buckets.filter((b) => b.debit > 0 || b.credit > 0)
  if (!active.length) return buckets.slice(8, 22)
  const first = Number(active[0].key)
  const last = Number(active[active.length - 1].key)
  return buckets.slice(Math.max(0, first - 1), Math.min(24, last + 2))
}

function groupByDay(txns: Transaction[]): Array<{ day: string; items: Transaction[] }> {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const key = toInputDate(new Date(t.received_at))
    const list = map.get(key) || []
    list.push(t)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items }))
}

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('day')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const range = useMemo(() => periodRange(period, anchor), [period, anchor])

  const canGoNext = useMemo(() => {
    const next = shiftAnchor(period, anchor, 1)
    return startOfDay(next) <= startOfDay(new Date())
  }, [period, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, t] = await Promise.all([
        fetchAnalytics({ date_from: range.from, date_to: range.to }),
        fetchTransactions({
          date_from: range.from,
          date_to: range.to,
          limit: 200,
          sort: 'received_at',
          order: 'desc',
        }),
      ])
      setAnalytics(a)
      setTxns(t)
      setError(null)
      setSelectedDay(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const chartData = useMemo(() => {
    if (period === 'day') return hourlySeries(txns)
    return fillDailySeries(range.from, range.to, analytics?.daily || [])
  }, [period, txns, range.from, range.to, analytics?.daily])

  const visibleTxns = useMemo(() => {
    if (!selectedDay) return txns
    return txns.filter((t) => toInputDate(new Date(t.received_at)) === selectedDay)
  }, [txns, selectedDay])

  const grouped = useMemo(() => groupByDay(visibleTxns), [visibleTxns])

  const o = analytics?.overview
  const debit = o?.total_debit ?? 0
  const credit = o?.total_credit ?? 0
  const net = o?.net ?? credit - debit

  const onCategoryChange = async (id: string, category: string) => {
    await updateTransactionCategory(id, category)
    setTxns((prev) => prev.map((t) => (t._id === id ? { ...t, category } : t)))
  }

  const onDelete = async (id: string) => {
    await deleteTransaction(id)
    setTxns((prev) => prev.filter((t) => t._id !== id))
    void load()
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Dashboard"
        description="Daily activity at a glance — switch Day, Week, or Month and browse with the arrows."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                period === p.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
              onClick={() => {
                setPeriod(p.id)
                setAnchor(startOfDay(new Date()))
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn"
            aria-label="Previous period"
            onClick={() => setAnchor((a) => shiftAnchor(period, a, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <p className="min-w-[10rem] text-center text-sm font-medium tabular-nums">{range.label}</p>
          <button
            type="button"
            className="btn"
            aria-label="Next period"
            disabled={!canGoNext}
            onClick={() => setAnchor((a) => shiftAnchor(period, a, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !analytics ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Spent"
              value={formatINR(debit)}
              tone="debit"
              hint={`${o?.debit_count ?? 0} debit(s)`}
            />
            <KpiCard
              label="Received"
              value={formatINR(credit)}
              tone="credit"
              hint={`${o?.credit_count ?? 0} credit(s)`}
            />
            <KpiCard
              label="Net"
              value={formatINR(net)}
              tone={net >= 0 ? 'credit' : 'debit'}
              hint={net >= 0 ? 'Surplus' : 'Deficit'}
            />
            <KpiCard
              label="Transactions"
              value={String(o?.count ?? txns.length)}
              hint={
                period === 'day'
                  ? 'Today’s activity'
                  : period === 'week'
                    ? 'This week'
                    : 'This month'
              }
            />
          </div>

          <ChartCard
            title={period === 'day' ? 'Hourly cash flow' : 'Daily cash flow'}
            subtitle={
              period === 'day'
                ? 'Spend and income by hour'
                : selectedDay
                  ? `Showing ${formatDate(selectedDay + 'T00:00:00')} — click the chart again or Clear to reset`
                  : 'Click a bar to filter the list below'
            }
            className="mb-5"
            action={
              selectedDay ? (
                <button type="button" className="btn text-xs" onClick={() => setSelectedDay(null)}>
                  Clear filter
                </button>
              ) : null
            }
          >
            <DailyCashflowBars
              data={chartData}
              onPointClick={(key) => {
                if (period === 'day') return
                setSelectedDay((prev) => (prev === key ? null : key))
              }}
            />
          </ChartCard>

          <ChartCard
            title={selectedDay ? `Transactions · ${formatDate(selectedDay + 'T00:00:00')}` : 'Transactions'}
            subtitle={`${visibleTxns.length} shown · newest first`}
          >
            {visibleTxns.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                No transactions in this {period}.
              </p>
            ) : (
              <div className="space-y-4">
                {grouped.map(({ day, items }) => (
                  <div key={day}>
                    {period !== 'day' ? (
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                          {formatDate(day + 'T00:00:00')}
                        </p>
                        <p className="text-xs tabular-nums text-[var(--muted)]">
                          {items.length} txn
                          {items.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      {items.map((txn) => (
                        <TransactionRow
                          key={txn._id}
                          txn={txn}
                          categories={DEFAULT_CATEGORIES}
                          onCategoryChange={onCategoryChange}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
}
