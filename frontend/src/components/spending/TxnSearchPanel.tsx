import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { fetchTransactions } from '../../api'
import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { Transaction } from '../../types'
import type { SpendingSearchFilters } from './utils'

export function TxnSearchPanel({
  filters,
  onFiltersChange,
  /** When set, sync form to these filters and run search immediately. */
  applyRequest,
  categoryOptions,
  panelRef,
}: {
  filters: SpendingSearchFilters
  onFiltersChange: (next: SpendingSearchFilters) => void
  applyRequest: { id: number; filters: SpendingSearchFilters } | null
  categoryOptions: string[]
  panelRef?: RefObject<HTMLDivElement | null>
}) {
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const runSearch = useCallback(async (f: SpendingSearchFilters) => {
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const list = await fetchTransactions({
        type: 'debit',
        q: f.merchant.trim() || undefined,
        category: f.category.trim() || undefined,
        date_from: f.dateFrom || undefined,
        date_to: f.dateTo || undefined,
        limit: 200,
        sort: 'received_at',
        order: 'desc',
      })
      const min = f.amountMin.trim() ? Number(f.amountMin.replace(/,/g, '')) : null
      const max = f.amountMax.trim() ? Number(f.amountMax.replace(/,/g, '')) : null
      const filtered = list.filter((t) => {
        if (min != null && !Number.isNaN(min) && t.amount < min) return false
        if (max != null && !Number.isNaN(max) && t.amount > max) return false
        return true
      })
      setRows(filtered)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!applyRequest) return
    onFiltersChange(applyRequest.filters)
    void runSearch(applyRequest.filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by applyRequest.id
  }, [applyRequest?.id])

  const set = (patch: Partial<SpendingSearchFilters>) =>
    onFiltersChange({ ...filters, ...patch })

  const cats = useMemo(() => {
    const setCats = new Set(categoryOptions)
    if (filters.category) setCats.add(filters.category)
    return [...setCats].sort()
  }, [categoryOptions, filters.category])

  return (
    <div ref={panelRef}>
      <ChartCard
        title="Find transactions"
        subtitle="Filter by merchant, category, dates, and amount — results stay on this page"
        className="mb-5"
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs text-[var(--muted)]">
            Merchant
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.merchant}
              onChange={(e) => set({ merchant: e.target.value })}
              placeholder="e.g. Swiggy"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Category
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              <option value="">Any</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Date from
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.dateFrom}
              onChange={(e) => set({ dateFrom: e.target.value })}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Date to
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.dateTo}
              onChange={(e) => set({ dateTo: e.target.value })}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Min amount (₹)
            <input
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.amountMin}
              onChange={(e) => set({ amountMin: e.target.value })}
              placeholder="0"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Max amount (₹)
            <input
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-2 text-sm text-[var(--text)]"
              value={filters.amountMax}
              onChange={(e) => set({ amountMax: e.target.value })}
              placeholder="Any"
            />
          </label>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void runSearch(filters)}
            disabled={loading}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onFiltersChange({
                merchant: '',
                category: '',
                dateFrom: '',
                dateTo: '',
                amountMin: '',
                amountMax: '',
              })
              setRows([])
              setSearched(false)
              setError(null)
            }}
          >
            Clear
          </button>
        </div>

        {error ? (
          <p className="mb-3 text-sm text-[var(--debit)]">{error}</p>
        ) : null}

        {!searched ? (
          <p className="text-sm text-[var(--muted)]">
            Set filters and search, or click a category / merchant above to jump here.
          </p>
        ) : loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm text-[var(--muted)]">No matching transactions.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto text-sm">
            {rows.map((t) => (
              <li key={t._id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--text)]">
                    {t.merchant || t.category || 'Unknown'}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {t.category || '—'}
                    {t.received_at
                      ? ` · ${new Date(t.received_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}`
                      : ''}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-[var(--debit)]">
                  {formatINR(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    </div>
  )
}
