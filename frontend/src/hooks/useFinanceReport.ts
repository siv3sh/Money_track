import { useCallback, useEffect, useState } from 'react'
import { fetchDetailedReport, fetchMonthly, fetchSummary, fetchTransactions } from '../api'
import { useFilters } from '../context/FilterContext'
import type { DetailedReport, MonthlyBucket, Summary, Transaction } from '../types'

interface FinanceData {
  report: DetailedReport | null
  monthly: MonthlyBucket[]
  summary: Summary | null
  transactions: Transaction[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useFinanceReport(opts: { txnLimit?: number } = {}): FinanceData {
  const { dateFrom, dateTo, sources, category } = useFilters()
  const [report, setReport] = useState<DetailedReport | null>(null)
  const [monthly, setMonthly] = useState<MonthlyBucket[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const date_from = dateFrom || undefined
    const date_to = dateTo || undefined
    const dateFromIso = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined
    const dateToIso = dateTo ? `${dateTo}T23:59:59.999Z` : undefined

    void (async () => {
      try {
        const [rep, mon, sum, txns] = await Promise.all([
          fetchDetailedReport({ date_from, date_to, merchant_limit: 20 }),
          fetchMonthly(12),
          fetchSummary(),
          fetchTransactions({
            limit: opts.txnLimit ?? 500,
            date_from: dateFromIso,
            date_to: dateToIso,
            category: category || undefined,
            sort: 'received_at',
            order: 'desc',
          }),
        ])
        if (cancelled) return

        let filteredTxns = txns
        if (sources.length > 0) {
          const allowed = new Set(sources)
          filteredTxns = txns.filter((t) => allowed.has(t.bank || 'Unknown'))
        }

        setReport(rep)
        setMonthly(mon)
        setSummary(sum)
        setTransactions(filteredTxns)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo, sources, category, opts.txnLimit, tick])

  return { report, monthly, summary, transactions, loading, error, reload }
}
