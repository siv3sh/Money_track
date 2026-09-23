import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Circle } from 'lucide-react'
import { fetchLinkedAccounts, saveOnboarding, type LinkedAccount } from '../api'
import { ConnectStatusCard } from '../components/ConnectStatusCard'
import { GuideSteps } from '../components/GuideSteps'
import { ChartCard, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { trackEvent } from '../lib/analytics'
import { GUIDE_FEATURES, GUIDE_TIPS, GUIDE_WELCOME } from '../lib/productGuide'
import { FULL_SETUP_JOURNEY, TROUBLESHOOTING } from '../lib/setupGuide'

export function GettingStartedPage() {
  const { user, setUser, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string>('sms')
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [inboundConfigured, setInboundConfigured] = useState(false)
  const firstRun = !user?.onboarding_completed

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchLinkedAccounts(true)
        setAccounts(res.items)
        setInboundConfigured(Boolean(res.resend_inbound_configured))
      } catch {
        /* guide still useful without status */
      }
    })()
  }, [])

  const finishOnboarding = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await saveOnboarding({ onboarding_completed: true })
      setUser(next)
      await refreshUser()
      trackEvent('activation_onboarding_done', { sms_live: smsLive })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save progress')
    } finally {
      setBusy(false)
    }
  }

  const smsLive = accounts.some((a) => Boolean(a.last_seen_at))

  return (
    <div className="fade-in mx-auto max-w-3xl space-y-5 pb-10">
      <PageHeader
        title={firstRun ? 'Your setup guide' : 'Help & setup guide'}
        description={
          firstRun
            ? 'Connect SMS first, then confirm a transaction. Email and imports are optional.'
            : GUIDE_WELCOME.subtitle
        }
      />

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <ConnectStatusCard accounts={accounts} inboundConfigured={inboundConfigured} compact />

      {firstRun ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            smsLive
              ? 'border-[var(--credit)]/30 bg-[var(--credit-soft)] text-[var(--credit)]'
              : 'border-[var(--border)] bg-[var(--sheet)] text-[var(--text-secondary)]'
          }`}
        >
          {smsLive ? (
            <>
              <strong>SMS is flowing.</strong> Optional: bank email, salary keywords, then open the
              dashboard.
            </>
          ) : (
            <>
              <strong>Next:</strong> open Phones & email → Copy SMS link → paste into Shortcuts or
              MacroDroid. Come back when one bank SMS lands in Transactions.
            </>
          )}
        </div>
      ) : null}

      <ChartCard title="Complete setup (start to finish)" subtitle="Tap a section to expand the steps">
        <div className="space-y-2">
          {FULL_SETUP_JOURNEY.map((chapter) => {
            const open = openChapter === chapter.id
            return (
              <div
                key={chapter.id}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
                  onClick={() => setOpenChapter(open ? '' : chapter.id)}
                  aria-expanded={open}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--sapphire)]">
                    {chapter.part}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text)]">{chapter.title}</span>
                      {chapter.optional ? (
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                          Optional
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">
                      {chapter.summary}
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className={`mt-1 shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {open ? (
                  <div className="border-t border-[var(--border)] px-4 py-4">
                    <GuideSteps steps={chapter.steps} />
                    {chapter.cta ? (
                      <Link to={chapter.cta.to} className="btn btn-primary mt-4 inline-flex text-sm">
                        {chapter.cta.label}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </ChartCard>

      <ChartCard title="Something not working?" subtitle="Common fixes">
        <GuideSteps steps={TROUBLESHOOTING} />
        <Link to="/accounts" className="btn mt-4 inline-flex text-sm">
          Open Phones & email
        </Link>
      </ChartCard>

      <ChartCard title="Explore the app" subtitle="Where to find things after setup">
        <div className="grid gap-3 sm:grid-cols-2">
          {GUIDE_FEATURES.map((f) => (
            <Link
              key={f.id}
              to={f.to}
              className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 transition hover:border-[var(--sapphire)]/40 hover:bg-[var(--sheet)]"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--sapphire)]">
                <f.icon size={16} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--text)]">{f.title}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{f.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Quick tips" subtitle="Good habits">
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
          {GUIDE_TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </ChartCard>

      <div className="flex flex-wrap gap-2">
        {firstRun ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void finishOnboarding()}
          >
            {busy ? 'Saving…' : smsLive ? 'Go to Dashboard' : 'Skip for now — go to Dashboard'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        )}
        <Link to="/accounts" className="btn">
          Phones & email
        </Link>
        {!user?.setup_completed ? (
          <Link to="/setup" className="btn">
            Resume SMS setup
          </Link>
        ) : null}
      </div>

      {firstRun ? (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Circle size={12} aria-hidden />
          Reopen this guide anytime: avatar menu → Help & guide
        </p>
      ) : (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <CheckCircle2 size={12} className="text-[var(--credit)]" aria-hidden />
          You completed the intro — this page stays here as reference
        </p>
      )}
    </div>
  )
}
