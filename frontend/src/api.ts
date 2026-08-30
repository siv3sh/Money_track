import type { AnalyticsPayload, CardType, Transaction, TxnType } from './types'

// Dev default: same-origin /api (Vite proxies to uvicorn). Override with VITE_API_URL if needed.
const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:8000')

const TOKEN_KEY = 'money-track-token'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function logoutLocal(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export type AuthUser = {
  id: string
  email: string
  setup_completed?: boolean
  setup_platform?: 'ios' | 'android' | string | null
  onboarding_completed?: boolean
  created_at?: string | null
}

export type LinkedAccount = {
  id: string
  kind: string
  identifier: string
  label: string
  linked_at?: string | null
  last_seen_at?: string | null
  active?: boolean
  platform?: string | null
  webhook_token?: string
  webhook_url?: string | null
  email_webhook_url?: string | null
  webhook_url_hint?: string
}

function apiErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string' && item.trim()) return item.trim()
        if (item && typeof item === 'object' && 'msg' in item) {
          const msg = String((item as { msg: unknown }).msg || '').trim()
          const loc = (item as { loc?: unknown }).loc
          const where = Array.isArray(loc) ? loc.filter((p) => p !== 'body').join('.') : ''
          return where && msg ? `${where}: ${msg}` : msg
        }
        try {
          return JSON.stringify(item)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  if (detail && typeof detail === 'object') {
    try {
      const s = JSON.stringify(detail)
      if (s && s !== '{}' && s !== '[]') return s
    } catch {
      /* ignore */
    }
  }
  return fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  const token = getStoredToken()
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    })
  try {
    try {
      res = await doFetch()
    } catch {
      // One retry helps Render free-tier cold starts / brief network blips.
      await new Promise((r) => setTimeout(r, 1200))
      res = await doFetch()
    }
  } catch {
    throw new Error(
      `Cannot reach API at ${API_BASE}. Start the backend (uvicorn on port 8000) and retry.`,
    )
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    logoutLocal()
  }
  if (!res.ok) {
    const fallback = `Request failed (${res.status})`
    let detail = res.statusText || fallback
    try {
      const body = (await res.json()) as { detail?: unknown }
      detail = apiErrorMessage(body.detail, detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail || fallback)
  }
  return res.json() as Promise<T>
}

export function loginRequest(
  email: string,
  password: string,
): Promise<{ access_token: string; token_type: string; user: AuthUser }> {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function registerRequest(payload: {
  email: string
  password: string
  signup_code?: string
}): Promise<{ access_token: string; token_type: string; user: AuthUser }> {
  return request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      signup_code: payload.signup_code || undefined,
    }),
  })
}

export function fetchMe(): Promise<AuthUser> {
  return request('/auth/me')
}

export function saveSetup(payload: {
  platform: 'ios' | 'android'
  setup_completed?: boolean
}): Promise<AuthUser> {
  return request('/auth/setup', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setup_completed: true, ...payload }),
  })
}

export function saveOnboarding(payload: {
  onboarding_completed?: boolean
} = {}): Promise<AuthUser> {
  return request('/auth/onboarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboarding_completed: true, ...payload }),
  })
}

export function fetchLinkedAccounts(reveal = false): Promise<{
  items: LinkedAccount[]
  webhook_base: string
}> {
  return request(`/linked-accounts${reveal ? '?reveal=true' : ''}`)
}

