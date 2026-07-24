import type { CardType, MerchantSpend, MonthlyBucket, Summary, Transaction, TxnType } from './types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface TransactionQuery {
  limit?: number
  skip?: number
  card_type?: CardType | ''
  bank?: string
  type?: TxnType | ''
  date_from?: string
  date_to?: string
  sort?: 'received_at' | 'amount'
  order?: 'asc' | 'desc'
}

export function fetchSummary(): Promise<Summary> {
  return request('/summary')
}

export function fetchMonthly(months = 12): Promise<MonthlyBucket[]> {
  return request(`/summary/monthly?months=${months}`)
}

export function fetchMerchants(limit = 10): Promise<MerchantSpend[]> {
  return request(`/summary/merchants?limit=${limit}`)
}

export function fetchTransactions(query: TransactionQuery = {}): Promise<Transaction[]> {
  const params = new URLSearchParams()
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.skip != null) params.set('skip', String(query.skip))
  if (query.card_type) params.set('card_type', query.card_type)
  if (query.bank) params.set('bank', query.bank)
  if (query.type) params.set('type', query.type)
  if (query.date_from) params.set('date_from', query.date_from)
  if (query.date_to) params.set('date_to', query.date_to)
  if (query.sort) params.set('sort', query.sort)
  if (query.order) params.set('order', query.order)
  const qs = params.toString()
  return request(`/transactions${qs ? `?${qs}` : ''}`)
}

export function deleteTransaction(id: string): Promise<{ ok: boolean }> {
  return request(`/transactions/${id}`, { method: 'DELETE' })
}

export { API_BASE }
