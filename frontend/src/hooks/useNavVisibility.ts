import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** Bumped so ledger-first defaults apply for everyone once. */
const NAV_PREF_KEY = 'tally-nav-visible-v3'

export const NAV_PREF_IDS = [
  'dashboard',
  'spending',
  'transactions',
  'accounts',
  'import',
  'cash-flow',
  'monthly-reports',
  'wealth',
  'planning',
  'ai',
] as const

export type NavPrefId = (typeof NAV_PREF_IDS)[number]

export const ALWAYS_VISIBLE_NAV: NavPrefId[] = ['dashboard']

/** Core ledger loop — advanced pages off until the user opts in. */
const DEFAULT_VISIBLE: Record<NavPrefId, boolean> = {
  dashboard: true,
  spending: true,
  transactions: true,
  accounts: true,
  import: true,
  'cash-flow': false,
  'monthly-reports': false,
  wealth: false,
  planning: false,
  ai: false,
}

const ALL_VISIBLE: Record<NavPrefId, boolean> = Object.fromEntries(
  NAV_PREF_IDS.map((id) => [id, true]),
) as Record<NavPrefId, boolean>

function loadPrefs(): Record<NavPrefId, boolean> {
  try {
    const raw = localStorage.getItem(NAV_PREF_KEY)
    if (!raw) return { ...DEFAULT_VISIBLE }
    const parsed = JSON.parse(raw) as Partial<Record<NavPrefId, boolean>>
    const next = { ...DEFAULT_VISIBLE }
    for (const id of NAV_PREF_IDS) {
      if (typeof parsed[id] === 'boolean') next[id] = parsed[id]
    }
    for (const id of ALWAYS_VISIBLE_NAV) next[id] = true
    return next
  } catch {
    return { ...DEFAULT_VISIBLE }
  }
}

type NavVisibilityState = {
  visible: Record<NavPrefId, boolean>
  toggle: (id: NavPrefId) => void
  showAll: () => void
  resetDefaults: () => void
  isVisible: (id: NavPrefId) => boolean
}

const NavVisibilityContext = createContext<NavVisibilityState | null>(null)

export function NavVisibilityProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState<Record<NavPrefId, boolean>>(loadPrefs)

  useEffect(() => {
    localStorage.setItem(NAV_PREF_KEY, JSON.stringify(visible))
  }, [visible])

  const toggle = useCallback((id: NavPrefId) => {
    if (ALWAYS_VISIBLE_NAV.includes(id)) return
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const showAll = useCallback(() => {
    setVisible({ ...ALL_VISIBLE })
  }, [])

  const resetDefaults = useCallback(() => {
    setVisible({ ...DEFAULT_VISIBLE })
  }, [])

  const isVisible = useCallback((id: NavPrefId) => visible[id] !== false, [visible])

  const value = useMemo(
    () => ({ visible, toggle, showAll, resetDefaults, isVisible }),
    [visible, toggle, showAll, resetDefaults, isVisible],
  )

  return createElement(NavVisibilityContext.Provider, { value }, children)
}

export function useNavVisibility(): NavVisibilityState {
  const ctx = useContext(NavVisibilityContext)
  if (!ctx) throw new Error('useNavVisibility must be used within NavVisibilityProvider')
  return ctx
}
