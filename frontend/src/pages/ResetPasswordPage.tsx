import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPasswordRequest, setStoredToken } from '../api'
import { useAuth } from '../context/AuthContext'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = (params.get('token') || '').trim()
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return <Navigate to="/forgot-password" replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await resetPasswordRequest(token, password)
      setStoredToken(res.access_token)
      setUser(res.user)
      if (!res.user.setup_completed) navigate('/setup', { replace: true })
      else if (!res.user.onboarding_completed) navigate('/getting-started', { replace: true })
      else navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Choose a new password</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">At least 8 characters. You will be signed in after saving.</p>

        <form className="mt-5 space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">New password</span>
            <div className="relative">
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 pr-11 text-[var(--text)]"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--text)]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Confirm password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]"
            >
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn w-full justify-center" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[var(--muted)]">
          <Link to="/login" className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
