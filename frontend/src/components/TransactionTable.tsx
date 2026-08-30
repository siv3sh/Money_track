import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import type { AdvisorComment, GoalImpact } from '../api'
import type { CardType, Transaction, TxnType } from '../types'
import { CARD_TYPE_LABELS, DEFAULT_CATEGORIES } from '../types'
import { bankLabel, formatDate, formatINR } from '../lib/format'
import { AdvisorCommentBubble } from './AdvisorCommentBubble'

export interface Filters {
  card_type: CardType | ''
  type: TxnType | ''
  category: string
  date_from: string
  date_to: string
  sort: 'received_at' | 'amount'
  order: 'asc' | 'desc'
  bank?: string
  q?: string
  amount_min?: string
  amount_max?: string
}

export type CategoryChangeResult = {
  advisor_comment?: AdvisorComment
  goal_impact?: GoalImpact
}

interface Props {
  rows: Transaction[]
  filters: Filters
  page: number
  pageSize: number
  hasMore: boolean
  loading: boolean
  categories?: string[]
  banks?: string[]
  showSearch?: boolean
  onFiltersChange: (next: Filters) => void
  onPageChange: (page: number) => void
  onDelete: (id: string) => void
  onCategoryChange?: (
    id: string,
    category: string,
  ) => void | Promise<void | CategoryChangeResult | null | undefined>
}

const selectClass =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)]'
const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)]'

export function TransactionRow({
  txn,
  categories,
  onDelete,
  onCategoryChange,
  variant = 'default',
}: {
  txn: Transaction
  categories: readonly string[]
  onDelete: (id: string) => void
  onCategoryChange?: (
    id: string,
    category: string,
  ) => void | Promise<void | CategoryChangeResult | null | undefined>
  /** Visual only — Dashboard passbook rows. */
  variant?: 'default' | 'passbook'
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advisorNote, setAdvisorNote] = useState<CategoryChangeResult | null>(null)
  const message = txn.raw_text || '—'
  const passbook = variant === 'passbook'
  const railClass = txn.type === 'debit' ? 'ledger-rail__bar--debit' : 'ledger-rail__bar--credit'
  const amountClass =
    txn.type === 'debit' ? 'ledger-amount__value--debit' : 'ledger-amount__value--credit'

  return (
    <article className={passbook ? 'passbook-row' : 'border-b border-[var(--border)] last:border-0'}>
      <div
        className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between ${
          passbook ? 'px-3' : 'px-4'
        }`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <div className="flex items-start gap-2">
            {passbook ? (
              <span className={`ledger-rail__bar ${railClass} mt-1 self-stretch`} aria-hidden />
            ) : null}
            <span className="mt-0.5 text-[var(--muted)]">
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={`text-base font-semibold ${
                    passbook ? `ledger-amount__value ${amountClass}` : 'tabular-nums'
                  } ${passbook ? '' : txn.type === 'debit' ? 'text-[var(--debit)]' : 'text-[var(--credit)]'}`}
                >
                  {txn.type === 'debit' ? '−' : '+'}
                  {formatINR(txn.amount)}
                </span>
                <span className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-xs capitalize text-[var(--muted)]">
                  {txn.type}
                </span>
                {txn.category ? (
                  <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                    {txn.category}
                  </span>
                ) : null}
                {txn.merchant ? (
                  <span className="truncate text-sm font-medium">{txn.merchant}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                <span>{formatDate(txn.received_at)}</span>
                <span>·</span>
                <span>{bankLabel(txn.bank, txn.sender)}</span>
                <span>·</span>
                <span>
                  {txn.card_type ? CARD_TYPE_LABELS[txn.card_type] : '—'}
                  {txn.account_last4 ? ` ·••${txn.account_last4}` : ''}
                </span>
              </div>
              {!open ? (
                <p className="line-clamp-1 text-sm text-[var(--muted)]">{message}</p>
              ) : null}
            </div>
          </div>
        </button>

        <button
          type="button"
          title="Delete"
          className="self-end rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--debit)] sm:self-start"
          onClick={() => {
            if (window.confirm('Delete this transaction?')) onDelete(txn._id)
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {open ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:pl-11">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Category
              <select
                className={selectClass}
                value={txn.category || 'Other'}
                disabled={saving || !onCategoryChange}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (!onCategoryChange) return
                  const next = e.target.value
                  setSaving(true)
                  void Promise.resolve(onCategoryChange(txn._id, next))
                    .then((res) => {
                      if (res && typeof res === 'object') setAdvisorNote(res)
                    })
                    .finally(() => setSaving(false))
                }}
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-2 text-xs text-[var(--muted)]">
              {saving
                ? 'Saving…'
                : txn.category_source
                  ? `Detected via ${txn.category_source}${txn.mcc ? ` · MCC ${txn.mcc}` : ''}`
                  : 'Change to remember this merchant'}
            </p>
          </div>
          <AdvisorCommentBubble
            comment={advisorNote?.advisor_comment}
            impact={advisorNote?.goal_impact}
          />
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            SMS message
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--text)]">
            {message}
          </pre>
          {txn.balance != null ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Available balance: {formatINR(txn.balance)}
            </p>
          ) : null}
          {txn.sender ? (
            <p className="mt-1 text-xs text-[var(--muted)]">Sender: {txn.sender}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function TransactionTable({
  rows,
  filters,
  page,
  pageSize,
  hasMore,
  loading,
  categories = [...DEFAULT_CATEGORIES],
  banks = [],
  showSearch = false,
  onFiltersChange,
  onPageChange,
  onDelete,
  onCategoryChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="panel p-3">
        {showSearch ? (
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">Find transactions</h2>
            <p className="text-xs text-[var(--muted)]">
              Filter by merchant, category, dates, amount, and more
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
        {showSearch ? (
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-[var(--muted)]">
            Merchant / text
            <input
              type="search"
              className={inputClass}
              placeholder="e.g. Swiggy"
              value={filters.q || ''}
              onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Category
          <select
            className={selectClass}
            value={filters.category}
            onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })}
          >
            <option value="">All</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </label>
        {banks.length || filters.bank !== undefined ? (
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Source / bank
            <select
              className={selectClass}
              value={filters.bank || ''}
              onChange={(e) => onFiltersChange({ ...filters, bank: e.target.value })}
            >
              <option value="">All</option>
              {(banks.length ? banks : filters.bank ? [filters.bank] : []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        {showSearch ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Min ₹
              <input
                inputMode="decimal"
                className={inputClass}
                placeholder="0"
                value={filters.amount_min || ''}
                onChange={(e) => onFiltersChange({ ...filters, amount_min: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Max ₹
              <input
                inputMode="decimal"
                className={inputClass}
                placeholder="Any"
                value={filters.amount_max || ''}
                onChange={(e) => onFiltersChange({ ...filters, amount_max: e.target.value })}
              />
            </label>
          </>
        ) : null}
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
      </div>

      <div className="panel overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No transactions match these filters
          </p>
        ) : (
          rows.map((txn) => (
            <TransactionRow
              key={txn._id}
              txn={txn}
              categories={categories}
              onDelete={onDelete}
              onCategoryChange={onCategoryChange}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--muted)]">
        <span>
          Page {page + 1}
          {rows.length ? ` · ${rows.length} of up to ${pageSize}` : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={page === 0 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn"
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
