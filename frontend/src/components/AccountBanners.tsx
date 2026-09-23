import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Sparkles, X } from 'lucide-react'
import { resendVerificationRequest } from '../api'
import { useAuth } from '../context/AuthContext'

export function AccountBanners() {
  const { user, refreshUser } = useAuth()
  const [dismissedBilling, setDismissedBilling] = useState(false)
  const [dismissedVerify, setDismissedVerify] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const needsVerify = user.email_verified === false
  const showBilling =
    !dismissedBilling &&
    user.billing_enabled &&
    !user.entitled &&
    !user.is_admin
  const showTrial =
    !dismissedBilling &&
    user.billing_enabled &&
    user.trial_active &&
    user.entitled

  const resend = async () => {
    setBusy(true)
    setVerifyMsg(null)
    try {
      const res = await resendVerificationRequest()
      setVerifyMsg(res.detail || 'Verification email sent')
      await refreshUser()
    } catch (err) {
      setVerifyMsg(err instanceof Error ? err.message : 'Could not resend')
    } finally {
      setBusy(false)
    }
  }

  if (!needsVerify && !showBilling && !showTrial) return null

  return (
    <div className="space-y-2 px-3 pt-2 sm:px-5 sm:pt-3">
      {needsVerify && !dismissedVerify ? (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--sapphire)]/25 bg-[var(--accent-soft)] px-3 py-2.5 text-sm text-[var(--text)] sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sapphire)]" aria-hidden />
            <span className="leading-snug">Confirm your email to secure password resets.</span>
          </div>
          <div className="flex items-center gap-2 pl-6 sm:pl-0">
            <button
              type="button"
              className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline disabled:opacity-60"
              disabled={busy}
              onClick={() => void resend()}
            >
              Resend link
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--surface)]"
              aria-label="Dismiss"
              onClick={() => setDismissedVerify(true)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {verifyMsg ? <span className="w-full text-xs text-[var(--muted)]">{verifyMsg}</span> : null}
        </div>
      ) : null}

      {showBilling ? (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--wealth)]/30 bg-[var(--wealth-soft)] px-3 py-2.5 text-sm text-[var(--text)] sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--wealth)]" aria-hidden />
            <span className="leading-snug">
              Your trial ended. Upgrade to Pro if you want to support Tally — the SMS ledger stays free.
            </span>
          </div>
          <div className="flex items-center gap-2 pl-6 sm:pl-0">
            <Link to="/pricing" className="font-semibold text-[var(--sapphire)] underline-offset-2 hover:underline">
              View pricing
            </Link>
            <button
              type="button"
              className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--surface)]"
              aria-label="Dismiss"
              onClick={() => setDismissedBilling(true)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {showTrial ? (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-3 py-2.5 text-sm text-[var(--text-secondary)] sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sapphire)]" aria-hidden />
            <span className="leading-snug">
              Pro trial active
              {user.trial_ends_at
                ? ` until ${new Date(user.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}
              .
            </span>
          </div>
          <div className="flex items-center gap-2 pl-6 sm:pl-0">
            <Link to="/pricing" className="font-medium text-[var(--sapphire)] underline-offset-2 hover:underline">
              Upgrade
            </Link>
            <button
              type="button"
              className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--surface)]"
              aria-label="Dismiss"
              onClick={() => setDismissedBilling(true)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
