import type { MonthlyBucket, Transaction } from '../types'
import { monthLabel } from './dates'

export interface InvestmentMerchant {
  name: string
  amount: number
  count: number
}

export interface InvestmentMonth {
  month: string
  label: string
  invested: number
  income: number
  ratio: number
}

export interface InvestmentSnapshot {
  totalInvested: number
  thisMonthInvested: number
  txnCount: number
  merchants: InvestmentMerchant[]
  byMonth: InvestmentMonth[]
  transactions: Transaction[]
}

function isInvestmentTxn(t: Transaction): boolean {
  if (t.type !== 'debit') return false
  const cat = (t.category || '').toLowerCase()
  if (cat === 'investments') return true
  const hay = `${t.merchant || ''} ${t.raw_text || ''}`.toLowerCase()
  return /indmoney|groww|zerodha|upstox|kuvera|digital gold|mutual fund|sip|nps|clearing corp|iccl|camsonline|kfintech|mf\b/.test(
    hay,
  )
}

/** Build investment views from real transactions only — no seeded/demo holdings. */
export function buildInvestmentSnapshot(
  txns: Transaction[],
  monthly: MonthlyBucket[] = [],
): InvestmentSnapshot {
  const investmentTxns = txns.filter(isInvestmentTxn)
  const totalInvested = investmentTxns.reduce((s, t) => s + t.amount, 0)

  const now = new Date()
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonthInvested = investmentTxns
    .filter((t) => t.received_at.slice(0, 7) === thisYm)
    .reduce((s, t) => s + t.amount, 0)

  const merchantMap = new Map<string, { amount: number; count: number }>()
  for (const t of investmentTxns) {
    const name = (t.merchant || 'Unknown').replace(/\s+/g, ' ').trim() || 'Unknown'
    const prev = merchantMap.get(name) || { amount: 0, count: 0 }
    prev.amount += t.amount
    prev.count += 1
    merchantMap.set(name, prev)
  }
  const merchants = [...merchantMap.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount)

  const investByMonth = new Map<string, number>()
  for (const t of investmentTxns) {
    const m = t.received_at.slice(0, 7)
    if (!m || m.length < 7) continue
    investByMonth.set(m, (investByMonth.get(m) || 0) + t.amount)
  }

  const monthKeys = new Set<string>([
    ...monthly.map((m) => m.month),
    ...investByMonth.keys(),
  ])
  const byMonth: InvestmentMonth[] = [...monthKeys]
    .sort()
    .map((month) => {
      const income = monthly.find((m) => m.month === month)?.credit || 0
      const invested = investByMonth.get(month) || 0
      return {
        month,
        label: monthLabel(month),
        invested,
        income,
        ratio: income > 0 ? (invested / income) * 100 : 0,
      }
    })

  return {
    totalInvested,
    thisMonthInvested,
    txnCount: investmentTxns.length,
    merchants,
    byMonth,
    transactions: [...investmentTxns].sort(
      (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
    ),
  }
}
