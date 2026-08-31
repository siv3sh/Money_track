import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  API_BASE,
  fetchMe,
  getStoredToken,
  loginRequest,
  logoutLocal,
  onAuthExpired,
  registerRequest,
  setStoredToken,
  type AuthUser,
} from '../api'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  register: (payload: {
    email: string
    password: string
    signup_code?: string
  }) => Promise<AuthUser>
  logout: () => void
  refreshUser: () => Promise<void>
  setUser: (u: AuthUser | null) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setUser(null)
      return
    }
    const me = await fetchMe()
    setUser(me)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (getStoredToken()) {
          const me = await fetchMe()
          if (!cancelled) setUser(me)
        }
      } catch {
        logoutLocal()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep React user state in sync when any API call hits 401 / disabled-account 403.
  useEffect(() => onAuthExpired(() => setUser(null)), [])

  // Keep Render free tier warm while the tab is open (cold starts are ~15–60s).
  useEffect(() => {
    if (!user) return
    const ping = () => {
      void fetch(`${API_BASE}/health`).catch(() => undefined)
    }
    ping()
    const id = window.setInterval(ping, 8 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password)
    setStoredToken(res.access_token)
    setUser(res.user)
    return res.user
  }, [])

  const register = useCallback(
    async (payload: { email: string; password: string; signup_code?: string }) => {
      const res = await registerRequest(payload)
      setStoredToken(res.access_token)
      setUser(res.user)
      return res.user
    },
    [],
  )

  const logout = useCallback(() => {
    logoutLocal()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshUser, setUser }),
    [user, loading, login, register, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
