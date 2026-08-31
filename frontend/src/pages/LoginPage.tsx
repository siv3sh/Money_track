import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Mode = 'signin' | 'signup'

function postAuthPath(u: { setup_completed?: boolean; onboarding_completed?: boolean }): string {
  if (!u.setup_completed) return '/setup'
  if (!u.onboarding_completed) return '/getting-started'
  return '/'
}

export function LoginPage() {
  const { user, loading, login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [signupCode, setSignupCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) {
    return <Navigate to={postAuthPath(user)} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signup') {
        if (password.length < 8) {
          setError('Password must be at least 8 characters')
          setBusy(false)
          return
        }
        if (password !== confirm) {
          setError('Passwords do not match')
          setBusy(false)
          return
        }
        const u = await register({
          email: email.trim(),
          password,
          signup_code: signupCode.trim() || undefined,
        })
        navigate(postAuthPath(u), { replace: true })
      } else {
        const u = await login(email.trim(), password)
        navigate(postAuthPath(u), { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'signup' ? 'Could not create account' : 'Login failed')
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
          <p className="mt-1 text-sm text-[var(--muted)]">
            {mode === 'signin' ? 'Sign in to see your money' : 'Create your account'}
          </p>
        </div>

        <div className="mb-5 flex rounded-xl border border-[var(--border)] p-0.5 text-sm">
          <button
            type="button"
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              mode === 'signin'
                ? 'bg-[var(--sapphire)] text-white'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
            onClick={() => {
              setMode('signin')
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              mode === 'signup'
                ? 'bg-[var(--sapphire)] text-white'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
            onClick={() => {
              setMode('signup')
              setError(null)
            }}
          >
            Create account
          </button>
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
            <div className="relative">
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 pr-11 text-[var(--text)]"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {mode === 'signup' ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted)]">Confirm password</span>
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 pr-11 text-[var(--text)]"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    onClick={() => setShowConfirm((v) => !v)}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted)]">
                  Invite code <span className="font-normal">(if you were given one)</span>
                </span>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                  type="text"
                  autoComplete="off"
                  value={signupCode}
                  onChange={(e) => setSignupCode(e.target.value)}
                  placeholder="Optional"
                />
              </label>
            </>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]"
            >
              {error}
            </p>
          ) : null}

          {mode === 'signin' ? (
            <p className="text-right text-xs">
              <button
                type="button"
                className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline"
                onClick={() => navigate('/forgot-password')}
              >
                Forgot password?
              </button>
            </p>
          ) : null}

          <button type="submit" className="btn w-full justify-center" disabled={busy || loading}>
            {busy
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--muted)]">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <button
                type="button"
                className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline"
                onClick={() => {
                  setMode('signup')
                  setError(null)
                }}
              >
                Create an account
              </button>
              . After signup we walk you through SMS setup and a short product guide.
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline"
                onClick={() => {
                  setMode('signin')
                  setError(null)
                }}
              >
                Sign in
              </button>
              .
            </>
          )}
        </p>
      </div>
    </div>
  )
}