export function createLinkedAccount(payload: {
  label: string
  identifier: string
  kind?: 'phone' | 'bank_source' | 'email'
  platform?: 'ios' | 'android' | 'email' | null
}): Promise<LinkedAccount> {
  return request('/linked-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateLinkedAccount(
  id: string,
  payload: {
    label?: string
    identifier?: string
    platform?: 'ios' | 'android'
  },
): Promise<LinkedAccount> {
  return request(`/linked-accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function rotateLinkedAccountToken(id: string): Promise<LinkedAccount> {
  return request(`/linked-accounts/${id}/rotate-token`, { method: 'POST' })
}

export function deleteLinkedAccount(id: string): Promise<{ ok: boolean }> {
  return request(`/linked-accounts/${id}`, { method: 'DELETE' })
}

export interface AnalyticsQuery {
  date_from?: string
  date_to?: string
  bank?: string[]
  /** Skip SIP/drift/smart insights — much faster for dashboard charts. */
  lite?: boolean
}

export function fetchAnalytics(query: AnalyticsQuery = {}): Promise<AnalyticsPayload> {
  const params = new URLSearchParams()
  if (query.date_from) params.set('date_from', query.date_from)
  if (query.date_to) params.set('date_to', query.date_to)
  if (query.bank?.length) params.set('bank', query.bank.join(','))
  if (query.lite) params.set('lite', 'true')
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
  q?: string
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
  if (query.q) params.set('q', query.q)
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
): Promise<{
  ok: boolean
  transaction: Transaction
  advisor_comment?: AdvisorComment
  goal_impact?: GoalImpact
}> {
  return request(`/transactions/${id}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, remember_merchant }),
  })
}

export interface StatementImportResult {
  imported: number
  skipped_duplicates: number
  skipped_likely_duplicates?: number
  parsed: number
  ids: string[]
  pipeline_stage?: string
  pipeline_stages?: string[]
  detected?: {
    bank?: string
    product?: string
    default_card_type?: string
    confidence?: string
    is_credit_card_statement?: boolean
  } | null
  analysis?: {
    debit_total: number
    credit_total: number
    investment_debit: number
    credit_card_spend: number
    by_category: Array<{ category: string; count: number }>
    by_card_type: Array<{ card_type: string; count: number }>
    highlights: string[]
    ai_note?: string | null
    ai_updated?: number
  } | null
  agent?: {
    protocol?: string
    stage?: string
    stages?: string[]
    steps?: Array<{
      tool: string
      status: string
      detail: string
      evidence?: Record<string, unknown>
    }>
    rag_hits?: number
    rag_categorized?: number
    warnings?: string[]
    vector_backend?: string
    review_queue_count?: number
    review_questions?: Array<Record<string, unknown>>
    anomalies?: Array<Record<string, unknown>>
  } | null
  review_queue?: Array<{
    merchant?: string
    amount?: number
    type?: string
    category?: string
    confidence?: number
    reason?: string
  }>
  likely_duplicates?: Array<{
    incoming_merchant: string
    amount: number
    type: string
    received_at: string | null
    matched_existing_source?: string
    matched_existing_merchant?: string
    reason: string
  }>
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
    const fallback = `Upload failed (${res.status})`
    let detail = res.statusText || fallback
    try {
      const body = (await res.json()) as { detail?: unknown }
      detail = apiErrorMessage(body.detail, detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail || fallback)
  }
  return res.json() as Promise<StatementImportResult>
}

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    const fallback = `Request failed (${res.status})`
    let detail = res.statusText || fallback
    try {
      const body = (await res.json()) as { detail?: unknown }
      detail = apiErrorMessage(body.detail, detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail || fallback)
  }
  return res.json() as Promise<T>
}

export interface IndmoneyPreview {
  filename: string
  headers: string[]
  row_count: number
  sample_rows: Array<Record<string, unknown>>
  suggested_mapping: Record<string, string | null>
  fields: Array<{ key: string; label: string; required: boolean }>
  mapping_confidence?: number
  needs_mapping_ui?: boolean
  pipeline_stage?: string
  pipeline_stages?: string[]
  header_signature?: string
  agent?: {
    protocol?: string
    steps?: Array<{
      tool: string
      status: string
      detail: string
      evidence?: Record<string, unknown>
    }>
    warnings?: string[]
    vector_backend?: string
    sheets?: Array<Record<string, unknown>>
  }
}

export interface IndmoneyValidateResult {
  ok: boolean
  error?: string
  valid: Array<{
    name: string
    asset_class: string
    invested: number
    current_value: number
    units: number | null
    as_of_date: string | null
    instrument_key: string
  }>
  errors: Array<{ row: number; issue: string; instrument?: string }>
  summary: {
    valid: number
    errors: number
    duplicates_in_file: number
    total_invested?: number
    total_current?: number
  }
}

