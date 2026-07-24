import { useCallback, useEffect, useState } from 'react'
import {
  CalendarDays,
  Download,
  FileText,
  Printer,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  CumulativeNetChart,
  DailyCashflowChart,
  DonutBreakdownChart,
  IncomeExpenseRadarChart,
  MerchantHorizontalChart,
  MonthlyCashflowChart,
  SavingsGaugeChart,
  TransactionMixChart,
  WeekdaySpendChart,
} from '../components/ReportCharts'
import { fetchDetailedReport } from '../api'
import type { DetailedReport } from '../types'
import { formatDate, formatINR } from '../lib/format'
import { CARD_TYPE_LABELS, type CardType } from '../types'

const field =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)]'

type DatePreset = 'month' | 'last-month' | 'quarter' | 'year' | 'all'
type ActiveDatePreset = DatePreset | 'custom'

function toInputDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function presetDates(preset: DatePreset): [string, string] {
  const today = new Date()
  const end = toInputDate(today)

  switch (preset) {
    case 'month':
      return [toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), end]
    case 'last-month':
      return [
        toInputDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        toInputDate(new Date(today.getFullYear(), today.getMonth(), 0)),
      ]
    case 'quarter':
      return [toInputDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)), end]
    case 'year':
      return [toInputDate(new Date(today.getFullYear(), 0, 1)), end]
    case 'all':
      return ['', '']
    default: {
      const exhaustive: never = preset
      return exhaustive
    }
  }
}

