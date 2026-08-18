import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchAnalytics, fetchTransactions, updateTransactionCategory, deleteTransaction } from '../api'
import { AdvisorVoiceBanner } from '../components/AdvisorVoiceBanner'
import { DailyCashflowBars } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { TransactionRow } from '../components/TransactionTable'
import { formatDate, formatINR, hasClockTime, hourInIST, nextSalaryPayday, toInputDate } from '../lib/format'
import { DEFAULT_CATEGORIES, type AnalyticsPayload, type Transaction } from '../types'

type Period = 'day' | 'week' | 'month' | 'year'

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
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

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31)
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
  if (period === 'year') {
    const from = startOfYear(anchor)
    const yearEnd = endOfYear(anchor)
    const clippedTo = yearEnd > today ? today : yearEnd
    return {
      from: toInputDate(from),
      to: toInputDate(clippedTo),
      label: String(from.getFullYear()),
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
  if (period === 'year') return new Date(anchor.getFullYear() + dir, 0, 1)
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

function fillMonthlySeries(
  year: number,
  to: string,
  monthly: AnalyticsPayload['monthly'],
): Array<{ key: string; label: string; debit: number; credit: number; net: number }> {
  const byMonth = new Map(monthly.map((m) => [m.month.slice(0, 7), m]))
  const lastMonth = to.slice(0, 7)
  const rows: Array<{ key: string; label: string; debit: number; credit: number; net: number }> = []
  for (let month = 0; month < 12; month++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`
    if (key > lastMonth) break
    const hit = byMonth.get(key)
    const labelDate = new Date(year, month, 1)
    rows.push({
      key,
      label: labelDate.toLocaleDateString('en-IN', { month: 'short' }),
      debit: hit?.debit ?? 0,
      credit: hit?.credit ?? 0,
      net: hit?.net ?? 0,
    })
  }
  return rows
}

function hourlySeries(
  txns: Transaction[],
): Array<{ key: string; label: string; debit: number; credit: number; net: number }> {
  const timed = txns.filter((t) => hasClockTime(t.received_at, t.source))
  // No real clock times (statement date-only) — don't invent hourly buckets
  if (!timed.length) return []

  const buckets = Array.from({ length: 24 }, (_, h) => ({
    key: String(h),
    label: `${String(h).padStart(2, '0')}:00`,
    debit: 0,
    credit: 0,
    net: 0,
  }))
  for (const t of timed) {
    const h = hourInIST(t.received_at)
    if (Number.isNaN(h) || h < 0 || h > 23) continue
    if (t.type === 'debit') buckets[h].debit += t.amount
    else buckets[h].credit += t.amount
    buckets[h].net = buckets[h].credit - buckets[h].debit
  }
  const active = buckets.filter((b) => b.debit > 0 || b.credit > 0)
  if (!active.length) return []
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

function groupByMonth(txns: Transaction[]): Array<{ month: string; items: Transaction[] }> {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const key = toInputDate(new Date(t.received_at)).slice(0, 7)
    const list = map.get(key) || []
    list.push(t)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => ({ month, items }))
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function endOfMonthDate(ym: string): Date {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0)
}

function startOfMonthYm(ym: string): Date {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function topSpendFromDaily(
  daily: Array<{ date: string; debit: number }>,
): { date: string; amount: number } | null {
  let best: { date: string; amount: number } | null = null
  for (const row of daily) {
    const amount = row.debit || 0
    if (!best || amount > best.amount) {
      best = { date: row.date.slice(0, 10), amount }
    }
  }
  return best && best.amount > 0 ? best : null
}

function summarizeTxns(rows: Transaction[]): {
  debit: number
  credit: number
  net: number
  count: number
  debitCount: number
  creditCount: number
  topSpend: { date: string; amount: number } | null
} {
  let debit = 0
  let credit = 0
  let debitCount = 0
  let creditCount = 0
  const byDay = new Map<string, number>()
  for (const t of rows) {
    if (t.type === 'debit') {
      debit += t.amount
      debitCount += 1
      const day = toInputDate(new Date(t.received_at))
      byDay.set(day, (byDay.get(day) || 0) + t.amount)
    } else {
      credit += t.amount
      creditCount += 1
    }
  }
  let topSpend: { date: string; amount: number } | null = null
  for (const [date, amount] of byDay) {
    if (!topSpend || amount > topSpend.amount) topSpend = { date, amount }
  }
  return {
    debit,
    credit,
    net: credit - debit,
    count: rows.length,
    debitCount,
    creditCount,
    topSpend,
  }
}

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('day')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
  const [monthAnalytics, setMonthAnalytics] = useState<AnalyticsPayload | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [monthTxns, setMonthTxns] = useState<Transaction[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

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
          limit: period === 'year' ? 500 : 200,
          sort: 'received_at',
          order: 'desc',
        }),
      ])
      setAnalytics(a)
      setTxns(t)
      setMonthTxns(null)
      setMonthAnalytics(null)
      setError(null)
      setSelectedKey(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, period])

  useEffect(() => {
    void load()
  }, [load])

  // Year view: clicking a month loads that month's analytics + transactions
  useEffect(() => {
    if (period !== 'year' || !selectedKey) {
      setMonthTxns(null)
      setMonthAnalytics(null)
      return
    }
    let cancelled = false
    const today = startOfDay(new Date())
    const from = startOfMonthYm(selectedKey)
    const monthEnd = endOfMonthDate(selectedKey)
    const to = monthEnd > today ? today : monthEnd
    const date_from = toInputDate(from)
    const date_to = toInputDate(to)
    setListLoading(true)
    setMonthTxns(null)
    setMonthAnalytics(null)
    void Promise.all([
      fetchAnalytics({ date_from, date_to }),
      fetchTransactions({
        date_from,
        date_to,
        limit: 500,
        sort: 'received_at',
        order: 'desc',
      }),
    ])
      .then(([a, rows]) => {
        if (cancelled) return
        setMonthAnalytics(a)
        setMonthTxns(rows)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load month')
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, selectedKey])

  const chartData = useMemo(() => {
    if (period === 'day') return hourlySeries(txns)
    if (period === 'year') {
      return fillMonthlySeries(anchor.getFullYear(), range.to, analytics?.monthly || [])
    }
    return fillDailySeries(range.from, range.to, analytics?.daily || [])
  }, [period, txns, range.from, range.to, analytics?.daily, analytics?.monthly, anchor])

  const visibleTxns = useMemo(() => {
    if (period === 'year' && selectedKey) return monthTxns ?? []
    if (!selectedKey) return txns
    return txns.filter((t) => toInputDate(new Date(t.received_at)) === selectedKey)
  }, [txns, monthTxns, selectedKey, period])

  const dayGroups = useMemo(() => groupByDay(visibleTxns), [visibleTxns])
  const monthGroups = useMemo(() => groupByMonth(txns), [txns])

  const kpi = useMemo(() => {
    // Year → selected month: use that month's analytics (or monthly row while loading)
    if (period === 'year' && selectedKey) {
      if (monthAnalytics?.overview) {
        const o = monthAnalytics.overview
        return {
          debit: o.total_debit,
          credit: o.total_credit,
          net: o.net,
          count: o.count,
          debitCount: o.debit_count,
          creditCount: o.credit_count,
          scopeHint: formatMonthLabel(selectedKey),
          topSpend: topSpendFromDaily(monthAnalytics.daily || []),
        }
      }
      const row = (analytics?.monthly || []).find((m) => m.month.slice(0, 7) === selectedKey)
      if (row) {
        return {
          debit: row.debit,
          credit: row.credit,
          net: row.net,
          count: row.count,
          debitCount: 0,
          creditCount: 0,
          scopeHint: formatMonthLabel(selectedKey),
          topSpend: null as { date: string; amount: number } | null,
        }
      }
    }

    // Week/Month → selected day: summarize that day's transactions
    if (period !== 'year' && period !== 'day' && selectedKey) {
      const dayRows = txns.filter((t) => toInputDate(new Date(t.received_at)) === selectedKey)
      const s = summarizeTxns(dayRows)
      return {
        ...s,
        scopeHint: formatDate(selectedKey + 'T00:00:00'),
        topSpend: s.debit > 0 ? { date: selectedKey, amount: s.debit } : null,
      }
    }

    const o = analytics?.overview
    return {
      debit: o?.total_debit ?? 0,
      credit: o?.total_credit ?? 0,
      net: o?.net ?? (o?.total_credit ?? 0) - (o?.total_debit ?? 0),
      count: o?.count ?? txns.length,
      debitCount: o?.debit_count ?? 0,
      creditCount: o?.credit_count ?? 0,
      scopeHint:
        period === 'day'
          ? 'Today’s activity'
          : period === 'week'
            ? 'This week'
            : period === 'year'
              ? 'This year'
              : 'This month',
      topSpend: topSpendFromDaily(analytics?.daily || []),
    }
  }, [period, selectedKey, monthAnalytics, analytics, txns])

  const debit = kpi.debit
  const credit = kpi.credit
  const net = kpi.net

  const onCategoryChange = async (id: string, category: string) => {
    const res = await updateTransactionCategory(id, category)
    setTxns((prev) => prev.map((t) => (t._id === id ? { ...t, category } : t)))
    setMonthTxns((prev) => (prev ? prev.map((t) => (t._id === id ? { ...t, category } : t)) : prev))
    return {
      advisor_comment: res.advisor_comment,
      goal_impact: res.goal_impact,
    }
  }

  const onDelete = async (id: string) => {
    await deleteTransaction(id)
    setTxns((prev) => prev.filter((t) => t._id !== id))
    setMonthTxns((prev) => (prev ? prev.filter((t) => t._id !== id) : prev))
    void load()
  }

  const selectChartKey = (key: string) => {
    setSelectedKey((prev) => (prev === key ? null : key))
  }

  const chartTitle =
    period === 'day' ? 'Hourly cash flow (IST)' : period === 'year' ? 'Monthly cash flow' : 'Daily cash flow'

  const dayHasClockTimes = useMemo(
    () => period === 'day' && txns.some((t) => hasClockTime(t.received_at, t.source)),
    [period, txns],
  )

  const filterLabel =
    selectedKey == null
      ? null
      : period === 'year'
        ? formatMonthLabel(selectedKey)
        : formatDate(selectedKey + 'T12:00:00+05:30')

  return (
    <div className="fade-in">
      <PageHeader
        title="Dashboard"
        description="Daily activity at a glance — switch Day, Week, Month, or Year and browse with the arrows."
      />

      {analytics?.advisor ? <AdvisorVoiceBanner advisor={analytics.advisor} /> : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                period === p.id
                  ? 'seg-active'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
              onClick={() => {
                setPeriod(p.id)
                setAnchor(startOfDay(new Date()))
                setSelectedKey(null)
                setMonthTxns(null)
                setMonthAnalytics(null)
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
          {(() => {
            const pay = nextSalaryPayday()
            const expected =
              analytics?.overview?.expected_net_monthly ??
              (typeof analytics?.income_profile?.expected_net_monthly === 'number'
                ? analytics.income_profile.expected_net_monthly
                : null)
            const employer =
              analytics?.overview?.employer ||
              (typeof analytics?.income_profile?.employer === 'string'
                ? analytics.income_profile.employer
                : 'IDEA ELAN')
            const when =
              pay.isToday
                ? 'Expected today'
                : pay.daysUntil === 1
                  ? 'Tomorrow'
                  : `In ${pay.daysUntil} days`
            return (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--credit)]/25 bg-[var(--credit-soft)] px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Next salary
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-[var(--text)]">
                    {pay.label}
                    <span className="ml-2 text-sm font-medium text-[var(--credit)]">{when}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {employer}
                    {pay.rolledFromWeekend
                      ? ' · 1st was a weekend → next business day'
                      : ' · Usually 1st (or next business day if Sat/Sun)'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Expected</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--credit)]">
                    {expected ? formatINR(Number(expected)) : '—'}
                  </p>
                  {analytics?.overview?.ctc_lpa ? (
                    <p className="text-[11px] text-[var(--muted)]">
                      CTC ₹{analytics.overview.ctc_lpa} LPA
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })()}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Spent"
              value={formatINR(debit)}
              tone="debit"
              hint={`${kpi.debitCount} debit(s)${filterLabel ? ` · ${filterLabel}` : ''}`}
            />
            <KpiCard
              label="Received"
              value={formatINR(credit)}
              tone="credit"
              hint={`${kpi.creditCount} credit(s)${filterLabel ? ` · ${filterLabel}` : ''}`}
            />
            <KpiCard
              label="Net"
              value={formatINR(net)}
              tone={net >= 0 ? 'credit' : 'debit'}
              hint={net >= 0 ? 'Surplus' : 'Deficit'}
            />
            <KpiCard
              label="Transactions"
              value={String(kpi.count)}
              hint={kpi.scopeHint}
            />
            <KpiCard
              label="Top spend day"
              value={kpi.topSpend ? formatINR(kpi.topSpend.amount) : '—'}
              tone="debit"
              hint={
                kpi.topSpend
                  ? formatDate(kpi.topSpend.date + 'T00:00:00')
                  : 'No debit days in range'
              }
            />
          </div>

          <ChartCard
            title={chartTitle}
            subtitle={
              period === 'day'
                ? dayHasClockTimes
                  ? 'Spend and income by hour · India time (IST)'
                  : 'No SMS clock times today — statement rows are date-only'
                : period === 'year'
                  ? filterLabel
                    ? `Showing ${filterLabel} — click again or Clear to reset`
                    : 'Click a month to open its transactions'
                  : filterLabel
                    ? `Showing ${filterLabel} — click again or Clear to reset`
                    : 'Click a bar to filter the list below'
            }
            className="mb-5"
            action={
              selectedKey ? (
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => {
                    setSelectedKey(null)
                    setMonthTxns(null)
                    setMonthAnalytics(null)
                  }}
                >
                  Clear filter
                </button>
              ) : null
            }
          >
            <DailyCashflowBars
              data={chartData}
              selectedKey={selectedKey}
              onPointClick={(key) => {
                if (period === 'day') return
                selectChartKey(key)
              }}
            />
          </ChartCard>

          <ChartCard
            title={filterLabel ? `Transactions · ${filterLabel}` : 'Transactions'}
            subtitle={
              listLoading
                ? 'Loading month…'
                : `${visibleTxns.length} shown · newest first`
            }
          >
            {listLoading ? (
              <LoadingBlock />
            ) : visibleTxns.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                No transactions in this {period === 'year' && selectedKey ? 'month' : period}.
              </p>
            ) : period === 'year' && !selectedKey ? (
              <div className="space-y-6">
                {monthGroups.map(({ month, items }) => {
                  const monthDebit = items
                    .filter((t) => t.type === 'debit')
                    .reduce((s, t) => s + t.amount, 0)
                  const monthCredit = items
                    .filter((t) => t.type === 'credit')
                    .reduce((s, t) => s + t.amount, 0)
                  return (
                    <div key={month}>
                      <button
                        type="button"
                        className="mb-2 flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface-2)]"
                        onClick={() => setSelectedKey(month)}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                          {formatMonthLabel(month)}
                        </p>
                        <p className="text-xs tabular-nums text-[var(--muted)]">
                          <span className="text-[var(--debit)]">{formatINR(monthDebit)}</span>
                          {' · '}
                          <span className="text-[var(--credit)]">{formatINR(monthCredit)}</span>
                          {' · '}
                          {items.length} txn{items.length === 1 ? '' : 's'}
                        </p>
                      </button>
                      <div className="space-y-2">
                        {items.slice(0, 8).map((txn) => (
                          <TransactionRow
                            key={txn._id}
                            txn={txn}
                            categories={DEFAULT_CATEGORIES}
                            onCategoryChange={onCategoryChange}
                            onDelete={onDelete}
                          />
                        ))}
                        {items.length > 8 ? (
                          <button
                            type="button"
                            className="btn w-full text-xs"
                            onClick={() => setSelectedKey(month)}
                          >
                            View all in {formatMonthLabel(month)}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-4">
                {dayGroups.map(({ day, items }) => (
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
