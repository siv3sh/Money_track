import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import {
  deleteTransaction,
  fetchCategories,
  fetchTransactions,
  fetchTransferSuggestions,
  reviewTransferSuggestion,
  updateTransactionCategory,
  type TransferSuggestion,
} from '../api'
import {
  TransactionTable,
  type Filters,
} from '../components/TransactionTable'
import { ChartCard, PageHeader } from '../components/ui'
import { useFilters } from '../context/FilterContext'
import { formatINR } from '../lib/format'
import type { Transaction } from '../types'

const PAGE_SIZE = 40

function monthBounds(month: string): { from: string; to: string } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const from = `${m[1]}-${m[2]}-01`
  const last = new Date(y, mo, 0).getDate()
  const to = `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`
  return { from, to }
}

function filtersFromParams(params: URLSearchParams): Filters & { bank: string; q: string } {
  const month = params.get('month') || ''
  const bounds = month ? monthBounds(month) : null
  return {
    category: params.get('category') || '',
    type: (params.get('type') as Filters['type']) || '',
    card_type: (params.get('card_type') as Filters['card_type']) || '',
    date_from: params.get('date_from') || bounds?.from || '',
    date_to: params.get('date_to') || bounds?.to || '',
    sort: (params.get('sort') as Filters['sort']) || 'received_at',
    order: (params.get('order') as Filters['order']) || 'desc',
    bank: params.get('source') || params.get('bank') || '',
    q: params.get('q') || params.get('search') || '',
  }
}

function paramsFromFilters(f: Filters & { bank: string; q: string }, page: number): URLSearchParams {
  const p = new URLSearchParams()
  if (f.category) p.set('category', f.category)
  if (f.type) p.set('type', f.type)
  if (f.card_type) p.set('card_type', f.card_type)
  if (f.date_from) p.set('date_from', f.date_from)
  if (f.date_to) p.set('date_to', f.date_to)
  if (f.bank) p.set('source', f.bank)
  if (f.q) p.set('q', f.q)
  if (f.sort !== 'received_at') p.set('sort', f.sort)
  if (f.order !== 'desc') p.set('order', f.order)
  if (page > 0) p.set('page', String(page))
  return p
}

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { availableBanks, refresh: refreshAnalytics } = useFilters()
  const initial = useMemo(() => filtersFromParams(searchParams), [searchParams])
  const [filters, setFilters] = useState(initial)
  const [page, setPage] = useState(() => Number(searchParams.get('page') || 0) || 0)
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [transferQueue, setTransferQueue] = useState<TransferSuggestion[]>([])

  useEffect(() => {
    void fetchTransferSuggestions()
      .then((r) => setTransferQueue(r.suggestions))
      .catch(() => setTransferQueue([]))
  }, [])

  // Sync URL → state when deep-linked
  useEffect(() => {
    const next = filtersFromParams(searchParams)
    setFilters(next)
    setPage(Number(searchParams.get('page') || 0) || 0)
  }, [searchParams])

  useEffect(() => {
    void fetchCategories()
      .then((r) => setCategories(r.categories))
      .catch(() => setCategories([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTransactions({
        limit: PAGE_SIZE,
        skip: page * PAGE_SIZE,
        category: filters.category || undefined,
        type: filters.type || undefined,
        card_type: filters.card_type || undefined,
        bank: filters.bank || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        sort: filters.sort,
        order: filters.order,
        q: filters.q || undefined,
      })
      setRows(data)
      setHasMore(data.length >= PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
      setRows([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    void load()
  }, [load])

  const pushFilters = (next: Filters & { bank: string; q: string }, nextPage = 0) => {
    setFilters(next)
    setPage(nextPage)
    setSearchParams(paramsFromFilters(next, nextPage), { replace: true })
  }

  const activeChips = [
    filters.category && `Category: ${filters.category}`,
    filters.bank && `Source: ${filters.bank}`,
    filters.type && `Type: ${filters.type}`,
    filters.q && `Search: ${filters.q}`,
    filters.date_from && `From: ${filters.date_from}`,
    filters.date_to && `To: ${filters.date_to}`,
  ].filter(Boolean) as string[]

  return (
    <div className="fade-in">
      <PageHeader
        title="Transactions"
        description="Browse, search, recategorize, and delete individual SMS and statement rows."
      />

      {activeChips.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {activeChips.map((c) => (
            <span
              key={c}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--muted)]"
            >
              {c}
            </span>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-[var(--accent)]"
            onClick={() =>
              pushFilters({
                category: '',
                type: '',
                card_type: '',
                date_from: '',
                date_to: '',
                sort: 'received_at',
                order: 'desc',
                bank: '',
                q: '',
              })
            }
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {transferQueue.length > 0 ? (
        <ChartCard
          title="Possible self-transfers"
          subtitle="Approve to exclude from lifestyle spend · manage more on AI Insights"
          className="mb-4"
        >
          <ul className="divide-y divide-[var(--border)]">
            {transferQueue.slice(0, 5).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="text-sm">
                  <span className="font-medium">{s.merchant}</span>
                  <span className="text-[var(--muted)]"> · {formatINR(s.amount)}</span>
                  <p className="text-xs text-[var(--muted)]">
                    {s.label === 'self_transfer' ? 'Likely self-transfer' : 'Likely spend'}
                    {s.reason ? ` — ${s.reason}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn text-xs"
                    onClick={async () => {
                      await reviewTransferSuggestion(s.id, 'approve')
                      setTransferQueue((prev) => prev.filter((x) => x.id !== s.id))
                      await load()
                      refreshAnalytics()
                    }}
                  >
                    <Check size={12} />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn text-xs"
                    onClick={async () => {
                      await reviewTransferSuggestion(s.id, 'reject')
                      setTransferQueue((prev) => prev.filter((x) => x.id !== s.id))
                    }}
                  >
                    <X size={12} />
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

      <TransactionTable
        rows={rows}
        filters={filters}
        page={page}
        pageSize={PAGE_SIZE}
        hasMore={hasMore}
        loading={loading}
        categories={categories}
        banks={availableBanks}
        showSearch
        onFiltersChange={(next) =>
          pushFilters({
            ...next,
            bank: 'bank' in next ? String((next as { bank?: string }).bank || '') : filters.bank,
            q: 'q' in next ? String((next as { q?: string }).q || '') : filters.q,
          })
        }
        onPageChange={(p) => {
          setPage(p)
          setSearchParams(paramsFromFilters(filters, p), { replace: true })
        }}
        onDelete={async (id) => {
          await deleteTransaction(id)
          await load()
          refreshAnalytics()
        }}
        onCategoryChange={async (id, category) => {
          const res = await updateTransactionCategory(id, category)
          await load()
          refreshAnalytics()
          return {
            advisor_comment: res.advisor_comment,
            goal_impact: res.goal_impact,
          }
        }}
      />
    </div>
  )
}
