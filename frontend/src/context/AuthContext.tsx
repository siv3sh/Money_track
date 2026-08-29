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
  fetchMe,
  getStoredToken,
  loginRequest,
  logoutLocal,
  setStoredToken,
  type AuthUser,
} from '../api'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
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

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password)
    setStoredToken(res.access_token)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(() => {
    logoutLocal()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, setUser }),
    [user, loading, login, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
