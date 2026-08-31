import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { forgotPasswordRequest } from '../api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await forgotPasswordRequest(email.trim())
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Reset password</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Enter your account email. If it exists, we send a reset link (expires in 1 hour).
        </p>

        {done ? (
          <div
            role="status"
            className="mt-5 rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-3 py-2 text-sm text-[var(--credit)]"
          >
            If that email is registered, check your inbox for a reset link. You can close this page.
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">Email</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-[var(--muted)]">
          <Link to="/login" className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