export function previewIndmoneyFile(file: File): Promise<IndmoneyPreview> {
  const form = new FormData()
  form.append('file', file)
  return postForm('/indmoney/preview', form)
}

export function validateIndmoneyFile(
  file: File,
  mapping: Record<string, string | null>,
): Promise<IndmoneyValidateResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('mapping_json', JSON.stringify(mapping))
  return postForm('/indmoney/validate', form)
}

export function commitIndmoneyFile(
  file: File,
  mapping: Record<string, string | null>,
): Promise<{
  ok: boolean
  import: { inserted: number; updated: number; total: number }
  summary: IndmoneyValidateResult['summary']
  errors: IndmoneyValidateResult['errors']
  holdings: PortfolioResponse
}> {
  const form = new FormData()
  form.append('file', file)
  form.append('mapping_json', JSON.stringify(mapping))
  return postForm('/indmoney/commit', form)
}

export interface AiStatus {
  configured: string
  active: string | null
  ollama: { available: boolean; base_url: string; model: string }
  gemini: { available: boolean; model: string; key_configured: boolean }
}

export function fetchAiStatus(): Promise<AiStatus> {
  return request('/ai/status')
}

export function aiAsk(
  question: string,
  opts: { date_from?: string; date_to?: string; provider?: string } = {},
): Promise<{ answer: string; provider: string }> {
  return request('/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, ...opts }),
  })
}

export function aiMonthlySummary(opts: {
  date_from?: string
  date_to?: string
  provider?: string
} = {}): Promise<{ summary: string; provider: string }> {
  const qs = new URLSearchParams()
  if (opts.date_from) qs.set('date_from', opts.date_from)
  if (opts.date_to) qs.set('date_to', opts.date_to)
  if (opts.provider) qs.set('provider', opts.provider)
  const q = qs.toString()
  return request(`/ai/monthly-summary${q ? `?${q}` : ''}`, { method: 'POST' })
}

export function aiAnomalies(opts: {
  date_from?: string
  date_to?: string
  provider?: string
} = {}): Promise<{ insights: string[]; provider: string }> {
  const qs = new URLSearchParams()
  if (opts.date_from) qs.set('date_from', opts.date_from)
  if (opts.date_to) qs.set('date_to', opts.date_to)
  if (opts.provider) qs.set('provider', opts.provider)
  const q = qs.toString()
  return request(`/ai/anomalies${q ? `?${q}` : ''}`, { method: 'POST' })
}

export interface TallyPack {
  status: 'makes_sense' | 'mostly' | 'odd' | 'tallies' | 'gaps' | string
  overview: {
    total_debit: number
    total_credit: number
    net: number
    debit_count: number
    credit_count: number
    txn_count: number
  }
  identity: {
    lifestyle_debit: number
    investments_debit: number
    transfers_debit: number
    other_debit: number
    income_credit: number
    explained_outflow: number
    outflow_gap: number
    lifestyle_to_credit_pct?: number | null
    invest_to_credit_pct?: number | null
  }
  credit_card: {
    spend: number
    likely_payments: number
    gap: number
  }
  peak_spend_day?: { date: string; amount: number } | null
  largest_debits?: Array<{
    amount: number
    merchant: string
    category: string
    bank: string
    date?: string | null
  }>
  top_merchants?: Array<{ merchant: string; amount: number; count: number }>
  by_bank: Array<{ name: string; debit: number; credit: number; net: number; count: number }>
  sense_flags?: Array<{
    code: string
    severity: string
    title: string
    message: string
  }>
  issues: Array<{
    code: string
    severity: string
    title: string
    message: string
    amount?: number
  }>
  sms_liquid_total?: number
  balances?: Array<{ bank: string; account_last4?: string | null; balance: number; as_of?: string | null }>
}

