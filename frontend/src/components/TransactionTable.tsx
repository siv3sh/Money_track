import { Trash2 } from 'lucide-react'
import type { CardType, Transaction, TxnType } from '../types'
import { CARD_TYPE_LABELS } from '../types'
import { formatDate, formatINR } from '../lib/format'

export interface Filters {
  card_type: CardType | ''
  type: TxnType | ''
  date_from: string
  date_to: string
  sort: 'received_at' | 'amount'
  order: 'asc' | 'desc'
}

interface Props {
  rows: Transaction[]
  filters: Filters
  page: number
  pageSize: number
  hasMore: boolean
  loading: boolean
  onFiltersChange: (next: Filters) => void
  onPageChange: (page: number) => void
  onDelete: (id: string) => void
}

const selectClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]'
const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]'

export function TransactionTable({
  rows,
  filters,
  page,
  pageSize,
  hasMore,
  loading,
  onFiltersChange,
  onPageChange,
  onDelete,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Card type
          <select
            className={selectClass}
            value={filters.card_type}
            onChange={(e) =>
              onFiltersChange({ ...filters, card_type: e.target.value as Filters['card_type'] })
            }
          >
            <option value="">All</option>
            {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((key) => (
              <option key={key} value={key}>
                {CARD_TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Type
          <select
            className={selectClass}
            value={filters.type}
            onChange={(e) =>
              onFiltersChange({ ...filters, type: e.target.value as Filters['type'] })
            }
          >
            <option value="">All</option>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={inputClass}
            value={filters.date_from}
            onChange={(e) => onFiltersChange({ ...filters, date_from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={inputClass}
            value={filters.date_to}
            onChange={(e) => onFiltersChange({ ...filters, date_to: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Sort
          <select
            className={selectClass}
            value={`${filters.sort}:${filters.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(':') as [
                Filters['sort'],
                Filters['order'],
              ]
              onFiltersChange({ ...filters, sort, order })
            }}
          >
            <option value="received_at:desc">Newest</option>
            <option value="received_at:asc">Oldest</option>
            <option value="amount:desc">Amount high</option>
            <option value="amount:asc">Amount low</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Bank</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Merchant</th>
              <th className="px-3 py-2 font-medium">Card</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--muted)]">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--muted)]">
                  No transactions match these filters
                </td>
              </tr>
            ) : (
              rows.map((txn) => (
                <tr key={txn._id} className="border-b border-[var(--border)] last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                    {formatDate(txn.received_at)}
                  </td>
                  <td className="px-3 py-2">{txn.bank || '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        txn.type === 'debit' ? 'text-[var(--debit)]' : 'text-[var(--credit)]'
                      }
                    >
                      {txn.type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                    {formatINR(txn.amount)}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2" title={txn.merchant || undefined}>
                    {txn.merchant || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                    {txn.card_type ? CARD_TYPE_LABELS[txn.card_type] : '—'}
                    {txn.account_last4 ? ` ·••${txn.account_last4}` : ''}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      title="Delete"
                      className="rounded p-1 text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--debit)]"
                      onClick={() => {
                        if (window.confirm('Delete this transaction?')) onDelete(txn._id)
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--muted)]">
        <span>
          Page {page + 1}
          {rows.length ? ` · showing ${rows.length} of up to ${pageSize}` : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-1 disabled:opacity-40"
            disabled={page === 0 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-1 disabled:opacity-40"
            disabled={!hasMore || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
