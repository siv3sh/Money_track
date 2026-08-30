import type { AnalyticsAlert, BreakdownRow, MonthlyRow } from '../../types'

export type SpendingSearchFilters = {
  merchant: string
  category: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
}

export const EMPTY_SEARCH_FILTERS: SpendingSearchFilters = {
  merchant: '',
  category: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
}

/** Lifestyle categories for the donut (excludes Transfers / Investments / Income). */
export function lifestyleCategories(
  lifestyle: BreakdownRow[] | undefined,
  all: BreakdownRow[] | undefined,
): BreakdownRow[] {
  if (lifestyle?.length) return lifestyle.filter((c) => c.debit > 0)
  return (all || []).filter(
    (c) => !['Transfers', 'Investments', 'Income'].includes(c.name) && c.debit > 0,
  )
}

export type MomCompare = {
  currentMonth: string
  previousMonth: string
  currentDebit: number
  previousDebit: number
  pct: number | null
}

/** Prefer mom.debit_pct; amounts from the last two monthly rows. */
export function resolveMomCompare(
  monthly: MonthlyRow[] | undefined,
  mom: { debit_pct: number | null; current_month?: string; previous_month?: string } | undefined,
): MomCompare | null {
  if (!monthly?.length) return null
  const cur = monthly[monthly.length - 1]
  const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null
  if (!cur) return null
  return {
    currentMonth: mom?.current_month || cur.month,
    previousMonth: mom?.previous_month || prev?.month || '—',
    currentDebit: cur.debit,
    previousDebit: prev?.debit ?? 0,
    pct: mom?.debit_pct ?? null,
  }
}

export type DailyPoint = { date: string; debit: number; credit: number; net: number; count: number }

export type TrendPoint = {
  key: string
  label: string
  debit: number
  credit: number
  net: number
}

/** Monday-based ISO week key + short label from a YYYY-MM-DD date. */
export function isoWeekMeta(dateStr: string): { key: string; label: string } {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return { key: dateStr, label: dateStr }

  const day = d.getDay() || 7
  const thursday = new Date(d)
  thursday.setDate(d.getDate() + 4 - day)
  const yearStart = new Date(thursday.getFullYear(), 0, 1)
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  const year = thursday.getFullYear()
  const key = `${year}-W${String(week).padStart(2, '0')}`

  const monday = new Date(d)
  monday.setDate(d.getDate() - (day - 1))
  const label = monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return { key, label }
}

export function dailyToTrendPoints(daily: DailyPoint[]): TrendPoint[] {
  return daily.map((d) => {
    const day = d.date.slice(0, 10)
    const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    })
    return {
      key: day,
      label,
      debit: d.debit,
      credit: d.credit,
      net: d.net,
    }
  })
}

export function weeklyFromDaily(daily: DailyPoint[]): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>()
  for (const d of daily) {
    const { key, label } = isoWeekMeta(d.date)
    const prev = buckets.get(key) || { key, label, debit: 0, credit: 0, net: 0 }
    prev.debit += d.debit
    prev.credit += d.credit
    prev.net += d.net
    buckets.set(key, prev)
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export type AnomalyItem = {
  id: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'alert'
  kind: 'alert' | 'category' | 'merchant'
}

const ANOMALY_MULTIPLIER = 1.5
const TRAIL_MONTHS = 3

/**
 * Prefer alerts with type === 'anomaly'. Else flag categories (and merchants when
 * monthly history exists) whose current spend > 1.5× trailing 3-month average.
 */
export function resolveAnomalies(args: {
  alerts: AnalyticsAlert[] | undefined
  categoryMonthly: Array<Record<string, string | number>> | undefined
  lifestyleCats: BreakdownRow[]
}): AnomalyItem[] {
  const fromAlerts = (args.alerts || [])
    .filter((a) => a.type === 'anomaly')
    .map((a, i) => ({
      id: `alert-${i}-${a.title}`,
      title: a.title,
      message: a.message,
      severity: a.severity,
      kind: 'alert' as const,
    }))
  if (fromAlerts.length) return fromAlerts

  const rows = args.categoryMonthly || []
  if (rows.length < 2) return []

  const months = rows.map((r) => String(r.month)).sort()
  const currentMonth = months[months.length - 1]
  const trailKeys = months.slice(-(TRAIL_MONTHS + 1), -1)
  if (!trailKeys.length || !currentMonth) return []

  const out: AnomalyItem[] = []
  const catNames = new Set(args.lifestyleCats.map((c) => c.name))

  for (const cat of catNames) {
    const current = args.lifestyleCats.find((c) => c.name === cat)?.debit ?? 0
    if (current <= 0) continue
    const trailVals: number[] = []
    for (const m of trailKeys) {
      const row = rows.find((r) => String(r.month) === m)
      trailVals.push(Number(row?.[cat] ?? 0))
    }
    const avg = trailVals.reduce((s, v) => s + v, 0) / trailVals.length
    if (avg > 0 && current > avg * ANOMALY_MULTIPLIER) {
      const pct = Math.round((current / avg - 1) * 100)
      out.push({
        id: `cat-${cat}`,
        title: `${cat} is elevated`,
        message: `${formatPct(pct)} above the trailing ${trailVals.length}-month average (threshold 1.5×).`,
        severity: current > avg * 2 ? 'alert' : 'warning',
        kind: 'category',
      })
    }
  }

  return out.slice(0, 8)
}

function formatPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`
}
