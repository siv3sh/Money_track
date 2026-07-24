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

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  upi: 'UPI',
  bank_account: 'Bank account',
}
