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

const THEME_KEY = 'money-track-theme'

type ThemeState = {
  dark: boolean
  toggle: () => void
  setDark: (v: boolean) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readDark(): boolean {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'dark') return true
  if (saved === 'light') return false
  return false
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDarkState] = useState(readDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])

  const setDark = useCallback((v: boolean) => setDarkState(v), [])
  const toggle = useCallback(() => setDarkState((d) => !d), [])

  const value = useMemo(() => ({ dark, toggle, setDark }), [dark, toggle, setDark])
  return createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