export interface TallyAi {
  verdict: 'makes_sense' | 'mostly' | 'odd' | 'tallies' | 'gaps' | string
  headline: string
  summary: string
  checks: Array<{ label: string; ok: boolean; detail: string }>
  actions: string[]
  provider?: string
}

export function aiTally(opts: {
  date_from?: string
  date_to?: string
  provider?: string
  use_llm?: boolean
} = {}): Promise<{ tally: TallyPack; ai: TallyAi | null; provider?: string }> {
  const qs = new URLSearchParams()
  if (opts.date_from) qs.set('date_from', opts.date_from)
  if (opts.date_to) qs.set('date_to', opts.date_to)
  if (opts.provider) qs.set('provider', opts.provider)
  if (opts.use_llm != null) qs.set('use_llm', String(opts.use_llm))
  const q = qs.toString()
  return request(`/ai/tally${q ? `?${q}` : ''}`, { method: 'POST' })
}

export function aiCategorize(opts: {
  limit?: number
  use_llm?: boolean
  provider?: string
} = {}): Promise<{
  scanned: number
  updated: number
  llm_applied: number
  memory_applied?: number
  remaining_other: number
  suggestions: Array<{ id: string; category: string; source: string; merchant?: string }>
  llm_error?: string
}> {
  const qs = new URLSearchParams()
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  if (opts.use_llm != null) qs.set('use_llm', String(opts.use_llm))
  if (opts.provider) qs.set('provider', opts.provider)
  const q = qs.toString()
  return request(`/ai/categorize${q ? `?${q}` : ''}`, { method: 'POST' })
}

export type LearnedFactType =
  | 'category_intent'
  | 'budget_target'
  | 'risk_tolerance'
  | 'one_off_context'
  | 'spending_intent'
  | 'merchant_correction'
  | 'income_profile'

export interface LearnedFact {
  id: string
  fact_type: LearnedFactType | string
  key: string
  value: string | number
  confidence?: string
  source?: string
  meta?: Record<string, unknown>
  plain_language: string
  group: string
  created_at?: string | null
  last_confirmed_at?: string | null
}

export interface LearnQuestion {
  id: string
  fact_type: LearnedFactType | string
  key: string
  priority: number
  prompt: string
  choices: Array<{ id: string; label: string }>
  allow_free_text?: boolean
  skip_label?: string
  meta?: Record<string, unknown>
}

export function fetchLearnedFacts(): Promise<{ facts: LearnedFact[] }> {
  return request('/learn/facts')
}

