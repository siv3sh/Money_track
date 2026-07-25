import type { AnalyticsPayload, CardType, Transaction, TxnType } from './types'

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

export interface AnalyticsQuery {
  date_from?: string
  date_to?: string
  bank?: string[]
}

export function fetchAnalytics(query: AnalyticsQuery = {}): Promise<AnalyticsPayload> {
  const params = new URLSearchParams()
  if (query.date_from) params.set('date_from', query.date_from)
  if (query.date_to) params.set('date_to', query.date_to)
  if (query.bank?.length) params.set('bank', query.bank.join(','))
  const qs = params.toString()
  return request(`/analytics${qs ? `?${qs}` : ''}`)
}

export interface TransactionQuery {
  limit?: number
  skip?: number
  card_type?: CardType | ''
  bank?: string
  category?: string
  type?: TxnType | ''
  date_from?: string
  date_to?: string
  sort?: 'received_at' | 'amount'
  order?: 'asc' | 'desc'
}

export function fetchTransactions(query: TransactionQuery = {}): Promise<Transaction[]> {
  const params = new URLSearchParams()
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.skip != null) params.set('skip', String(query.skip))
  if (query.card_type) params.set('card_type', query.card_type)
  if (query.bank) params.set('bank', query.bank)
  if (query.category) params.set('category', query.category)
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

export function fetchCategories(): Promise<{ categories: string[] }> {
  return request('/categories')
}

export interface PortfolioHolding {
  name: string
  asset_class: string
  invested: number
  current_value: number
  pnl?: number
  pnl_pct?: number
  updated_at?: string | null
}

export interface PortfolioResponse {
  holdings: PortfolioHolding[]
  total_invested: number
  total_current: number
}

export function fetchPortfolio(): Promise<PortfolioResponse> {
  return request('/portfolio')
}

export function savePortfolio(holdings: PortfolioHolding[]): Promise<PortfolioResponse> {
  return request('/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      holdings: holdings.map((h) => ({
        name: h.name,
        asset_class: h.asset_class,
        invested: h.invested,
        current_value: h.current_value,
      })),
    }),
  })
}

export function updateTransactionCategory(
  id: string,
  category: string,
  remember_merchant = true,
): Promise<{ ok: boolean; transaction: Transaction }> {
  return request(`/transactions/${id}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, remember_merchant }),
  })
}

export interface StatementImportResult {
  imported: number
  skipped_duplicates: number
  parsed: number
  ids: string[]
}

export async function uploadStatementFile(
  file: File,
  bank?: string,
  format: 'auto' | 'csv' | 'text' = 'auto',
): Promise<StatementImportResult> {
  const form = new FormData()
  form.append('file', file)
  if (bank) form.append('bank', bank)
  form.append('format', format)

  const res = await fetch(`${API_BASE}/statements/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Upload failed (${res.status})`)
  }
  return res.json() as Promise<StatementImportResult>
}

export { API_BASE }
