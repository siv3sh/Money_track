import { FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) {
    return <Navigate to={user.setup_completed ? '/' : '/setup'} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await login(email.trim(), password)
      navigate(u.setup_completed ? '/' : '/setup', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--sapphire)] text-lg font-semibold text-white">
            ₹
          </div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Money Track</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Sign in to see your money</p>
        </div>

        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Email</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </label>

          {error ? (
            <p className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn w-full justify-center" disabled={busy || loading}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--muted)]">
          First-time setup asks if your phone is iPhone or Android, then walks you through SMS
          linking in plain steps.
        </p>
      </div>
    </div>
  )
}
