import type { CardType, DetailedReport, MerchantSpend, MonthlyBucket, Summary, Transaction, TxnType } from './types'

/**
 * Resolve API base at call time.
 * On Vercel preview/prod hosts, always use the same-origin `/api` rewrite so we
 * avoid CORS failures when Render only allows the production origin.
 */
function resolveApiBase(): string {
  if (typeof window !== 'undefined' && /\.vercel\.app$/i.test(window.location.hostname)) {
    return '/api'
  }
  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return import.meta.env.DEV ? 'http://localhost:8000' : '/api'
}

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (detail == null) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'msg' in item) {
        const loc = Array.isArray((item as { loc?: unknown }).loc)
          ? (item as { loc: unknown[] }).loc.join('.')
          : ''
        const msg = String((item as { msg: unknown }).msg)
        return loc ? `${loc}: ${msg}` : msg
      }
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
    return parts.filter(Boolean).join('; ') || fallback
  }
  if (typeof detail === 'object') {
    try {
      return JSON.stringify(detail)
    } catch {
      return fallback
    }
  }
  return String(detail)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${resolveApiBase()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body.detail !== undefined) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(formatErrorDetail(detail, `Request failed (${res.status})`))
  }
  return res.json() as Promise<T>
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

export function backfillCategories(force = false): Promise<{
  scanned: number
  updated: number
  by_category: Record<string, number>
}> {
  return request(`/categories/backfill?force=${force ? 'true' : 'false'}`, {
    method: 'POST',
  })
}

export function fetchDetailedReport(params: {
  date_from?: string
  date_to?: string
  merchant_limit?: number
} = {}): Promise<DetailedReport> {
  const qs = new URLSearchParams()
  if (params.date_from) qs.set('date_from', params.date_from)
  if (params.date_to) qs.set('date_to', params.date_to)
  if (params.merchant_limit != null) qs.set('merchant_limit', String(params.merchant_limit))
  const q = qs.toString()
  return request(`/reports/detailed${q ? `?${q}` : ''}`)
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

  const res = await fetch(`${resolveApiBase()}/statements/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body.detail !== undefined) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(formatErrorDetail(detail, `Upload failed (${res.status})`))
  }
  return res.json() as Promise<StatementImportResult>
}

export { resolveApiBase }
