import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2, Mail, Phone, Send } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { sendOtpRequest, verifyOtpRequest, type OtpChannel } from '../api'
import { useAuth } from '../context/AuthContext'

type Mode = 'signin' | 'signup'
type SignInMethod = 'password' | 'otp'
type Step = 'form' | 'verify-email' | 'verify-phone'

const fieldClass =
  'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--muted)]/70 focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'

const labelClass = 'mb-1.5 block text-[12px] font-medium text-[var(--muted)]'

function postAuthPath(u: { setup_completed?: boolean; onboarding_completed?: boolean }): string {
  if (!u.setup_completed) return '/setup'
  if (!u.onboarding_completed) return '/getting-started'
  return '/'
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-8 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-3),var(--elev-bevel)] ring-1 ring-[var(--sapphire)]/10 sm:p-8">
        {children}
      </div>
    </div>
  )
}

function SegmentedToggle({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  size?: 'md' | 'sm'
}) {
  const pad = size === 'md' ? 'py-2.5 text-sm' : 'py-1.5 text-xs'
  return (
    <div
      className={`flex rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-[inset_0_1px_2px_rgba(11,31,58,0.06)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`flex-1 rounded-lg font-semibold transition-all duration-200 ${pad} ${
              active
                ? 'bg-[var(--sheet)] text-[var(--text)] shadow-[var(--elev-1)] ring-1 ring-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function PrimaryButton({
  busy,
  disabled,
  idleIcon,
  busyLabel,
  idleLabel,
}: {
  busy: boolean
  disabled: boolean
  idleIcon: ReactNode
  busyLabel: string
  idleLabel: string
}) {
  return (
    <button
      type="submit"
      className="btn btn-primary w-full justify-center gap-2 py-2.5 text-sm transition-transform duration-150 active:scale-[0.98] disabled:active:scale-100"
      disabled={disabled}
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : idleIcon}
      <span>{busy ? busyLabel : idleLabel}</span>
    </button>
  )
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
      <AuthCard>
        <div className="mb-1">
          <h1 className="font-[family-name:var(--font-display)] text-[1.45rem] font-semibold tracking-tight text-[var(--text)] sm:text-[1.65rem]">
            {step === 'verify-phone' ? 'Verify phone' : 'Enter code'}
          </h1>
          <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-secondary)]">
            {otpHint || 'Enter the 6-digit code to continue.'}
          </p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={(e) => void onVerifyOtp(e)}>
          <label className="block">
            <span className={labelClass}>6-digit code</span>
            <input
              className={`${fieldClass} tracking-[0.3em]`}
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
          <PrimaryButton
            busy={busy}
            disabled={busy || otpCode.length !== 6}
            idleIcon={<ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
            busyLabel="Checking…"
            idleLabel="Verify & continue"
          />
        </form>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="font-medium text-[var(--sapphire)] underline-offset-2 transition-opacity hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void onResend()}
          >
            Resend code
          </button>
          {step === 'verify-phone' ? (
            <button
              type="button"
              className="text-[var(--muted)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:underline"
              onClick={skipPhoneVerify}
            >
              Skip for now
            </button>
          ) : (
            <button
              type="button"
              className="text-[var(--muted)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:underline"
              onClick={resetFormState}
            >
              Back
            </button>
          )}
        </div>
      </AuthCard>
    )
  }

  const submitBusyLabel =
    mode === 'signup'
      ? 'Creating account…'
      : signInMethod === 'otp'
        ? 'Sending code…'
        : 'Signing in…'
  const submitIdleLabel =
    mode === 'signup' ? 'Create account' : signInMethod === 'otp' ? 'Send OTP' : 'Sign in'
  const submitIdleIcon =
    mode === 'signin' && signInMethod === 'otp' ? (
      <Send className="h-4 w-4 shrink-0" aria-hidden />
    ) : (
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
    )

  return (
    <AuthCard>
      <div className="mb-7 text-center">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-semibold text-white shadow-[var(--elev-2)] ring-1 ring-white/25"
          style={{
            background:
              'linear-gradient(145deg, color-mix(in srgb, var(--sapphire) 88%, white) 0%, var(--sapphire) 48%, color-mix(in srgb, var(--sapphire) 65%, #061028) 100%)',
          }}
          aria-hidden
        >
          ₹
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[1.65rem] font-semibold tracking-tight text-[var(--text)]">
          Money Track
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-secondary)]">
          {mode === 'signin' ? 'Sign in to see your money' : 'Create your account'}
        </p>
      </div>

      <div className="mb-5">
        <SegmentedToggle
          size="md"
          value={mode}
          options={[
            { id: 'signin', label: 'Sign in' },
            { id: 'signup', label: 'Create account' },
          ]}
          onChange={(id) => {
            setMode(id as Mode)
            resetFormState()
          }}
        />
      </div>

      {mode === 'signin' ? (
        <div className="mb-4">
          <SegmentedToggle
            size="sm"
            value={signInMethod}
            options={[
              { id: 'password', label: 'Password' },
              { id: 'otp', label: 'OTP' },
            ]}
            onChange={(id) => {
              setSignInMethod(id as SignInMethod)
              setError(null)
            }}
          />
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        {mode === 'signin' && signInMethod === 'otp' ? (
          <>
            <SegmentedToggle
              size="sm"
              value={otpChannel}
              options={[
                { id: 'email', label: 'Email' },
                { id: 'phone', label: 'Phone' },
              ]}
              onChange={(id) => setOtpChannel(id as OtpChannel)}
            />
            {otpChannel === 'email' ? (
              <label className="block">
                <span className={labelClass}>Email</span>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                    aria-hidden
                  />
                  <input
                    className={`${fieldClass} pl-10`}
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </label>
            ) : (
              <label className="block">
                <span className={labelClass}>Phone</span>
                <div className="relative">
                  <Phone
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                    aria-hidden
                  />
                  <input
                    className={`${fieldClass} pl-10`}
                    type="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                  />
                </div>
              </label>
            )}
          </>
        ) : (
          <>
            <label className="block">
              <span className={labelClass}>Email</span>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                  aria-hidden
                />
                <input
                  className={`${fieldClass} pl-10`}
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </label>
            {mode === 'signup' ? (
              <label className="block">
                <span className={labelClass}>Phone</span>
                <div className="relative">
                  <Phone
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                    aria-hidden
                  />
                  <input
                    className={`${fieldClass} pl-10`}
                    type="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                  />
                </div>
              </label>
            ) : null}
            <label className="block">
              <span className={labelClass}>Password</span>
              <div className="relative">
                <input
                  className={`${fieldClass} pr-11`}
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
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
            <label className="block">
              <span className={labelClass}>Confirm password</span>
              <div className="relative">
                <input
                  className={`${fieldClass} pr-11`}
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
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className={labelClass}>
                Invite code <span className="font-normal">(if you were given one)</span>
              </span>
              <input
                className={fieldClass}
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
              className="font-medium text-[var(--sapphire)] underline-offset-2 transition-opacity hover:underline"
              onClick={() => navigate('/forgot-password')}
            >
              Forgot password?
            </button>
          </p>
        ) : null}

        <PrimaryButton
          busy={busy}
          disabled={busy || loading}
          idleIcon={submitIdleIcon}
          busyLabel={submitBusyLabel}
          idleLabel={submitIdleLabel}
        />
      </form>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--muted)]">
        {mode === 'signin' ? (
          <>
            New here?{' '}
            <button
              type="button"
              className="font-semibold text-[var(--sapphire)] underline-offset-2 transition-opacity hover:underline"
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
              className="font-semibold text-[var(--sapphire)] underline-offset-2 transition-opacity hover:underline"
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
    </AuthCard>
  )
}