export function createLearnedFact(payload: {
  fact_type: string
  key: string
  value: string | number
  plain_language?: string
  meta?: Record<string, unknown>
  source?: string
}): Promise<{ fact: LearnedFact }> {
  return request('/learn/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function pasteBankEmail(payload: {
  from?: string
  subject?: string
  text?: string
  html?: string
}): Promise<{
  stored: boolean
  reason?: string
  id?: string
  transaction?: Record<string, unknown>
  hint?: string
}> {
  return request('/email-ingest/paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateLearnedFact(
  id: string,
  payload: { value?: string | number; plain_language?: string },
): Promise<{ fact: LearnedFact }> {
  return request(`/learn/facts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function deleteLearnedFact(id: string): Promise<{ ok: boolean }> {
  return request(`/learn/facts/${id}`, { method: 'DELETE' })
}

export function fetchLearnQuestions(opts: {
  date_from?: string
  date_to?: string
} = {}): Promise<{ questions: LearnQuestion[]; weekly_limit: number }> {
  const qs = new URLSearchParams()
  if (opts.date_from) qs.set('date_from', opts.date_from)
  if (opts.date_to) qs.set('date_to', opts.date_to)
  const q = qs.toString()
  return request(`/learn/questions${q ? `?${q}` : ''}`)
}

export function answerLearnQuestion(payload: {
  question_id: string
  fact_type: string
  key: string
  choice_id?: string
  free_text?: string
  choices?: Array<{ id: string; label: string }>
  meta?: Record<string, unknown>
}): Promise<{ fact: LearnedFact; ok: boolean }> {
  return request('/learn/questions/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function skipLearnQuestion(payload: {
  question_id: string
  fact_type?: string
  key?: string
}): Promise<{ ok: boolean }> {
  return request('/learn/questions/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export interface TransferSuggestion {
  id: string
  amount: number
  merchant: string
  bank?: string
  received_at?: string
  label: 'self_transfer' | 'actual_spend' | string
  confidence: number
  suggested_category: string
  reason: string
  provider?: string
}

export function fetchTransferSuggestions(): Promise<{ suggestions: TransferSuggestion[] }> {
  return request('/ai/transfer-suggestions')
}

export function runDisambiguateTransfers(opts: {
  limit?: number
  provider?: string
} = {}): Promise<{
  scanned: number
  stored: number
  provider: string | null
  suggestions: TransferSuggestion[]
}> {
  const qs = new URLSearchParams()
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  if (opts.provider) qs.set('provider', opts.provider)
  const q = qs.toString()
  return request(`/ai/disambiguate-transfers${q ? `?${q}` : ''}`, { method: 'POST' })
}

export function reviewTransferSuggestion(
  txnId: string,
  action: 'approve' | 'reject',
): Promise<{ ok: boolean; action: string; category?: string }> {
  return request(`/ai/transfer-suggestions/${txnId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

export function markSipInvested(
  instrument: string,
  month?: string,
): Promise<{ ok: boolean; advisor_comment?: AdvisorComment }> {
  return request('/smart/sip/mark-invested', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instrument, month }),
  })
}

export function saveDriftBaseline(threshold_pp = 10): Promise<{
  targets: Record<string, number>
  baseline: Record<string, number>
  threshold_pp: number
}> {
  return request('/smart/drift-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold_pp, use_current_as_baseline: true }),
  })
}

export interface LiabilityItem {
  id?: string
  name: string
  type: string
  outstanding: number
  due_date?: string | null
  available_limit?: number | null
  source?: 'manual' | 'credit_cards' | string
  bank?: string | null
  last4?: string | null
  updated_at?: string | null
  last_updated?: string | null
}

export function fetchLiabilities(): Promise<{ items: LiabilityItem[]; total: number }> {
  return request('/liabilities')
}

