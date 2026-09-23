import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { setStoredToken, verifyEmailRequest } from '../api'
import { useAuth } from '../context/AuthContext'

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setUser, refreshUser } = useAuth()
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [message, setMessage] = useState('Verifying your email…')

  useEffect(() => {
    const token = (searchParams.get('token') || '').trim()
    if (!token) {
      setStatus('error')
      setMessage('Missing verification token. Open the link from your email.')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await verifyEmailRequest(token)
        setStoredToken(res.access_token)
        setUser(res.user)
        await refreshUser()
        if (!cancelled) {
          setStatus('ok')
          setMessage('Email verified. Taking you to the app…')
          window.setTimeout(() => {
            if (!res.user.setup_completed) navigate('/setup', { replace: true })
            else if (!res.user.onboarding_completed) navigate('/getting-started', { replace: true })
            else navigate('/dashboard', { replace: true })
          }, 900)
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setMessage(err instanceof Error ? err.message : 'Verification failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams, navigate, setUser, refreshUser])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-8 text-center shadow-[var(--elev-2)]">
        {status === 'loading' ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--sapphire)]" />
        ) : status === 'ok' ? (
          <CheckCircle2 className="mx-auto h-8 w-8 text-[var(--credit)]" />
        ) : (
          <XCircle className="mx-auto h-8 w-8 text-[var(--debit)]" />
        )}
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-xl font-semibold">
          Email verification
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{message}</p>
        {status === 'error' ? (
          <Link to="/login" className="btn btn-primary mt-6 inline-flex">
            Back to sign in
          </Link>
        ) : null}
      </div>
    </div>
  )
}
