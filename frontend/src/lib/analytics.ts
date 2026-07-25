import type {
  DetailedReport,
  MonthlyBucket,
  ReportBreakdownRow,
  Transaction,
} from '../types'
import { monthLabel } from './dates'

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
]

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return null
    return current > 0 ? 100 : -100
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

export function filterBySources(
  report: DetailedReport,
  sources: string[],
): DetailedReport {
  if (sources.length === 0) return report
  const allowed = new Set(sources)
  const filterRows = (rows: ReportBreakdownRow[]) =>
    rows.filter((r) => allowed.has(r.name))

  const sourceDebit = filterRows(report.by_bank).reduce((s, r) => s + r.debit, 0)
  const sourceCredit = filterRows(report.by_bank).reduce((s, r) => s + r.credit, 0)

  return {
    ...report,
    overview: {
      ...report.overview,
      total_debit: sourceDebit,
      total_credit: sourceCredit,
      net: sourceCredit - sourceDebit,
    },
    by_bank: filterRows(report.by_bank),
  }
}

export function runningBalanceSeries(
  monthly: MonthlyBucket[],
  startBalance = 0,
): Array<{ month: string; label: string; balance: number; net: number }> {
  let balance = startBalance
  return monthly.map((m) => {
    balance += m.net
    return {
      month: m.month,
      label: monthLabel(m.month),
      balance,
      net: m.net,
    }
  })
}

export function netSavingsTrend(monthly: MonthlyBucket[]) {
  return monthly.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    credit: m.credit,
    debit: m.debit,
    net: m.net,
  }))
}

export function incomeSourceBreakdown(report: DetailedReport) {
  return report.by_bank
    .filter((r) => r.credit > 0)
    .map((r) => ({ name: r.name, value: r.credit }))
    .sort((a, b) => b.value - a.value)
}

export function categorySpend(report: DetailedReport) {
  return (report.by_category || [])
    .filter((r) => r.debit > 0)
    .map((r) => ({ name: r.name || 'Other', value: r.debit, count: r.count }))
    .sort((a, b) => b.value - a.value)
}

export function accountSpend(report: DetailedReport) {
  return report.by_card_type
    .filter((r) => r.debit > 0)
    .map((r) => ({
      name: r.name,
      debit: r.debit,
      credit: r.credit,
      count: r.count,
    }))
}

/** Build category × month stacked area from transactions. */
export function categoryTrendOverMonths(
  txns: Transaction[],
  topN = 6,
): { months: string[]; series: string[]; rows: Array<Record<string, string | number>> } {
  const monthCat = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()

  for (const t of txns) {
    if (t.type !== 'debit') continue
    const month = t.received_at.slice(0, 7)
    if (!month || month.length < 7) continue
    const cat = t.category || 'Other'
    if (!monthCat.has(month)) monthCat.set(month, new Map())
    const m = monthCat.get(month)!
    m.set(cat, (m.get(cat) || 0) + t.amount)
    totals.set(cat, (totals.get(cat) || 0) + t.amount)
  }

  const series = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name)

  const months = [...monthCat.keys()].sort()
  const rows = months.map((month) => {
    const row: Record<string, string | number> = {
      month,
      label: monthLabel(month),
    }
    const m = monthCat.get(month)!
    for (const cat of series) {
      row[cat] = m.get(cat) || 0
    }
    return row
  })

  return { months, series, rows }
}

export interface RecurringSplit {
  recurring: number
  oneTime: number
  recurringMerchants: Array<{ merchant: string; amount: number; months: number }>
}

/** Heuristic: merchant appears in ≥3 distinct months → recurring. */
export function recurringVsOneTime(txns: Transaction[]): RecurringSplit {
  const byMerchant = new Map<string, { amount: number; months: Set<string> }>()

  for (const t of txns) {
    if (t.type !== 'debit' || !t.merchant) continue
    const key = t.merchant.trim().toUpperCase()
    if (!byMerchant.has(key)) byMerchant.set(key, { amount: 0, months: new Set() })
    const entry = byMerchant.get(key)!
    entry.amount += t.amount
    entry.months.add(t.received_at.slice(0, 7))
  }

  let recurring = 0
  let oneTime = 0
  const recurringMerchants: RecurringSplit['recurringMerchants'] = []

  for (const [merchant, data] of byMerchant) {
    if (data.months.size >= 3) {
      recurring += data.amount
      recurringMerchants.push({
        merchant,
        amount: data.amount,
        months: data.months.size,
      })
    } else {
      oneTime += data.amount
    }
  }

  recurringMerchants.sort((a, b) => b.amount - a.amount)
  return { recurring, oneTime, recurringMerchants: recurringMerchants.slice(0, 8) }
}

