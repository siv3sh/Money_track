import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { saveOnboarding } from '../api'
import { ChartCard, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import {
  GUIDE_CHECKLIST,
  GUIDE_FEATURES,
  GUIDE_SETUP_STEPS,
  GUIDE_TIPS,
  GUIDE_WELCOME,
} from '../lib/productGuide'

export function GettingStartedPage() {
  const { user, setUser, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    <div className="fade-in mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={firstRun ? GUIDE_WELCOME.title : 'Help & guide'}
        description={GUIDE_WELCOME.subtitle}
      />

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <ChartCard title="How to set up" subtitle="Do these once — SMS is the main feed">
        <ol className="space-y-4">
          {GUIDE_SETUP_STEPS.map((step) => (
            <li key={step.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text)]">{step.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{step.body}</p>
              {step.to && step.cta ? (
                <Link to={step.to} className="btn mt-3 inline-flex text-xs">
                  {step.cta}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </ChartCard>

      <ChartCard title="What you can do" subtitle="Every major area of the app">
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
                {f.note ? (
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    {f.note}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="First-week checklist" subtitle="A short path to a useful dashboard">
        <ul className="space-y-3">
          {GUIDE_CHECKLIST.map((item) => (
            <li key={item.id} className="flex gap-3">
              {firstRun ? (
                <Circle size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
              ) : (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--credit)]" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{item.description}</p>
                {item.to ? (
                  <Link to={item.to} className="mt-1 inline-block text-xs font-medium text-[var(--sapphire)]">
                    Open →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard title="Tips" subtitle="Small habits that keep the vault clean">
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
          {GUIDE_TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </ChartCard>

      <div className="flex flex-wrap gap-2 pb-8">
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
          Open Phones & email
        </Link>
      </div>
    </div>
  )
}
