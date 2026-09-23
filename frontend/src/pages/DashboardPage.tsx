import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { fetchAnalytics, fetchTransactions, updateTransactionCategory, deleteTransaction } from '../api'
import { DailyCashflowBars } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { LedgerAmount } from '../components/LedgerAmount'
import { TransactionRow } from '../components/TransactionTable'
import { formatDate, formatINR, nextSalaryPayday, toInputDate } from '../lib/format'
import { resolveSalarySourceLabel } from '../lib/salarySource'
import { DEFAULT_CATEGORIES, type AnalyticsPayload, type Transaction } from '../types'

type Period = 'day' | 'week' | 'month'

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const RECENT_LIMIT = 10

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

/** One calm sentence — what a money coach would say first. */
function coachLine(opts: {
  count: number
  debit: number
  credit: number
  net: number
  period: Period
}): string {
  const { count, debit, credit, net, period } = opts
  const scope = period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'
  if (count === 0) {
    return 'No bank alerts in this window yet — connect SMS, then confirm the first amount.'
  }
  if (credit === 0 && debit > 0) {
    return `Only outflows ${scope}. When salary lands, it should show as Received — if not, check Profile keywords.`
  }
  if (net < 0) {
    const gap = Math.abs(net)
    return `Outflow exceeds inflow by ${formatINR(gap)} ${scope}. Open Spending to see which categories drove it.`
  }
  if (net === 0) {
    return `In and out balanced ${scope}. Glance at Spending to confirm categories still look right.`
  }
  return `Surplus of ${formatINR(net)} ${scope}. Keep categories honest so this number stays trustworthy.`
}

/**
 * Home — trust pulse for the SMS ledger.
 * Job: “Am I okay?” → Spent / Received / Net + recent rows. Deep “where?” lives on Spending.
 */
