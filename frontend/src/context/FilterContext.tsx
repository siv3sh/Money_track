import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchAnalytics } from '../api'
import { toInputDate } from '../lib/format'
import type { AnalyticsPayload } from '../types'

export type DatePreset = 'day' | 'week' | 'month' | 'last-month' | 'quarter' | 'year' | 'all'

function presetRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date()
  const end = toInputDate(today)
  switch (preset) {
    case 'day':
      return { from: end, to: end }
    case 'week': {
      const start = new Date(today)
      // Monday-start week
      const dow = (today.getDay() + 6) % 7
      start.setDate(today.getDate() - dow)
      return { from: toInputDate(start), to: end }
    }
    case 'month':
      return { from: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: end }
    case 'last-month':
      return {
        from: toInputDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: toInputDate(new Date(today.getFullYear(), today.getMonth(), 0)),
      }
    case 'quarter':
      return {
        from: toInputDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
        to: end,
      }
    case 'year':
      return { from: toInputDate(new Date(today.getFullYear(), 0, 1)), to: end }
    case 'all':
      return { from: '', to: '' }
    default: {
      const _exhaustive: never = preset
      return _exhaustive
    }
  }
}

interface FilterState {
  preset: DatePreset | 'custom'
  dateFrom: string
  dateTo: string
  banks: string[]
  data: AnalyticsPayload | null
  loading: boolean
  error: string | null
  availableBanks: string[]
  setPreset: (preset: DatePreset) => void
  setDateFrom: (v: string) => void
  setDateTo: (v: string) => void
  toggleBank: (bank: string) => void
  clearBanks: () => void
  refresh: () => void
}

const FilterContext = createContext<FilterState | null>(null)

export function FilterProvider({
  children,
  autoLoad = true,
  /** Skip SIP/drift/smart insights — faster charts (Dashboard / Cash Flow / Spending). */
  lite = true,
}: {
  children: ReactNode
  /** When false, skip the heavy /analytics fetch (Dashboard loads its own data). */
  autoLoad?: boolean
  lite?: boolean
}) {
  const initial = presetRange('month')
  const [preset, setPresetState] = useState<DatePreset | 'custom'>('month')
  const [dateFrom, setDateFromState] = useState(initial.from)
  const [dateTo, setDateToState] = useState(initial.to)
  const [banks, setBanks] = useState<string[]>([])
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(autoLoad)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await fetchAnalytics({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        bank: banks.length ? banks : undefined,
        lite,
      })
      setData(payload)
      setError(null)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [banks, dateFrom, dateTo, lite])

  useEffect(() => {
    if (!autoLoad) {
      setLoading(false)
      return
    }
    void load()
  }, [autoLoad, load])

  const value = useMemo<FilterState>(
    () => ({
      preset,
      dateFrom,
      dateTo,
      banks,
      data,
      loading,
      error,
      availableBanks: data?.filters.banks ?? [],
      setPreset: (p) => {
        const range = presetRange(p)
        setPresetState(p)
        setDateFromState(range.from)
        setDateToState(range.to)
      },
      setDateFrom: (v) => {
        setPresetState('custom')
        setDateFromState(v)
      },
      setDateTo: (v) => {
        setPresetState('custom')
        setDateToState(v)
      },
      toggleBank: (bank) => {
        setBanks((prev) =>
          prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank],
        )
      },
      clearBanks: () => setBanks([]),
      refresh: () => {
        void load()
      },
    }),
    [banks, data, dateFrom, dateTo, error, loading, load, preset],
  )

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
