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
  /** Prefill Find-transactions when the row is clicked. */
  merchant?: string
  category?: string
  amount?: number
  avg?: number
  /** How many × the baseline (e.g. 3.2× avg). */
  multiple?: number
}

const ANOMALY_MULTIPLIER = 1.5
const TRAIL_MONTHS = 3

/**
 * Combine transaction-level anomaly alerts with category spikes
 * (>1.5× trailing 3-month average). Both are tracked so users can
 * click through into Find transactions.
 */
export function resolveAnomalies(args: {
  alerts: AnalyticsAlert[] | undefined
  categoryMonthly: Array<Record<string, string | number>> | undefined
  lifestyleCats: BreakdownRow[]
}): AnomalyItem[] {
  const out: AnomalyItem[] = []

  for (const [i, a] of (args.alerts || []).entries()) {
    if (a.type !== 'anomaly') continue
    const amount = a.amount != null ? Number(a.amount) : undefined
    const avg = a.avg != null ? Number(a.avg) : parseAvgFromMessage(a.message)
    const merchant = (a.merchant || parseMerchantFromMessage(a.message) || '').trim() || undefined
    const multiple =
      amount != null && avg != null && avg > 0 ? Math.round((amount / avg) * 10) / 10 : undefined
    out.push({
      id: `alert-${i}-${merchant || a.title}`,
      title: merchant || a.title || 'Unusual spend',
      message: buildTxnMessage(amount, avg, multiple, a.message),
      severity: a.severity,
      kind: 'alert',
      merchant,
      category: a.category,
      amount,
      avg,
      multiple,
    })
  }

  const rows = args.categoryMonthly || []
  if (rows.length >= 2) {
    const months = rows.map((r) => String(r.month)).sort()
    const currentMonth = months[months.length - 1]
    const trailKeys = months.slice(-(TRAIL_MONTHS + 1), -1)
    if (trailKeys.length && currentMonth) {
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
          const multiple = Math.round((current / avg) * 10) / 10
          const pct = Math.round((current / avg - 1) * 100)
          out.push({
            id: `cat-${cat}`,
            title: cat,
            message: `${formatPct(pct)} vs trailing ${trailVals.length}-mo avg · ${multiple}× (threshold 1.5×)`,
            severity: current > avg * 2 ? 'alert' : 'warning',
            kind: 'category',
            category: cat,
            amount: current,
            avg,
            multiple,
          })
        }
      }
    }
  }

  // Prefer larger multiples first; cap list
  out.sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
  return out.slice(0, 10)
}

function parseAvgFromMessage(message: string): number | undefined {
  const m = message.match(/avg(?:\s+debit)?\s*₹\s*([\d,]+(?:\.\d+)?)/i)
  if (!m) return undefined
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function parseMerchantFromMessage(message: string): string | undefined {
  // "Merchant: ₹1,234 (avg debit ₹…)"
  const m = message.match(/^(.+?):\s*₹/)
  return m?.[1]?.trim() || undefined
}

function buildTxnMessage(
  amount: number | undefined,
  avg: number | undefined,
  multiple: number | undefined,
  fallback: string,
): string {
  if (amount == null) return fallback
  const parts = [`₹${Math.round(amount).toLocaleString('en-IN')}`]
  if (avg != null && avg > 0) {
    parts.push(`avg ₹${Math.round(avg).toLocaleString('en-IN')}`)
  }
  if (multiple != null) {
    parts.push(`${multiple}× usual`)
  }
  return parts.join(' · ')
}

function formatPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`
}
