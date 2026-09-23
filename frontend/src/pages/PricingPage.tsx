import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import {
  createBillingCheckout,
  createBillingPortal,
  fetchBillingConfig,
  fetchBillingStatus,
  type BillingStatus,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { LoadingBlock } from '../components/ui'
import { trackEvent } from '../lib/analytics'

const FREE_FEATURES = [
  'Bank SMS + email ingest',
  'Home, Spending, Transactions',
  'CSV/PDF import for history',
  'Federal, ICICI, SIB, HDFC, SBI, Axis, Kotak',
]

const PRO_FEATURES = [
  'Everything in Free',
  'Priority support when something looks wrong',
  'Early access to upcoming extras (as we ship them)',
  'Helps fund bank coverage & parsing accuracy',
]

export function PricingPage() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const [cfg, setCfg] = useState<BillingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checkoutFlash = searchParams.get('checkout')

  useEffect(() => {
    trackEvent('pricing_view')
    let cancelled = false
    void (async () => {
      try {
        const snap = user ? await fetchBillingStatus() : await fetchBillingConfig()
        if (!cancelled) setCfg(snap)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load pricing')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  if (authLoading && !cfg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
        <LoadingBlock />
      </div>
    )
  }

  const price = cfg?.pro_price_label || '₹299/mo'
  const trialDays = cfg?.trial_days ?? 14
  const billingOn = cfg?.billing_enabled !== false

  const startCheckout = async () => {
    if (!user) {
      window.location.href = '/login?mode=signup&next=/pricing'
      return
    }
    setBusy(true)
    setError(null)
    trackEvent('checkout_start')
    try {
      const session = await createBillingCheckout()
      if (session.url) window.location.href = session.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  const openPortal = async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await createBillingPortal()
      if (session.url) window.location.href = session.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--sheet)]">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="font-[family-name:var(--font-display)] text-sm font-semibold">
            Tally
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {user ? (
              <Link to="/dashboard" className="text-[var(--muted)] hover:text-[var(--text)]">
                Home
              </Link>
            ) : (
              <Link to="/login" className="text-[var(--muted)] hover:text-[var(--text)]">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="text-center">
          <p className="font-[family-name:var(--font-display)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sapphire)]">
            Pricing
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
            The ledger is free.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-[var(--text-secondary)]">
            Free forever for SMS → transactions → spending. Pro is optional support for the product —
            never required to use Tally. {trialDays}-day trial when billing is on.
          </p>
        </div>

        {checkoutFlash === 'success' ? (
          <p className="mx-auto mt-6 max-w-lg rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-center text-sm text-[var(--credit)]">
            Payment received — Pro is unlocking. Refresh if features still look locked.
          </p>
        ) : null}
        {checkoutFlash === 'cancel' ? (
          <p className="mx-auto mt-6 max-w-lg rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-3 text-center text-sm text-[var(--muted)]">
            Checkout canceled. You can upgrade anytime.
          </p>
        ) : null}
        {error ? (
          <p className="mx-auto mt-6 max-w-lg rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-center text-sm text-[var(--debit)]">
            {error}
          </p>
        ) : null}

        {!billingOn ? (
          <p className="mx-auto mt-8 max-w-lg rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-3 text-center text-sm text-[var(--text-secondary)]">
            Billing is not configured on this server yet — all features stay unlocked. Set Stripe
            keys on the API to enable paywall.
          </p>
        ) : null}

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-6 shadow-[var(--elev-1)]">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Free</h2>
            <p className="mt-1 text-3xl font-semibold tracking-tight">₹0</p>
            <p className="mt-1 text-sm text-[var(--muted)]">SMS ledger that doesn’t lie</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-secondary)]">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--credit)]" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              to={user ? '/dashboard' : '/login?mode=signup'}
              className="btn mt-8 w-full justify-center border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm"
            >
              {user ? 'Open Home' : 'Start free'}
            </Link>
          </div>

          <div className="relative rounded-2xl border border-[var(--sapphire)]/40 bg-[var(--sheet)] p-6 shadow-[var(--elev-2)] ring-1 ring-[var(--sapphire)]/15">
            <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-[var(--sapphire)] px-2.5 py-0.5 text-[11px] font-semibold text-white">
              <Sparkles className="h-3 w-3" aria-hidden />
              Pro
            </span>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Pro</h2>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{price}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{trialDays}-day free trial, then billed monthly</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-secondary)]">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sapphire)]" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            {user?.entitled && user.plan === 'pro' && !user.trial_active ? (
              <button
                type="button"
                className="btn mt-8 w-full justify-center border border-[var(--border)] py-2.5 text-sm"
                disabled={busy || !billingOn}
                onClick={() => void openPortal()}
              >
                Manage subscription
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary mt-8 w-full justify-center gap-2 py-2.5 text-sm"
                disabled={busy || !billingOn}
                onClick={() => void startCheckout()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {user?.trial_active ? 'Upgrade to Pro' : `Start ${trialDays}-day trial`}
              </button>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          Not financial advice. Cancel anytime via the Stripe customer portal. India cards / UPI depend
          on your Stripe Dashboard payment method settings.
        </p>
      </main>
    </div>
  )
}