export function saveLiabilities(
  items: Array<{ name: string; type: string; outstanding: number; last_updated?: string | null }>,
): Promise<{ items: LiabilityItem[]; total: number }> {
  return request('/liabilities', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

export function exportDataUrl(format: 'json' | 'csv' = 'json'): string {
  return `${API_BASE}/export?format=${format}`
}

export { API_BASE }

export interface MonthlyReportSettings {
  email_enabled: boolean
  recipient_email: string
  email_configured: boolean
}

export interface MonthlyReportListItem {
  id: string
  month: string
  label?: string
  generated_at?: string | null
  emailed_at?: string | null
  headline?: {
    savings_rate_pct?: number | null
    net_worth_estimate?: number
    lifestyle_spend?: number
    vs_prior_lifestyle_pct?: number | null
  }
  summary_preview?: string
}

export interface MonthlyReport {
  id?: string
  month: string
  label: string
  generated_at?: string | null
  emailed_at?: string | null
  stats: {
    history_ok: boolean
    current: Record<string, unknown> & {
      lifestyle_spend: number
      total_credit: number
      total_debit: number
      credit_card_spend?: number
      savings_rate_pct?: number | null
      categories?: Array<{ name: string; debit: number; count?: number }>
      top_merchants?: Array<{ name: string; amount: number; count?: number }>
    }
    previous: Record<string, unknown>
    ytd: {
      lifestyle_spend: number
      total_credit: number
      investments_debit: number
      savings_rate_pct?: number | null
    }
    category_changes: Array<{
      name: string
      current: number
      previous: number
      change_inr: number
      change_pct: number
    }>
    headline_metric: {
      savings_rate_pct?: number | null
      net_worth_estimate: number
      lifestyle_spend: number
      vs_prior_lifestyle_pct?: number | null
    }
    news: {
      entities: string[]
      headlines: Array<{ title: string; source?: string; url?: string }>
      note?: string | null
    }
    tax_flags: Array<{ type: string; message: string }>
    sip?: unknown
    drift?: unknown
    month_end_review?: {
      leakages?: Array<{
        kind?: string
        name?: string
        amount?: number | null
        change_inr?: number | null
        change_pct?: number | null
        message: string
      }>
      big_spends?: Array<{
        name: string
        amount: number
        count?: number
        share?: number | null
        message: string
      }>
      checklist?: Array<{
        id: string
        status: 'action' | 'watch' | 'ok' | string
        title: string
        detail?: string
      }>
      recommendations?: Array<{
        text: string
        inr_impact?: number | null
        source?: string
      }>
    }
  }
  narrative: {
    summary: string
    going_well: string[]
    suggestions: Array<{ text: string; inr_impact?: number | null }>
    market_context: string
    tax_notes: string[]
    ytd_snapshot: string
    provider?: string
  }
}

export function fetchMonthlyReports(): Promise<{
  reports: MonthlyReportListItem[]
  settings: MonthlyReportSettings
}> {
  return request('/reports/monthly')
}

export function fetchMonthlyReport(month: string): Promise<MonthlyReport> {
  return request(`/reports/monthly/${month}`)
}

export function monthlyReportPdfUrl(month: string): string {
  return `${API_BASE}/reports/monthly/${encodeURIComponent(month)}/pdf`
}

export async function downloadMonthlyReportPdf(month: string): Promise<void> {
  const token = getStoredToken()
  const res = await fetch(monthlyReportPdfUrl(month), {
    headers: {
      Accept: 'application/pdf',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`PDF download failed (${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `money-track-${month}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function saveMonthlyReportSettings(payload: {
  email_enabled: boolean
  recipient_email: string
}): Promise<MonthlyReportSettings> {
  return request('/reports/monthly-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function generateMonthlyReport(opts: {
  year?: number
  month?: number
  force?: boolean
  provider?: string
  send_email?: boolean
} = {}): Promise<{
  report: MonthlyReport
  email: { ok?: boolean; reason?: string; sent_at?: string } | null
}> {
  return request('/reports/monthly/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
}

// ── Money Planning ──────────────────────────────────────────────────────────

export type PlanningBucket = 'Needs' | 'Investments' | 'Discretionary' | 'Buffer'

export interface PlanningGoal {
  id: string
  name: string
  target_price: number
  manual_price?: number | null
  saved_amount: number
  monthly_contribution: number
  target_date?: string | null
  priority: number
  status: string
  price_lookup?: {
    approx_price_inr?: number
    sources?: Array<{ retailer: string; note?: string }>
    confidence?: string
    looked_up_at?: string
    summary?: string
    error?: string
  } | null
  timing_note?: string | null
  streak_months?: number
  contribution_months?: string[]
  remaining?: number
  progress_pct?: number
  allocated_monthly?: number
  effective_monthly_pace?: number
  months_needed?: number | null
  projected_date?: string | null
  status_line?: string
  behind_pace?: boolean
  suggested_monthly?: number
  funding?: {
    lump_sum_available: number
    monthly_needed_after_lump: number
    months_with_lump?: number | null
    note?: string
  }
  opportunity_cost?: {
    interest_avoided_approx: number
    message: string
  }
  milestones?: number[]
  completion_txn_id?: string | null
}

export interface PlanningSummary {
  month: string
  label: string
  settings: {
    bucket_pcts: Record<PlanningBucket, number>
    category_buckets: Record<string, PlanningBucket>
    emi_annual_rate: number
    emi_tenure_months: number
    liquid_buffer_override?: number | null
  }
  framework: {
    income_base: number
    income_source: string
    bucket_pcts: Record<PlanningBucket, number>
    template: Record<PlanningBucket, number>
    actual: Record<PlanningBucket, number>
    comparison: Array<{
      bucket: PlanningBucket
      wealth_class: string
      template_pct: number
      template_inr: number
      actual_inr: number
      delta_inr: number
      actual_pct_of_income: number
      categories: Array<{ category: string; amount: number }>
    }>
    available_surplus: number
    disc_overshoot?: number
    buffer_leftover?: number
    surplus_if_on_plan?: number
    surplus_note: string
  }
  liquid_buffer_estimate: number
  goals: PlanningGoal[]
  allocations: Record<string, number>
  priority_conflict: boolean
  priority_note?: string | null
  advisor?: {
    score: number
    score_label: string
    headline: string
    focus_goal: {
      goal_id?: string
      name: string
      progress_pct: number
      saved: number
      target: number
      remaining: number
      status_line?: string
      months_at_unlocked_pace?: number | null
      unlocked_monthly?: number
      opportunity_message?: string
      streak_months?: number
      funding?: PlanningGoal['funding']
    } | null
    cut_to_unlock: {
      status: string
      headline: string
      overshoot_inr: number
      unlock_surplus_inr: number
      available_surplus_inr: number
      cuts: Array<{
        category: string
        merchant?: string | null
        current_spend: number
        cut_by: number
        action: string
      }>
      steps: string[]
      keep?: Array<{ name: string; amount: number }>
      keep_note?: string | null
    }
    salary_day: {
      title: string
      subtitle: string
      income_base: number
      steps: Array<{
        order: number
        label: string
        amount: number
        note: string
        protected?: boolean
        splits?: Array<{ goal_id: string; name: string; monthly: number; lump_from_buffer: number }>
      }>
    }
    methods: Array<{
      id: string
      name: string
      origin: string
      rule: string
      on_track: boolean
      verdict: string
    }>
    next_actions: string[]
    rules: string[]
    personalization_note?: string | null
    voice?: {
      mood: string
      intensity: string
      tone: string
      opener: string
      strict_line: string
      heart: string
      closer: string
      training_nudge?: string | null
      address_as?: string
    }
    advisor_severity?: {
      level?: string
      reasons?: string[]
      context_line?: string
    }
    profile?: {
      preferred_name?: string
      coach_tone?: string
      soft_spot?: string | null
      dealbreaker?: string | null
      why_money?: string | null
      pride?: string | null
      strict_on?: string | null
      motivation?: string | null
      completeness?: number
      trained_keys?: string[]
    }
    your_spend?: {
      income_base: number
      discretionary_merchants: Array<{
        name: string
        amount: number
        protected?: boolean
        category?: string
      }>
    }
  }
}

export function fetchPlanningSummary(month?: string): Promise<PlanningSummary> {
  const qs = month ? `?month=${encodeURIComponent(month)}` : ''
  return request(`/planning/summary${qs}`)
}

export function savePlanningSettings(payload: {
  bucket_pcts?: Partial<Record<PlanningBucket, number>>
  category_buckets?: Record<string, PlanningBucket>
  emi_annual_rate?: number
  emi_tenure_months?: number
  liquid_buffer_override?: number | null
}): Promise<PlanningSummary['settings']> {
  return request('/planning/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function createPlanningGoal(payload: {
  name: string
  target_date?: string
  manual_price?: number
  monthly_contribution?: number
  lookup_price?: boolean
}): Promise<{ goal: PlanningGoal; needs_price_confirm: boolean }> {
  return request('/planning/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updatePlanningGoal(
  id: string,
  payload: Partial<{
    name: string
    target_date: string | null
    manual_price: number
    target_price: number
    saved_amount: number
    monthly_contribution: number
    priority: number
    status: string
    confirm_price: boolean
    timing_note: string | null
  }>,
): Promise<{ goal: PlanningGoal }> {
  return request(`/planning/goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function lookupPlanningGoalPrice(id: string): Promise<{ goal: PlanningGoal; lookup: PlanningGoal['price_lookup'] }> {
  return request(`/planning/goals/${id}/lookup-price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export function contributePlanningGoal(
  id: string,
  amount: number,
): Promise<{ goal: PlanningGoal; advisor_comment?: AdvisorComment }> {
  return request(`/planning/goals/${id}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
}

export function reorderPlanningGoals(ordered_ids: string[]): Promise<PlanningSummary> {
  return request('/planning/goals/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordered_ids }),
  })
}

export function completePlanningGoal(
  id: string,
  amount?: number,
): Promise<{
  goal: PlanningGoal
  transaction: { transaction_id: string; amount: number; category: string }
  note: string
  advisor_comment?: AdvisorComment
}> {
  return request(`/planning/goals/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(amount != null ? { amount } : {}),
  })
}

export function deletePlanningGoal(id: string): Promise<{ ok: boolean }> {
  return request(`/planning/goals/${id}`, { method: 'DELETE' })
}

export interface AdvisorTrainingQuestion {
  key: string
  prompt: string
  placeholder?: string
  hint?: string
  options?: string[]
  answered?: boolean
  value?: string | null
}

export interface AdvisorTrainingStatus {
  completeness: number
  ready: boolean
  profile: Record<string, unknown>
  questions: AdvisorTrainingQuestion[]
}

export function fetchAdvisorTraining(): Promise<AdvisorTrainingStatus> {
  return request('/planning/advisor/training')
}

export function saveAdvisorTraining(
  answers: Array<{ key: string; value: string }>,
): Promise<{ saved: number; training: AdvisorTrainingStatus }> {
  return request('/planning/advisor/training', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
}

export interface AdvisorPersonaSettings {
  persona_text: string
  strictness_sensitivity: number
  version: number
  updated_at?: string | null
  using_file_default?: boolean
  default_persona_text?: string
  preview?: {
    samples: {
      informational: string
      concerned: string
      strict: string
    }
    note?: string
  }
}

export function fetchAdvisorPersona(): Promise<AdvisorPersonaSettings> {
  return request('/advisor/persona')
}

export function saveAdvisorPersona(payload: {
  persona_text?: string
  strictness_sensitivity?: number
  reset_persona_to_default?: boolean
}): Promise<AdvisorPersonaSettings> {
  return request('/advisor/persona', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export interface AdvisorComment {
  comment: string
  advisor_severity?: string
  goal_name?: string
  progress_pct?: number | null
  preferred_name?: string
}

export interface GoalImpact {
  comment?: string | null
  impact?: {
    goal_name: string
    remaining: number
    months_now?: number | null
    months_if_redirected?: number | null
    delta_months?: number | null
    amount: number
  } | null
  preferred_name?: string
}

export interface AdvisorChatMessage {
  role: string
  content: string
  at?: string
  meta?: Record<string, unknown>
}

export interface AdvisorNudge {
  id: string
  kind: string
  severity?: string
  title?: string
  message?: string
  source?: string
  question?: Record<string, unknown>
}

export interface AdvisorPresence {
  session: {
    id?: string
    session_key: string
    messages: AdvisorChatMessage[]
  }
  briefing?: {
    preferred_name?: string
    level?: string
    headline?: string
  }
  advisor_severity?: { level?: string; reasons?: string[] }
  nudges: AdvisorNudge[]
  memories: Array<{ id: string; kind: string; summary: string; occurred_at?: string }>
  profile?: {
    preferred_name?: string
    completeness?: number
    motivation?: string
    soft_spot?: string
  }
}

export function fetchAdvisorPresence(opts?: { light?: boolean }): Promise<AdvisorPresence> {
  const q = opts?.light ? '?light=true' : ''
  return request(`/advisor/presence${q}`)
}

export function sendAdvisorChat(
  message: string,
  provider?: string,
): Promise<{
  answer: string
  provider: string
  session: AdvisorPresence['session']
  advisor_severity?: { level?: string }
  briefing?: AdvisorPresence['briefing']
  remembered?: string
}> {
  return request('/advisor/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, provider }),
  })
}

export function answerAdvisorNudge(payload: {
  kind: string
  nudge_id: string
  answer: string
  free_text?: string
}): Promise<{
  ok: boolean
  kind: string
  nudge_id: string
  answer: string
  remembered?: string
  ack?: string
  session?: AdvisorPresence['session']
}> {
  return request('/advisor/nudge/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
