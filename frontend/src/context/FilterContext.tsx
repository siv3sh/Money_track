import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { presetDates, type DatePreset } from '../lib/dates'

export type ActiveDatePreset = DatePreset | 'custom'

interface FilterState {
  dateFrom: string
  dateTo: string
  activePreset: ActiveDatePreset
  sources: string[]
  category: string
  setDateFrom: (v: string) => void
  setDateTo: (v: string) => void
  applyPreset: (preset: DatePreset) => void
  setSources: (sources: string[]) => void
  toggleSource: (source: string) => void
  setCategory: (category: string) => void
  clearFilters: () => void
}

const FilterContext = createContext<FilterState | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [initialFrom, initialTo] = presetDates('quarter')
  const [dateFrom, setDateFromState] = useState(initialFrom)
  const [dateTo, setDateToState] = useState(initialTo)
  const [activePreset, setActivePreset] = useState<ActiveDatePreset>('quarter')
  const [sources, setSources] = useState<string[]>([])
  const [category, setCategory] = useState('')

  const setDateFrom = useCallback((v: string) => {
    setDateFromState(v)
    setActivePreset('custom')
  }, [])

  const setDateTo = useCallback((v: string) => {
    setDateToState(v)
    setActivePreset('custom')
  }, [])

  const applyPreset = useCallback((preset: DatePreset) => {
    const [from, to] = presetDates(preset)
    setDateFromState(from)
    setDateToState(to)
    setActivePreset(preset)
  }, [])

  const toggleSource = useCallback((source: string) => {
    setSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    )
  }, [])

  const clearFilters = useCallback(() => {
    const [from, to] = presetDates('quarter')
    setDateFromState(from)
    setDateToState(to)
    setActivePreset('quarter')
    setSources([])
    setCategory('')
  }, [])

  const value = useMemo(
    () => ({
      dateFrom,
      dateTo,
      activePreset,
      sources,
      category,
      setDateFrom,
      setDateTo,
      applyPreset,
      setSources,
      toggleSource,
      setCategory,
      clearFilters,
    }),
    [
      dateFrom,
      dateTo,
      activePreset,
      sources,
      category,
      setDateFrom,
      setDateTo,
      applyPreset,
      toggleSource,
      clearFilters,
    ],
  )

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