export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => periodRange(period, anchor), [period, anchor])

  const canGoNext = useMemo(() => {
    const next = shiftAnchor(period, anchor, 1)
    return startOfDay(next) <= startOfDay(new Date())
  }, [period, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, t] = await Promise.all([
        fetchAnalytics({ date_from: range.from, date_to: range.to, lite: true }),
        fetchTransactions({
          date_from: range.from,
          date_to: range.to,
          limit: 80,
          sort: 'received_at',
          order: 'desc',
        }),
      ])
      setAnalytics(a)
      setTxns(t)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load home')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const overview = analytics?.overview
  const debit = overview?.total_debit ?? 0
  const credit = overview?.total_credit ?? 0
  const net = overview?.net ?? credit - debit
  const count = overview?.count ?? txns.length
  const debitCount = overview?.debit_count ?? 0
  const creditCount = overview?.credit_count ?? 0

  const chartData = useMemo(
    () => fillDailySeries(range.from, range.to, analytics?.daily || []),
    [range.from, range.to, analytics?.daily],
  )

  const recent = useMemo(() => txns.slice(0, RECENT_LIMIT), [txns])

  const insight = useMemo(
    () => coachLine({ count, debit, credit, net, period }),
    [count, debit, credit, net, period],
  )

  const upcomingCardDue = useMemo(() => {
    const today = startOfDay(new Date())
    const cards = (analytics?.liabilities || []).filter(
      (l) => (l.source || '') === 'credit_cards' && l.due_date && l.outstanding > 0,
    )
    let best: {
      name: string
      outstanding: number
      due_date: string
      days: number
    } | null = null
    for (const c of cards) {
      const dueStr = c.due_date!
      const due = startOfDay(new Date(dueStr.includes('T') ? dueStr : `${dueStr}T00:00:00`))
      if (Number.isNaN(due.getTime())) continue
      const days = Math.round((due.getTime() - today.getTime()) / 86400000)
      if (days < -3 || days > 21) continue
      if (!best || days < best.days) {
        best = {
          name: c.name,
          outstanding: c.outstanding,
          due_date: dueStr,
          days,
        }
      }
    }
    return best
  }, [analytics?.liabilities])

  const onCategoryChange = async (id: string, category: string) => {
    const res = await updateTransactionCategory(id, category)
    setTxns((prev) => prev.map((t) => (t._id === id ? { ...t, category } : t)))
    return {
      advisor_comment: res.advisor_comment,
      goal_impact: res.goal_impact,
    }
  }

  const onDelete = async (id: string) => {
    await deleteTransaction(id)
    setTxns((prev) => prev.filter((t) => t._id !== id))
    void load()
  }

  const pay = nextSalaryPayday()
  const expected =
    analytics?.overview?.expected_net_monthly ??
    (typeof analytics?.income_profile?.expected_net_monthly === 'number'
      ? analytics.income_profile.expected_net_monthly
      : null)
  const employer = resolveSalarySourceLabel(analytics)

  return (
    <div className="fade-in">
      <PageHeader
        title="Home"
        description="Your cash pulse — spent, received, and the latest bank alerts. Dig into categories on Spending."
        actions={
          <Link to="/spending" className="btn text-sm">
            Where it went
            <ArrowRight size={14} className="ml-1" />
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--sheet)] p-1 shadow-[var(--elev-1)]">
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
          <div className="elev-sheet mb-5 border-l-4 border-l-[var(--sapphire)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Read this first
            </p>
            <p className="mt-1 text-sm leading-snug text-[var(--text)]">{insight}</p>
          </div>

          <div className="elev-sheet mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 gap-3">
              <span
                className="block w-1 shrink-0 self-stretch rounded-sm bg-[var(--credit)]"
                aria-hidden
              />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Next salary
                </p>
                <p className="mt-0.5 text-base font-semibold text-[var(--text)]">
                  {pay.label}
                  <span className="ml-2 text-sm font-medium text-[var(--credit)]">
                    {pay.isToday
                      ? 'Expected today'
                      : pay.daysUntil === 1
                        ? 'Tomorrow'
                        : `In ${pay.daysUntil} days`}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {[
                    employer,
                    pay.rolledFromWeekend
                      ? '1st was a weekend → next business day'
                      : 'Usually 1st (or next business day if Sat/Sun)',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Expected</p>
              {expected ? (
                <LedgerAmount
                  amount={Number(expected)}
                  rail="wealth"
                  animate
                  size="md"
                  className="ml-auto justify-end"
                />
              ) : (
                <Link to="/profile" className="text-sm text-[var(--sapphire)] hover:underline">
                  Set in Profile
                </Link>
              )}
            </div>
          </div>

          {upcomingCardDue ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-3 shadow-[var(--elev-1)]">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Credit card due
                </p>
                <p className="text-sm font-medium">
                  {upcomingCardDue.name}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {upcomingCardDue.days < 0
                      ? `${Math.abs(upcomingCardDue.days)}d overdue`
                      : upcomingCardDue.days === 0
                        ? 'due today'
                        : `due in ${upcomingCardDue.days}d`}
                    {' · '}
                    {formatDate(
                      upcomingCardDue.due_date.includes('T')
                        ? upcomingCardDue.due_date
                        : `${upcomingCardDue.due_date}T00:00:00`,
                    )}
                  </span>
                </p>
              </div>
              <LedgerAmount
                amount={upcomingCardDue.outstanding}
                rail="debit"
                size="md"
                animate
                className="py-1"
              />
            </div>
          ) : null}

          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <KpiCard
              label="Spent"
              value={formatINR(debit)}
              amount={debit}
              tone="debit"
              animate
              hint={`${debitCount} debit${debitCount === 1 ? '' : 's'}`}
            />
            <KpiCard
              label="Received"
              value={formatINR(credit)}
              amount={credit}
              tone="credit"
              animate
              hint={`${creditCount} credit${creditCount === 1 ? '' : 's'}`}
            />
            <KpiCard
              label="Net"
              value={formatINR(net)}
              amount={net}
              tone={net >= 0 ? 'credit' : 'debit'}
              rail={net >= 0 ? 'wealth' : 'debit'}
              animate
              hint={net >= 0 ? 'Surplus' : 'Deficit'}
            />
          </div>

          {period !== 'day' && chartData.some((d) => d.debit > 0 || d.credit > 0) ? (
            <ChartCard
              title="Daily cash flow"
              subtitle="Green in · red out — a quick shape of the period"
              className="mb-5"
            >
              <DailyCashflowBars data={chartData} />
            </ChartCard>
          ) : null}

          <ChartCard
            title="Latest alerts"
            subtitle={
              count === 0
                ? 'Waiting for the first bank SMS'
                : `${recent.length} of ${count} in this period · newest first`
            }
            action={
              count > 0 ? (
                <Link to="/transactions" className="btn text-xs">
                  All transactions
                </Link>
              ) : null
            }
          >
            {recent.length === 0 ? (
              <div className="space-y-3 py-8 text-center">
                <p className="text-sm text-[var(--muted)]">
                  No transactions in this window. Trust starts with one correct SMS amount.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/accounts" className="btn btn-primary text-sm">
                    Connect phone / email
                  </Link>
                  <Link to="/getting-started" className="btn text-sm">
                    Setup guide
                  </Link>
                </div>
              </div>
            ) : (
              <div className="passbook-list elev-sheet overflow-hidden">
                {recent.map((txn) => (
                  <TransactionRow
                    key={txn._id}
                    txn={txn}
                    categories={DEFAULT_CATEGORIES}
                    onCategoryChange={onCategoryChange}
                    onDelete={onDelete}
                    variant="passbook"
                  />
                ))}
              </div>
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
}
