import { useCallback, useEffect, useState } from 'react'
import { Moon, RefreshCw, Sun } from 'lucide-react'
import {
  deleteTransaction,
  fetchMerchants,
  fetchMonthly,
  fetchSummary,
  fetchTransactions,
  API_BASE,
} from './api'
import { StatementImport } from './components/StatementImport'
import { MerchantChart } from './components/MerchantChart'
import { MonthlyChart } from './components/MonthlyChart'
import { SummaryHeader } from './components/SummaryHeader'
import { TransactionTable, type Filters } from './components/TransactionTable'
import type { MerchantSpend, MonthlyBucket, Summary, Transaction } from './types'

const PAGE_SIZE = 20
const THEME_KEY = 'money-track-theme'

const defaultFilters: Filters = {
  card_type: '',
  type: '',
  date_from: '',
  date_to: '',
  sort: 'received_at',
  order: 'desc',
}

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark((d) => !d) }
}

export default function App() {
  const { dark, toggle } = useDarkMode()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [monthly, setMonthly] = useState<MonthlyBucket[]>([])
  const [merchants, setMerchants] = useState<MerchantSpend[]>([])
  const [rows, setRows] = useState<Transaction[]>([])
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingTable, setLoadingTable] = useState(true)
  const [loadingDash, setLoadingDash] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoadingDash(true)
    try {
      const [s, m, mer] = await Promise.all([
        fetchSummary(),
        fetchMonthly(12),
        fetchMerchants(10),
      ])
      setSummary(s)
      setMonthly(m)
      setMerchants(mer)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoadingDash(false)
    }
  }, [])

  const loadTransactions = useCallback(async () => {
    setLoadingTable(true)
    try {
      const dateTo = filters.date_to
        ? `${filters.date_to}T23:59:59.999Z`
        : undefined
      const dateFrom = filters.date_from ? `${filters.date_from}T00:00:00.000Z` : undefined

      const data = await fetchTransactions({
        limit: PAGE_SIZE + 1,
        skip: page * PAGE_SIZE,
        card_type: filters.card_type || undefined,
        type: filters.type || undefined,
        date_from: dateFrom,
        date_to: dateTo,
        sort: filters.sort,
        order: filters.order,
      })
      setHasMore(data.length > PAGE_SIZE)
      setRows(data.slice(0, PAGE_SIZE))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setLoadingTable(false)
    }
  }, [filters, page])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  const handleFiltersChange = (next: Filters) => {
    setPage(0)
    setFilters(next)
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteTransaction(id)
      await Promise.all([loadDashboard(), loadTransactions()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const refresh = () => {
    void loadDashboard()
    void loadTransactions()
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Personal finance
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Money Track</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Bank SMS parsed into spend · connected to{' '}
            <span className="text-[var(--text)]">{API_BASE.replace(/^https?:\/\//, '')}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refresh} className="btn">
            <RefreshCw size={14} />
            Refresh
          </button>
          <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="btn">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/35 bg-[var(--debit)]/10 px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loadingDash && !summary ? (
        <p className="text-sm text-[var(--muted)]">Loading summary…</p>
      ) : summary ? (
        <SummaryHeader summary={summary} />
      ) : null}

      <div className="mt-6">
        <StatementImport
          onImported={() => {
            void loadDashboard()
            void loadTransactions()
          }}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Monthly trend
          </h2>
          <MonthlyChart data={monthly} />
        </section>
        <section className="panel p-4">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Spend by merchant
          </h2>
          <MerchantChart data={merchants} />
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Transactions
          </h2>
          <p className="text-xs text-[var(--muted)]">Tap a row to read the full SMS</p>
        </div>
        <TransactionTable
          rows={rows}
          filters={filters}
          page={page}
          pageSize={PAGE_SIZE}
          hasMore={hasMore}
          loading={loadingTable}
          onFiltersChange={handleFiltersChange}
          onPageChange={setPage}
          onDelete={(id) => void handleDelete(id)}
        />
      </section>
    </div>
  )
}