export interface HeatmapCell {
  day: number
  weekday: number
  amount: number
  count: number
}

/** Day-of-month (1–31) × weekday heatmap of debit spend. */
export function spendingHeatmap(txns: Transaction[]): {
  byDayOfMonth: Array<{ day: number; amount: number; count: number }>
  byWeekday: Array<{ weekday: number; label: string; amount: number; count: number }>
  matrix: number[][]
  max: number
} {
  const byDom = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, amount: 0, count: 0 }))
  const byWd = Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i],
    amount: 0,
    count: 0,
  }))
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 31 }, () => 0))

  for (const t of txns) {
    if (t.type !== 'debit') continue
    const d = new Date(t.received_at)
    if (Number.isNaN(d.getTime())) continue
    const dom = d.getDate()
    const wd = d.getDay()
    byDom[dom - 1].amount += t.amount
    byDom[dom - 1].count += 1
    byWd[wd].amount += t.amount
    byWd[wd].count += 1
    matrix[wd][dom - 1] += t.amount
  }

  const max = Math.max(1, ...matrix.flat())
  return { byDayOfMonth: byDom, byWeekday: byWd, matrix, max }
}

export function sourceMonthlyCrossTab(
  txns: Transaction[],
  sourceKey: (t: Transaction) => string = (t) => t.bank || 'Unknown',
): {
  sources: string[]
  months: string[]
  cells: Record<string, Record<string, { credit: number; debit: number; net: number }>>
} {
  const cells: Record<string, Record<string, { credit: number; debit: number; net: number }>> =
    {}
  const monthSet = new Set<string>()
  const sourceSet = new Set<string>()

  for (const t of txns) {
    const source = sourceKey(t)
    const month = t.received_at.slice(0, 7)
    if (!month || month.length < 7) continue
    sourceSet.add(source)
    monthSet.add(month)
    if (!cells[source]) cells[source] = {}
    if (!cells[source][month]) cells[source][month] = { credit: 0, debit: 0, net: 0 }
    if (t.type === 'credit') cells[source][month].credit += t.amount
    else cells[source][month].debit += t.amount
    cells[source][month].net = cells[source][month].credit - cells[source][month].debit
  }

  return {
    sources: [...sourceSet].sort(),
    months: [...monthSet].sort(),
    cells,
  }
}

export function sourceMultiLine(
  cross: ReturnType<typeof sourceMonthlyCrossTab>,
  metric: 'credit' | 'debit' | 'net' = 'net',
) {
  return cross.months.map((month) => {
    const row: Record<string, string | number> = {
      month,
      label: monthLabel(month),
    }
    for (const source of cross.sources) {
      row[source] = cross.cells[source]?.[month]?.[metric] ?? 0
    }
    return row
  })
}

export function sourceGroupedBars(
  cross: ReturnType<typeof sourceMonthlyCrossTab>,
  selectedSources: string[],
) {
  const sources = selectedSources.length ? selectedSources : cross.sources
  return cross.months.map((month) => {
    const row: Record<string, string | number> = {
      month,
      label: monthLabel(month),
    }
    for (const source of sources) {
      row[`${source}__credit`] = cross.cells[source]?.[month]?.credit ?? 0
      row[`${source}__debit`] = cross.cells[source]?.[month]?.debit ?? 0
    }
    return row
  })
}

export function latestBalancesByAccount(txns: Transaction[]): Array<{
  account: string
  balance: number
  bank: string | null
  asOf: string
}> {
  const latest = new Map<
    string,
    { balance: number; bank: string | null; asOf: string; ts: number }
  >()

  for (const t of txns) {
    if (t.balance == null) continue
    const key = `${t.bank || 'Unknown'}-${t.account_last4 || 'xxxx'}-${t.card_type || 'acct'}`
    const ts = new Date(t.received_at).getTime()
    const prev = latest.get(key)
    if (!prev || ts >= prev.ts) {
      latest.set(key, {
        balance: t.balance,
        bank: t.bank,
        asOf: t.received_at,
        ts,
      })
    }
  }

  return [...latest.entries()]
    .map(([account, v]) => ({
      account,
      balance: v.balance,
      bank: v.bank,
      asOf: v.asOf,
    }))
    .sort((a, b) => b.balance - a.balance)
}
