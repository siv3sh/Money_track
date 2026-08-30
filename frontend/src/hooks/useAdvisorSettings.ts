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

const ADVISOR_PREF_KEY = 'money-track-advisor-enabled'

type AdvisorSettingsState = {
  enabled: boolean
  setEnabled: (v: boolean) => void
  toggle: () => void
}

const AdvisorSettingsContext = createContext<AdvisorSettingsState | null>(null)

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ADVISOR_PREF_KEY)
    if (raw === '0' || raw === 'false' || raw === 'off') return false
    if (raw === '1' || raw === 'true' || raw === 'on') return true
  } catch {
    /* ignore */
  }
  // Default on — matches current product behavior
  return true
}

export function AdvisorSettingsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readEnabled)

  useEffect(() => {
    try {
      localStorage.setItem(ADVISOR_PREF_KEY, enabled ? '1' : '0')
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

  return createElement(AdvisorSettingsContext.Provider, { value }, children)
}

export function useAdvisorSettings(): AdvisorSettingsState {
  const ctx = useContext(AdvisorSettingsContext)
  if (!ctx) throw new Error('useAdvisorSettings must be used within AdvisorSettingsProvider')
  return ctx
}
