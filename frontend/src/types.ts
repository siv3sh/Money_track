export type TxnType = 'debit' | 'credit'
export type CardType = 'credit_card' | 'debit_card' | 'upi' | 'bank_account'

export interface Transaction {
  _id: string
  type: TxnType
  amount: number
  account_last4: string | null
  card_type: CardType | null
  merchant: string | null
  merchant_raw?: string | null
  balance: number | null
  bank: string | null
  raw_text: string
  sender?: string
  source?: string
  received_at: string
  category?: string | null
  mcc?: string | null
  category_source?: string | null
}

export interface BreakdownRow {
  name: string
  debit: number
  credit: number
  net: number
  count: number
  debit_share: number
}

export interface MonthlyRow {
  month: string
  debit: number
  credit: number
  net: number
  count: number
  running_net?: number
}

export interface MerchantRow {
  merchant: string
  amount: number
  count: number
  avg?: number
  share?: number
}

export interface AnalyticsAlert {
  type: string
  severity: 'info' | 'warning' | 'alert'
  title: string
  message: string
  category?: string
  budget?: number
  actual?: number
  pct?: number
  amount?: number
  merchant?: string
  avg?: number
  count?: number
  created_at?: string
}

export interface AnalyticsPayload {
  range: { date_from: string | null; date_to: string | null }
  overview: {
    total_debit: number
    total_credit: number
    net: number
    count: number
    debit_count: number
    credit_count: number
    avg_debit: number
    avg_credit: number
    max_debit: number
    max_credit: number
    active_days: number
    avg_daily_debit: number
    liquid_total: number
    sms_liquid_total: number
    liquid_source: 'sms' | 'indmoney' | string
    lifestyle_spend: number
    transfers_debit: number
    investments_debit: number
    avg_daily_lifestyle: number
    total_invested: number
    net_worth_estimate: number
    investment_to_income: number
  }
  mom: {
    net_pct: number | null
    debit_pct: number | null
    credit_pct: number | null
    savings_pct: number | null
    current_month?: string
    previous_month?: string
    current_net?: number
    current_debit?: number
    current_credit?: number
  }
  monthly: MonthlyRow[]
  daily: Array<{ date: string; debit: number; credit: number; net: number; count: number }>
  weekday: Array<{ day: string; dow: number; amount: number; count: number }>
  day_of_month: Array<{ day: number; amount: number; count: number }>
  by_bank: BreakdownRow[]
  by_card_type: BreakdownRow[]
  by_source: BreakdownRow[]
  by_category: BreakdownRow[]
  by_category_lifestyle: BreakdownRow[]
  category_monthly: Array<Record<string, string | number>>
  lifestyle_category_monthly: Array<Record<string, string | number>>
  source_monthly: Array<{
    month: string
    source: string
    debit: number
    credit: number
    net: number
    count: number
  }>
  merchants: MerchantRow[]
  recurring: {
    recurring_amount: number
    onetime_amount: number
    merchants: Array<{ merchant: string; amount: number; count: number; avg: number }>
  }
  accounts: Array<{
    bank: string
    account_last4: string
    balance: number
    as_of: string | null
    source?: string
    incomplete?: boolean
    note?: string
  }>
  income_sources: Array<{ name: string; amount: number; count: number }>
  investments: {
    total_invested: number
    total_current: number
    pnl: number
    holdings: Array<{
      name: string
      asset_class: string
      invested: number
      current_value: number
      pnl: number
      pnl_pct: number
      count: number
    }>
    asset_allocation: Array<{ name: string; value: number }>
    monthly: Array<{
      month: string
      invested: number
      returned: number
      cumulative: number
    }>
    note: string
  }
  indmoney_snapshot?: {
    total_networth: number
    total_invested: number
    total_current_value: number
    liabilities: number
    captured_at: string | null
    source?: string
  } | null
  alerts: AnalyticsAlert[]
  filters: { banks: string[] }
}

export const DEFAULT_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Shopping',
  'Travel & Transport',
  'Bills & Utilities',
  'Entertainment',
  'Health & Wellness',
  'Investments',
  'Transfers',
  'Education',
  'Subscriptions',
  'Income',
  'Other',
] as const

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  upi: 'UPI',
  bank_account: 'Bank account',
}

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
