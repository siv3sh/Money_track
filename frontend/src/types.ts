export type TxnType = 'debit' | 'credit'
export type CardType = 'credit_card' | 'debit_card' | 'upi' | 'bank_account'

/** Matches parser.Transaction + fields added when stored in MongoDB. */
export interface Transaction {
  _id: string
  type: TxnType
  amount: number
  account_last4: string | null
  card_type: CardType | null
  merchant: string | null
  balance: number | null
  bank: string | null
  raw_text: string
  sender?: string
  received_at: string
}

export interface Summary {
  total_debit: number
  total_credit: number
  net: number
  count: number
  this_month_debit: number
  this_month_credit: number
  this_month_net: number
  last_month_debit: number
  last_month_credit: number
  last_month_net: number
}

export interface MonthlyBucket {
  month: string
  debit: number
  credit: number
  net: number
  count: number
}

export interface MerchantSpend {
  merchant: string
  amount: number
  count: number
}

export interface ReportBreakdownRow {
  name: string
  debit: number
  credit: number
  net: number
  count: number
  debit_share: number
}

export interface ReportMerchantRow {
  merchant: string
  amount: number
  count: number
  avg: number
  share: number
}

export interface ReportDailyRow {
  date: string
  debit: number
  credit: number
  net: number
  count: number
}

export interface ReportWeekdayRow {
  day: string
  amount: number
  count: number
}

export interface DetailedReport {
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
  }
  by_bank: ReportBreakdownRow[]
  by_card_type: ReportBreakdownRow[]
  by_source: ReportBreakdownRow[]
  merchants: ReportMerchantRow[]
  daily: ReportDailyRow[]
  weekday: ReportWeekdayRow[]
  monthly: MonthlyBucket[]
  largest: Transaction[]
}

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  upi: 'UPI',
  bank_account: 'Bank account',
}
