import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { sendOtpRequest, verifyOtpRequest, type OtpChannel } from '../api'
import { useAuth } from '../context/AuthContext'

type Mode = 'signin' | 'signup'
type SignInMethod = 'password' | 'otp'
type Step = 'form' | 'verify-email' | 'verify-phone'

function postAuthPath(u: { setup_completed?: boolean; onboarding_completed?: boolean }): string {
  if (!u.setup_completed) return '/setup'
  if (!u.onboarding_completed) return '/getting-started'
  return '/'
}

export function LoginPage() {
  const { user, loading, login, register, applySession } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [signInMethod, setSignInMethod] = useState<SignInMethod>('password')
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [signupCode, setSignupCode] = useState('')
  const [otpChannel, setOtpChannel] = useState<OtpChannel>('email')
  const [otpDestination, setOtpDestination] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpHint, setOtpHint] = useState<string | null>(null)
  const [smsAvailable, setSmsAvailable] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && user && step === 'form' && mode === 'signin') {
    return <Navigate to={postAuthPath(user)} replace />
  }
  if (
    !loading &&
    user &&
    step === 'form' &&
    mode === 'signup' &&
    user.email_verified !== false &&
    (user.phone_verified !== false || !user.phone)
  ) {
    return <Navigate to={postAuthPath(user)} replace />
  }

  const resetFormState = () => {
    setStep('form')
    setOtpCode('')
    setOtpHint(null)
    setError(null)
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
        if (!phone.trim()) {
          setError('Enter your phone number')
          setBusy(false)
          return
        }
        const res = await register({
          email: email.trim(),
          password,
          phone: phone.trim(),
          signup_code: signupCode.trim() || undefined,
        })
        setSmsAvailable(Boolean(res.sms_otp_available))
        setOtpDestination(email.trim())
        setOtpChannel('email')
        setStep('verify-email')
        setOtpHint(
          res.otp_sent?.email
            ? 'We sent a 6-digit code to your email.'
            : 'Enter the email code (resend if needed).',
        )
      } else if (signInMethod === 'password') {
        const u = await login(email.trim(), password)
        navigate(postAuthPath(u), { replace: true })
      } else {
        const dest = otpChannel === 'email' ? email.trim() : phone.trim()
        if (!dest) {
          setError(otpChannel === 'email' ? 'Enter your email' : 'Enter your phone number')
          setBusy(false)
          return
        }
        const sent = await sendOtpRequest({
          channel: otpChannel,
          destination: dest,
          purpose: 'login',
        })
        setOtpDestination(dest)
        setSmsAvailable(Boolean(sent.sms_otp_available))
        setOtpHint(
          sent.destination_masked
            ? `Code sent to ${sent.destination_masked}`
            : sent.detail || 'If that account exists, a code was sent.',
        )
        setStep('verify-email')
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === 'signup'
            ? 'Could not create account'
            : 'Login failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const onVerifyOtp = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const purpose = mode === 'signup' ? 'verify' : 'login'
      const channel: OtpChannel =
        mode === 'signup' ? (step === 'verify-phone' ? 'phone' : 'email') : otpChannel
      const destination =
        mode === 'signup'
          ? step === 'verify-phone'
            ? phone.trim()
            : email.trim()
          : otpDestination

      const res = await verifyOtpRequest({
        channel,
        destination,
        purpose,
        code: otpCode.trim(),
      })
      applySession(res.access_token, res.user)

      if (mode === 'signup' && step === 'verify-email' && smsAvailable && phone.trim()) {
        setOtpCode('')
        setStep('verify-phone')
        setOtpHint('Enter the SMS code we sent to your phone.')
        try {
          await sendOtpRequest({
            channel: 'phone',
            destination: phone.trim(),
            purpose: 'verify',
          })
        } catch {
          // Phone OTP may already have been sent at register time.
        }
        setBusy(false)
        return
      }

      navigate(postAuthPath(res.user), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setBusy(false)
    }
  }

  const onResend = async () => {
    setBusy(true)
    setError(null)
    try {
      const channel: OtpChannel =
        mode === 'signup' ? (step === 'verify-phone' ? 'phone' : 'email') : otpChannel
      const destination =
        mode === 'signup'
          ? step === 'verify-phone'
            ? phone.trim()
            : email.trim()
          : otpDestination
      const purpose = mode === 'signup' ? 'verify' : 'login'
      const sent = await sendOtpRequest({ channel, destination, purpose })
      setOtpHint(
        sent.destination_masked
          ? `Code sent to ${sent.destination_masked}`
          : sent.detail || 'Code sent.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code')
    } finally {
      setBusy(false)
    }
  }

  const skipPhoneVerify = () => {
    if (user) navigate(postAuthPath(user), { replace: true })
  }

  if (step !== 'form') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
          <h1 className="text-2xl font-semibold text-[var(--text)]">
            {step === 'verify-phone' ? 'Verify phone' : 'Enter code'}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {otpHint || 'Enter the 6-digit code to continue.'}
          </p>
          <form className="mt-5 space-y-4" onSubmit={(e) => void onVerifyOtp(e)}>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">6-digit code</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 tracking-[0.3em] text-[var(--text)]"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
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
            <button type="submit" className="btn w-full justify-center" disabled={busy || otpCode.length !== 6}>
              {busy ? 'Checking…' : 'Verify & continue'}
            </button>
          </form>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline"
              disabled={busy}
              onClick={() => void onResend()}
            >
              Resend code
            </button>
            {step === 'verify-phone' ? (
              <button
                type="button"
                className="text-[var(--muted)] underline-offset-2 hover:underline"
                onClick={skipPhoneVerify}
              >
                Skip for now
              </button>
            ) : (
              <button
                type="button"
                className="text-[var(--muted)] underline-offset-2 hover:underline"
                onClick={resetFormState}
              >
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    )
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
              resetFormState()
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
              resetFormState()
            }}
          >
            Create account
          </button>
        </div>

        {mode === 'signin' ? (
          <div className="mb-4 flex rounded-xl border border-[var(--border)] p-0.5 text-xs">
            <button
              type="button"
              className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                signInMethod === 'password'
                  ? 'bg-[var(--surface-2)] text-[var(--text)]'
                  : 'text-[var(--muted)]'
              }`}
              onClick={() => {
                setSignInMethod('password')
                setError(null)
              }}
            >
              Password
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                signInMethod === 'otp' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
              }`}
              onClick={() => {
                setSignInMethod('otp')
                setError(null)
              }}
            >
              OTP
            </button>
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          {mode === 'signin' && signInMethod === 'otp' ? (
            <>
              <div className="flex rounded-xl border border-[var(--border)] p-0.5 text-xs">
                <button
                  type="button"
                  className={`flex-1 rounded-lg py-1.5 font-medium ${
                    otpChannel === 'email' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
                  }`}
                  onClick={() => setOtpChannel('email')}
                >
                  Email
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-lg py-1.5 font-medium ${
                    otpChannel === 'phone' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'
                  }`}
                  onClick={() => setOtpChannel('phone')}
                >
                  Phone
                </button>
              </div>
              {otpChannel === 'email' ? (
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
              ) : (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Phone</span>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                  />
                </label>
              )}
            </>
          ) : (
            <>
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
              {mode === 'signup' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Phone</span>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                  />
                </label>
              ) : null}
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
            </>
          )}

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

          {mode === 'signin' && signInMethod === 'password' ? (
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
                : signInMethod === 'otp'
                  ? 'Sending code…'
                  : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : signInMethod === 'otp'
                  ? 'Send OTP'
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
                  resetFormState()
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
                  resetFormState()
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