function formatReportDate(value: string): string {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadReportCsv(report: DetailedReport, dateFrom: string, dateTo: string) {
  const rows: Array<Array<string | number>> = [
    ['MONEY TRACK — FINANCIAL REPORT'],
    ['Period', dateFrom || 'All records', dateTo || 'Present'],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['EXECUTIVE SUMMARY'],
    ['Total debit', report.overview.total_debit],
    ['Total credit', report.overview.total_credit],
    ['Net cash flow', report.overview.net],
    ['Transactions', report.overview.count],
    ['Average debit', report.overview.avg_debit],
    ['Average daily spend', report.overview.avg_daily_debit],
    ['Largest debit', report.overview.max_debit],
    [],
    ['MERCHANT ANALYSIS'],
    ['Merchant', 'Spend', 'Transactions', 'Average', 'Share %'],
    ...report.merchants.map((merchant) => [
      merchant.merchant,
      merchant.amount,
      merchant.count,
      merchant.avg,
      merchant.share,
    ]),
    [],
    ['DAILY CASH FLOW'],
    ['Date', 'Debit', 'Credit', 'Net', 'Transactions'],
    ...report.daily.map((day) => [day.date, day.debit, day.credit, day.net, day.count]),
  ]
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `money-track-report-${dateFrom || 'all'}-${dateTo || 'present'}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
        {eyebrow}
      </p>
      <h3 className="mt-1 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'debit' | 'credit' | 'neutral'
}) {
  const color =
    tone === 'debit'
      ? 'text-[var(--debit)]'
      : tone === 'credit'
        ? 'text-[var(--credit)]'
        : 'text-[var(--text)]'
  return (
    <div className="panel relative overflow-hidden px-5 py-4">
      <div
        className={`absolute inset-y-0 left-0 w-1 ${
          tone === 'debit'
            ? 'bg-[var(--debit)]'
            : tone === 'credit'
              ? 'bg-[var(--credit)]'
              : 'bg-[var(--accent)]'
        }`}
      />
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
  nameLabel = 'Name',
}: {
  title: string
  rows: DetailedReport['by_bank']
  nameLabel?: string
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2 font-medium">{nameLabel}</th>
                <th className="px-4 py-2 font-medium">Debit</th>
                <th className="px-4 py-2 font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">Net</th>
                <th className="px-4 py-2 font-medium">Txns</th>
                <th className="px-4 py-2 font-medium">Debit %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                    {formatINR(r.debit)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-[var(--credit)]">
                    {formatINR(r.credit)}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatINR(r.net)}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{r.count}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{r.debit_share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function labelCardType(name: string): string {
  if (name in CARD_TYPE_LABELS) return CARD_TYPE_LABELS[name as CardType]
  return name
}

export function ReportsPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activePreset, setActivePreset] = useState<ActiveDatePreset>('all')
  const [report, setReport] = useState<DetailedReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchDetailedReport({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        merchant_limit: 25,
      })
      setReport(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

  const o = report?.overview
  const periodLabel =
    dateFrom || dateTo
      ? `${dateFrom ? formatReportDate(dateFrom) : 'Beginning'} — ${
          dateTo ? formatReportDate(dateTo) : 'Present'
        }`
      : 'All available records'
  const savingsRate = o && o.total_credit > 0 ? (o.net / o.total_credit) * 100 : null
  const topMerchant = report?.merchants[0]
  const busiestDay = report?.weekday.reduce<(typeof report.weekday)[number] | null>(
    (highest, day) => (!highest || day.amount > highest.amount ? day : highest),
    null,
  )
  const monthlyChange = (() => {
    if (!report || report.monthly.length < 2) return null
    const current = report.monthly.at(-1)?.debit ?? 0
    const previous = report.monthly.at(-2)?.debit ?? 0
    if (previous === 0) return null
    return ((current - previous) / previous) * 100
  })()

  const applyPreset = (preset: DatePreset) => {
    const [from, to] = presetDates(preset)
    setDateFrom(from)
    setDateTo(to)
    setActivePreset(preset)
  }

  return (
    <div className="report-page space-y-8">
      <section className="report-cover panel overflow-hidden">
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                <FileText size={12} />
                Financial performance report
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Cash-flow control report
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} />
                  {periodLabel}
                </span>
                <span>Generated {new Date().toLocaleDateString('en-IN')}</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
                Use this page to see where money comes from, where it goes, and which habits to
                change first.
              </p>
            </div>
            <div className="report-actions flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={!report}
                onClick={() => report && downloadReportCsv(report, dateFrom, dateTo)}
              >
                <Download size={14} />
                Export CSV
              </button>
              <button type="button" className="btn" onClick={() => window.print()}>
                <Printer size={14} />
                Print / PDF
              </button>
            </div>
          </div>
        </div>

        <div className="report-filters px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['month', 'This month'],
                  ['last-month', 'Last month'],
                  ['quarter', 'Last 3 months'],
                  ['year', 'Year to date'],
                  ['all', 'All time'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    activePreset === preset
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                  onClick={() => applyPreset(preset)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                From
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setDateFrom(event.target.value)
                    setActivePreset('custom')
                  }}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                To
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setDateTo(event.target.value)
                    setActivePreset('custom')
                  }}
                />
              </label>
              <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/35 bg-[var(--debit)]/10 px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <p className="text-sm text-[var(--muted)]">Loading report…</p>
      ) : null}

      {o ? (
        <>
          <section className="report-section">
            <SectionHeading
              eyebrow="01 · Executive overview"
              title="Financial position"
              description="A high-level view of cash inflow, outflow, activity, and spending behaviour."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <StatCard
                label="Total income"
                value={formatINR(o.total_credit)}
                hint={`${o.credit_count} credit transactions`}
                tone="credit"
              />
              <StatCard
                label="Total expenses"
                value={formatINR(o.total_debit)}
                hint={`${o.debit_count} debit transactions`}
                tone="debit"
              />
              <StatCard
                label="Net cash flow"
                value={formatINR(o.net)}
                hint={o.net >= 0 ? 'Positive cash position' : 'Expenses exceed income'}
                tone={o.net >= 0 ? 'credit' : 'debit'}
              />
              <StatCard
                label="Savings rate"
                value={savingsRate == null ? '—' : `${savingsRate.toFixed(1)}%`}
                hint="Net cash flow ÷ income"
                tone={savingsRate != null && savingsRate >= 0 ? 'credit' : 'debit'}
              />
              <StatCard
                label="Average expense"
                value={formatINR(o.avg_debit)}
                hint="Per debit transaction"
                tone="debit"
              />
              <StatCard
                label="Average income"
                value={formatINR(o.avg_credit)}
                hint="Per credit transaction"
                tone="credit"
              />
              <StatCard
                label="Largest expense"
                value={formatINR(o.max_debit)}
                hint="Highest single debit"
                tone="debit"
              />
              <StatCard
                label="Daily spend rate"
                value={formatINR(o.avg_daily_debit)}
                hint={`${o.active_days} active days · ${o.count} total transactions`}
              />
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="02 · Control signals"
              title="What to act on first"
              description="Four signals that explain how money is moving and where control is weakest."
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <article className="panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Cash flow status</p>
                    <p className="mt-2 text-base font-semibold">
                      {o.net >= 0 ? 'Positive surplus' : 'Negative cash flow'}
                    </p>
                  </div>
                  <span
                    className={`rounded-lg p-2 ${
                      o.net >= 0
                        ? 'bg-[var(--credit)]/10 text-[var(--credit)]'
                        : 'bg-[var(--debit)]/10 text-[var(--debit)]'
                    }`}
                  >
                    {o.net >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
                  {o.net >= 0
                    ? `Income exceeded expenses by ${formatINR(o.net)}.`
                    : `Expenses exceeded income by ${formatINR(Math.abs(o.net))}.`}
                </p>
              </article>

              <article className="panel p-5">
                <p className="text-xs font-medium text-[var(--muted)]">Top spending destination</p>
                <p className="mt-2 truncate text-base font-semibold">
                  {topMerchant?.merchant || 'Not enough data'}
                </p>
                <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
                  {topMerchant
                    ? `${formatINR(topMerchant.amount)} across ${topMerchant.count} transactions, representing ${topMerchant.share}% of expenses.`
                    : 'Merchant information is unavailable for this period.'}
                </p>
              </article>

              <article className="panel p-5">
                <p className="text-xs font-medium text-[var(--muted)]">Highest-spend weekday</p>
                <p className="mt-2 text-base font-semibold">{busiestDay?.day || 'Not enough data'}</p>
                <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
                  {busiestDay
                    ? `${formatINR(busiestDay.amount)} spent in ${busiestDay.count} recorded transactions.`
                    : 'Weekday spending information is unavailable.'}
                </p>
              </article>

              <article className="panel p-5">
                <p className="text-xs font-medium text-[var(--muted)]">Recent monthly movement</p>
                <p
                  className={`mt-2 text-base font-semibold ${
                    monthlyChange == null
                      ? ''
                      : monthlyChange > 0
                        ? 'text-[var(--debit)]'
                        : 'text-[var(--credit)]'
                  }`}
                >
                  {monthlyChange == null
                    ? 'Not enough data'
                    : `${monthlyChange > 0 ? '+' : ''}${monthlyChange.toFixed(1)}%`}
                </p>
                <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
                  {monthlyChange == null
                    ? 'At least two months are needed for comparison.'
                    : `Expense change versus the preceding month in this report.`}
                </p>
              </article>
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="03 · Visual performance"
              title="Cash flow visualizations"
              description="Interactive amCharts views of income, expenses, cumulative net, and weekday behaviour."
            />
            <div className="grid gap-4 xl:grid-cols-3">
              <article className="panel p-4 xl:col-span-2">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Monthly income vs expenses
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">Clustered columns by calendar month</p>
                <MonthlyCashflowChart data={report.monthly} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Weekday spend intensity
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">Where spending concentrates across the week</p>
                <WeekdaySpendChart data={report.weekday} />
              </article>
              <article className="panel p-4 xl:col-span-2">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Daily cash-flow timeline
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  Smoothed daily income, expenses, and net movement — scroll/zoom on the timeline
                </p>
                <DailyCashflowChart data={report.daily} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Cumulative net position
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">Running total of net cash flow over the period</p>
                <CumulativeNetChart data={report.daily} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Income / expense radar
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">Relative strength of inflow vs outflow</p>
                <IncomeExpenseRadarChart debit={o.total_debit} credit={o.total_credit} />
              </article>
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="04 · Composition analytics"
              title="Structure of money movement"
              description="Donut and gauge views that show how activity is split across categories, banks, rails, and sources."
            />
            <div className="grid gap-4 xl:grid-cols-3">
              <article className="panel p-4 xl:col-span-2">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Expense by category
                </h4>
                <DonutBreakdownChart data={report.by_category ?? []} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Expense by payment type
                </h4>
                <DonutBreakdownChart
                  data={report.by_card_type.map((r) => ({ ...r, name: labelCardType(r.name) }))}
                />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Expense by bank
                </h4>
                <DonutBreakdownChart data={report.by_bank} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Capture source mix
                </h4>
                <DonutBreakdownChart data={report.by_source} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Transaction mix
                </h4>
                <TransactionMixChart debitCount={o.debit_count} creditCount={o.credit_count} />
              </article>
              <article className="panel p-4 xl:col-span-2">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Savings-rate gauge
                </h4>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  Net cash flow as a percentage of income (−50% to 100% scale)
                </p>
                <SavingsGaugeChart rate={savingsRate} />
              </article>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
              <BreakdownTable
                title="By category"
                rows={report.by_category ?? []}
                nameLabel="Category"
              />
              <BreakdownTable title="By bank" rows={report.by_bank} nameLabel="Bank" />
              <BreakdownTable
                title="By payment type"
                rows={report.by_card_type.map((r) => ({ ...r, name: labelCardType(r.name) }))}
                nameLabel="Type"
              />
              <BreakdownTable title="By source" rows={report.by_source} nameLabel="Source" />
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="05 · Expense concentration"
              title="Merchant analysis"
              description="Ranked visual and tabular view of where money was spent, including frequency and share."
            />
            <div className="grid gap-4 xl:grid-cols-2">
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Top merchants by spend
                </h4>
                <MerchantHorizontalChart data={report.merchants.slice(0, 12)} />
              </article>
              <article className="panel p-4">
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Merchant share of expenses
                </h4>
                <DonutBreakdownChart
                  data={report.merchants.slice(0, 10).map((m) => ({
                    name: m.merchant,
                    debit: m.amount,
                    credit: 0,
                    count: m.count,
                  }))}
                />
              </article>
            </div>
            <div className="panel mt-4 overflow-hidden">
              <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Top merchants
              </div>
              {report.merchants.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No merchant data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">Merchant</th>
                        <th className="px-4 py-2 font-medium">Spend</th>
                        <th className="px-4 py-2 font-medium">Txns</th>
                        <th className="px-4 py-2 font-medium">Avg</th>
                        <th className="px-4 py-2 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.merchants.map((m) => (
                        <tr key={m.merchant} className="border-t border-[var(--border)]">
                          <td className="px-4 py-2 font-medium">{m.merchant}</td>
                          <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                            {formatINR(m.amount)}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{m.count}</td>
                          <td className="px-4 py-2 tabular-nums">{formatINR(m.avg)}</td>
                          <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{m.share}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="06 · Transaction risk review"
              title="Largest transactions"
              description="The ten highest-value entries in the selected period for quick verification."
            />
            <div className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Largest transactions
            </div>
            {report.largest.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No transactions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 font-medium">Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.largest.map((t) => (
                      <tr key={t._id} className="border-t border-[var(--border)]">
                        <td className="whitespace-nowrap px-4 py-2 text-[var(--muted)]">
                          {formatDate(t.received_at)}
                        </td>
                        <td
                          className={`px-4 py-2 capitalize ${
                            t.type === 'debit' ? 'text-[var(--debit)]' : 'text-[var(--credit)]'
                          }`}
                        >
                          {t.type}
                        </td>
                        <td className="px-4 py-2 font-medium tabular-nums">
                          {formatINR(t.amount)}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-2">{t.merchant || '—'}</td>
                        <td className="px-4 py-2 text-[var(--muted)]">{t.bank || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </section>

          <section className="report-section">
            <SectionHeading
              eyebrow="07 · Detailed ledger"
              title="Daily cash flow"
              description="Day-by-day income, expense, net movement, and transaction activity."
            />
            <div className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Daily breakdown
            </div>
            {report.daily.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No daily data</p>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[var(--surface)] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Debit</th>
                      <th className="px-4 py-2 font-medium">Credit</th>
                      <th className="px-4 py-2 font-medium">Net</th>
                      <th className="px-4 py-2 font-medium">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2">{d.date}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                          {formatINR(d.debit)}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-[var(--credit)]">
                          {formatINR(d.credit)}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{formatINR(d.net)}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </section>

          <footer className="report-footer border-t border-[var(--border)] py-5 text-center text-xs text-[var(--muted)]">
            Money Track · Financial Performance Report · {periodLabel}
          </footer>
        </>
      ) : null}
    </div>
  )
}
