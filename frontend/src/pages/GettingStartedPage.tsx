import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Circle } from 'lucide-react'
import { saveOnboarding } from '../api'
import { GuideSteps } from '../components/GuideSteps'
import { ChartCard, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { GUIDE_FEATURES, GUIDE_TIPS, GUIDE_WELCOME } from '../lib/productGuide'
import { FULL_SETUP_JOURNEY, TROUBLESHOOTING } from '../lib/setupGuide'

export function GettingStartedPage() {
  const { user, setUser, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string>('sms')
  const firstRun = !user?.onboarding_completed

  const finishOnboarding = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await saveOnboarding({ onboarding_completed: true })
      setUser(next)
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save progress')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in mx-auto max-w-3xl space-y-5 pb-10">
      <PageHeader
        title={firstRun ? 'Your setup guide' : 'Help & setup guide'}
        description={
          firstRun
            ? 'Everything you need to go from zero to a working dashboard — follow in order, skip what you do not need.'
            : GUIDE_WELCOME.subtitle
        }
      />

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {firstRun ? (
        <div className="rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-sm text-[var(--credit)]">
          <strong>SMS setup done?</strong> Work through the sections below. Bank emails and imports
          are optional — many people only use SMS.
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
          Open Accounts for links & email setup
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
            {busy ? 'Saving…' : 'Go to Dashboard'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        )}
        <Link to="/accounts" className="btn">
          Accounts & SMS links
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
