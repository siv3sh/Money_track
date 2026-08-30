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

const WEALTH_PREF_KEY = 'money-track-wealth-enabled'

type WealthSettingsState = {
  enabled: boolean
  setEnabled: (v: boolean) => void
  toggle: () => void
}

const WealthSettingsContext = createContext<WealthSettingsState | null>(null)

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(WEALTH_PREF_KEY)
    if (raw === '0' || raw === 'false' || raw === 'off') return false
    if (raw === '1' || raw === 'true' || raw === 'on') return true
  } catch {
    /* ignore */
  }
  return true
}

export function WealthSettingsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readEnabled)

  useEffect(() => {
    try {
      localStorage.setItem(WEALTH_PREF_KEY, enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [enabled])

  const setEnabled = useCallback((v: boolean) => setEnabledState(v), [])
  const toggle = useCallback(() => setEnabledState((v) => !v), [])

  const value = useMemo(
    () => ({ enabled, setEnabled, toggle }),
    [enabled, setEnabled, toggle],
  )

  return createElement(WealthSettingsContext.Provider, { value }, children)
}

export function useWealthSettings(): WealthSettingsState {
  const ctx = useContext(WealthSettingsContext)
  if (!ctx) throw new Error('useWealthSettings must be used within WealthSettingsProvider')
  return ctx
}
