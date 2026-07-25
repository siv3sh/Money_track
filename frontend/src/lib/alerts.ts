import type { DetailedReport, Transaction } from '../types'

export interface BudgetItem {
  category: string
  budget: number
  actual: number
  pct: number
}

export interface SubscriptionRenewal {
  merchant: string
  amount: number
  nextDate: string
  cadence: 'monthly' | 'yearly'
}

export interface SpendAnomaly {
  id: string
  title: string
  detail: string
  amount: number
  severity: 'high' | 'medium' | 'low'
  date: string
}

/** Default monthly budgets — tunable client-side. */
const DEFAULT_BUDGETS: Record<string, number> = {
  'Food & Dining': 12000,
  Groceries: 10000,
  Shopping: 8000,
  'Travel & Transport': 6000,
  'Bills & Utilities': 7000,
  Entertainment: 4000,
  'Health & Wellness': 3000,
  Subscriptions: 2500,
  Education: 5000,
  Other: 5000,
}

export function budgetVsActual(report: DetailedReport): BudgetItem[] {
  const items = (report.by_category || [])
    .filter((r) => r.debit > 0)
    .map((r) => {
      const category = r.name || 'Other'
      const budget = DEFAULT_BUDGETS[category] ?? 5000
      const actual = r.debit
      return {
        category,
        budget,
        actual,
        pct: budget > 0 ? Math.min(999, (actual / budget) * 100) : 0,
      }
    })
    .sort((a, b) => b.pct - a.pct)

  // Ensure known budgets appear even if zero spend
  for (const [category, budget] of Object.entries(DEFAULT_BUDGETS)) {
    if (!items.some((i) => i.category === category)) {
      items.push({ category, budget, actual: 0, pct: 0 })
    }
  }
  return items.slice(0, 10)
}

export function upcomingSubscriptions(txns: Transaction[]): SubscriptionRenewal[] {
  const byMerchant = new Map<
    string,
    { amounts: number[]; dates: Date[]; months: Set<string> }
  >()

  for (const t of txns) {
    if (t.type !== 'debit' || !t.merchant) continue
    const cat = (t.category || '').toLowerCase()
    const name = t.merchant
    const looksSub =
      cat.includes('subscription') ||
      /netflix|spotify|prime|youtube|hotstar|disney|apple|adobe|notion|cursor|openai|github/i.test(
        name,
      )
    if (!looksSub && !cat.includes('subscription')) {
      // still track frequent small-ish merchants
      continue
    }
    if (!byMerchant.has(name)) {
      byMerchant.set(name, { amounts: [], dates: [], months: new Set() })
    }
    const e = byMerchant.get(name)!
    e.amounts.push(t.amount)
    e.dates.push(new Date(t.received_at))
    e.months.add(t.received_at.slice(0, 7))
  }

  const today = new Date()
  const renewals: SubscriptionRenewal[] = []

  for (const [merchant, data] of byMerchant) {
    if (data.dates.length === 0) continue
    data.dates.sort((a, b) => b.getTime() - a.getTime())
    const last = data.dates[0]
    const avg = data.amounts.reduce((a, b) => a + b, 0) / data.amounts.length
    const cadence: 'monthly' | 'yearly' = avg > 5000 ? 'yearly' : 'monthly'
    const next = new Date(last)
    if (cadence === 'monthly') next.setMonth(next.getMonth() + 1)
    else next.setFullYear(next.getFullYear() + 1)
    if (next < today) {
      // roll forward
      while (next < today) {
        if (cadence === 'monthly') next.setMonth(next.getMonth() + 1)
        else next.setFullYear(next.getFullYear() + 1)
      }
    }
    renewals.push({
      merchant,
      amount: Math.round(avg),
      nextDate: next.toISOString().slice(0, 10),
      cadence,
    })
  }

  return renewals.sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 8)
}

export function detectAnomalies(
  txns: Transaction[],
  report: DetailedReport,
): SpendAnomaly[] {
  const anomalies: SpendAnomaly[] = []
  const debits = txns.filter((t) => t.type === 'debit')
  if (debits.length === 0) return anomalies

  const amounts = debits.map((t) => t.amount).sort((a, b) => a - b)
  const median = amounts[Math.floor(amounts.length / 2)] || 0

  for (const t of debits.slice(0, 200)) {
    if (median > 0 && t.amount > median * 5 && t.amount > 3000) {
      anomalies.push({
        id: `spike-${t._id}`,
        title: 'Unusual large expense',
        detail: `${t.merchant || 'Unknown merchant'} is ${Math.round(t.amount / Math.max(median, 1))}× your median debit`,
        amount: t.amount,
        severity: t.amount > median * 10 ? 'high' : 'medium',
        date: t.received_at,
      })
    }
  }

  // Category overspend vs budget heuristic
  for (const row of report.by_category || []) {
    if (row.debit > 15000 && row.debit_share > 25) {
      anomalies.push({
        id: `cat-${row.name}`,
        title: `${row.name} concentration`,
        detail: `${row.debit_share}% of spend is in ${row.name}`,
        amount: row.debit,
        severity: row.debit_share > 40 ? 'high' : 'medium',
        date: new Date().toISOString(),
      })
    }
  }

  // Deduplicate by title+amount, keep top
  const seen = new Set<string>()
  return anomalies
    .filter((a) => {
      const key = `${a.title}-${a.amount}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
}
