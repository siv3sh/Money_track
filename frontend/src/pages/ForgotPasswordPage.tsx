import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  forgotPasswordRequest,
  sendOtpRequest,
  verifyOtpRequest,
  type OtpChannel,
} from '../api'
import { useAuth } from '../context/AuthContext'

type Method = 'link' | 'otp'
type Step = 'request' | 'otp'

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { applySession } = useAuth()
  const [method, setMethod] = useState<Method>('otp')
  const [step, setStep] = useState<Step>('request')
  const [channel, setChannel] = useState<OtpChannel>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const destination = channel === 'email' ? email.trim() : phone.trim()

  const onSendLink = async (e: FormEvent) => {
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

  const onSendOtp = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const sent = await sendOtpRequest({
        channel,
        destination,
        purpose: 'reset',
      })
      setHint(
        sent.destination_masked
          ? `Code sent to ${sent.destination_masked}`
          : sent.detail || 'If that account exists, a code was sent.',
      )
      setStep('otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code')
    } finally {
      setBusy(false)
    }
  }

  const onVerifyOtp = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await verifyOtpRequest({
        channel,
        destination,
        purpose: 'reset',
        code: code.trim(),
        new_password: newPassword,
      })
      applySession(res.access_token, res.user)
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
        <h1 className="text-2xl font-semibold text-[var(--text)]">Reset password</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use a one-time code, or get an email reset link.
        </p>

        <div className="mt-4 flex rounded-xl border border-[var(--border)] p-0.5 text-xs">
          <button
            type="button"
            className={`flex-1 rounded-lg py-1.5 font-medium ${
              method === 'otp' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            onClick={() => {
              setMethod('otp')
              setStep('request')
              setDone(false)
              setError(null)
            }}
          >
            OTP
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg py-1.5 font-medium ${
              method === 'link' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            onClick={() => {
              setMethod('link')
              setDone(false)
              setError(null)
            }}
          >
            Email link
          </button>
        </div>

        {method === 'link' ? (
          done ? (
            <div
              role="status"
              className="mt-5 rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-3 py-2 text-sm text-[var(--credit)]"
            >
              If that email is registered, check your inbox for a reset link. You can close this page.
            </div>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={(e) => void onSendLink(e)}>
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
          )
        ) : step === 'request' ? (
          <form className="mt-5 space-y-4" onSubmit={(e) => void onSendOtp(e)}>
            <div className="flex rounded-xl border border-[var(--border)] p-0.5 text-xs">
              <button
                type="button"
                className={`flex-1 rounded-lg py-1.5 font-medium ${
                  channel === 'email' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
                }`}
                onClick={() => setChannel('email')}
              >
                Email
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-1.5 font-medium ${
                  channel === 'phone' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
                }`}
                onClick={() => setChannel('phone')}
              >
                Phone
              </button>
            </div>
            {channel === 'email' ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted)]">Email</span>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted)]">Phone</span>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile"
                />
              </label>
            )}
            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-3 py-2 text-sm text-[var(--debit)]"
              >
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn w-full justify-center" disabled={busy}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(e) => void onVerifyOtp(e)}>
            {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">6-digit code</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 tracking-[0.3em] text-[var(--text)]"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">New password</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
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
              {busy ? 'Saving…' : 'Set password & sign in'}
            </button>
            <button
              type="button"
              className="w-full text-sm text-[var(--muted)] underline-offset-2 hover:underline"
              onClick={() => {
                setStep('request')
                setCode('')
                setError(null)
              }}
            >
              Back
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
