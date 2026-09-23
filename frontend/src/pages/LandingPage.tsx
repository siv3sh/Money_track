import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  EyeOff,
  LayoutDashboard,
  List,
  PieChart,
  Shield,
  Smartphone,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { trackEvent } from '../lib/analytics'
import { LoadingBlock } from '../components/ui'

function postAuthPath(u: { setup_completed?: boolean; onboarding_completed?: boolean }): string {
  if (!u.setup_completed) return '/setup'
  if (!u.onboarding_completed) return '/getting-started'
  return '/dashboard'
}

function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-9 w-9 text-sm' : 'h-11 w-11 text-lg'
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold text-white shadow-[var(--elev-2)] ring-1 ring-white/20 ${box}`}
      style={{
        background:
          'linear-gradient(145deg, color-mix(in srgb, var(--sapphire) 88%, white) 0%, var(--sapphire) 48%, color-mix(in srgb, var(--sapphire) 65%, #061028) 100%)',
      }}
      aria-hidden
    >
      ₹
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 font-[family-name:var(--font-display)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sapphire)]">
      {children}
    </p>
  )
}

type SampleAlert = {
  id: string
  bank: string
  sms: string
  merchant: string
  amount: string
  type: 'debit' | 'credit'
  category: string
}

const SAMPLE_ALERTS: SampleAlert[] = [
  {
    id: 'swiggy',
    bank: 'HDFC',
    sms: 'Spent Rs.428.00 on SWIGGY via UPI on 23-Sep-26. A/c XX1234. Avl bal Rs.XX,XXX.XX',
    merchant: 'Swiggy',
    amount: '−₹428',
    type: 'debit',
    category: 'Food',
  },
  {
    id: 'rent',
    bank: 'ICICI',
    sms: 'INR 18,500.00 debited from A/c XX7890 towards UPI/rent on 01-Sep-26. Not you? Call 1800…',
    merchant: 'UPI · rent',
    amount: '−₹18,500',
    type: 'debit',
    category: 'Housing',
  },
  {
    id: 'salary',
    bank: 'Federal',
    sms: 'Your a/c XX4567 is credited with INR 85,000.00 on 01-Sep-26. Info: SALARY ACME. Avl bal…',
    merchant: 'Salary · ACME',
    amount: '+₹85,000',
    type: 'credit',
    category: 'Income',
  },
  {
    id: 'fuel',
    bank: 'SBI',
    sms: 'Rs.2,140 debited from a/c XX3344 at HPCL on 22-Sep-26 by UPI. A/c bal Rs.XX,XXX',
    merchant: 'HPCL',
    amount: '−₹2,140',
    type: 'debit',
    category: 'Transport',
  },
]

/** Isolated demo — fixed outer shell so nothing below (How it works) ever shifts. */
function InteractiveHeroDemo({
  active,
  onPick,
}: {
  active: SampleAlert
  onPick: (id: string) => void
}) {
  const others = SAMPLE_ALERTS.filter((s) => s.id !== active.id).slice(0, 2)

  return (
    <div className="landing-demo-shell mx-auto w-full max-w-5xl px-3 sm:px-6">
      <div className="landing-hero-visual relative h-full overflow-hidden">
        <div className="landing-hero-glow pointer-events-none absolute inset-0 -z-10" />
        <div className="flex h-full flex-col overflow-hidden rounded-t-xl border border-[var(--border)] border-b-0 bg-[var(--sheet)] shadow-[var(--elev-3)] ring-1 ring-[var(--sapphire)]/10 sm:rounded-t-2xl">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 sm:h-11 sm:px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--debit)]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--wealth)]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--credit)]/70" />
            <span className="ml-2 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)] sm:ml-3 sm:text-[11px]">
              Tally · Home
            </span>
            <span className="ml-auto rounded-md bg-[var(--credit-soft)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--credit)]">
              In ledger
            </span>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-cols-[1fr_1.15fr] lg:grid-rows-1">
            <div className="flex min-h-0 flex-col gap-3 overflow-hidden border-b border-[var(--border)] p-3 sm:p-5 lg:border-b-0 lg:border-r">
              <p className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                Tap a bank alert
              </p>
              <div
                className="landing-chip-row flex h-9 shrink-0 flex-nowrap gap-2 overflow-x-auto"
                role="tablist"
                aria-label="Sample bank alerts"
              >
                {SAMPLE_ALERTS.map((s) => {
                  const selected = s.id === active.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                        selected
                          ? 'border-[var(--sapphire)] bg-[var(--accent-soft)] text-[var(--sapphire)]'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--sapphire)]/40 hover:text-[var(--text)]'
                      }`}
                      onClick={() => onPick(s.id)}
                    >
                      {s.bank}
                    </button>
                  )
                })}
              </div>
              <div className="h-[4.75rem] shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--text-secondary)] sm:h-[5.25rem] sm:text-xs">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Messages · {active.bank}
                </p>
                <p className="line-clamp-3">{active.sms}</p>
              </div>
              {/* Mobile payoff — reserved slot, never expands */}
              <div className="flex h-14 shrink-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-[var(--sapphire)]/30 bg-[var(--accent-soft)] px-3 lg:hidden">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text)]">{active.merchant}</p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {active.bank} · {active.category}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-[family-name:var(--font-mono)] text-sm font-semibold ${
                      active.type === 'credit' ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                    }`}
                  >
                    {active.amount}
                  </span>
                  <Check className="h-4 w-4 text-[var(--credit)]" aria-hidden />
                </div>
              </div>
            </div>

            <div className="hidden min-h-0 flex-col gap-3 overflow-hidden p-3 sm:flex sm:p-5">
              <div className="flex h-12 shrink-0 flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    Your ledger
                  </p>
                  <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)] sm:text-xl">
                    This month
                  </p>
                </div>
                <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)] sm:text-sm">
                  No bank password
                </p>
              </div>

              {/* Reserved active-row slot — fixed height so list below never jumps */}
              <div className="landing-demo-active-slot flex h-14 shrink-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-[var(--sapphire)]/30 bg-[var(--accent-soft)] px-3 sm:px-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text)]">{active.merchant}</p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {active.bank} · {active.category}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-[family-name:var(--font-mono)] text-sm font-semibold sm:text-base ${
                      active.type === 'credit' ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                    }`}
                  >
                    {active.amount}
                  </span>
                  <Check className="h-4 w-4 text-[var(--credit)]" aria-hidden />
                </div>
              </div>

              <ul className="landing-demo-list flex h-[5.5rem] shrink-0 flex-col justify-between" aria-hidden>
                {others.map((row) => (
                  <li
                    key={row.id}
                    className="flex h-10 items-center justify-between rounded-lg border border-[var(--border)]/80 bg-[var(--surface)] px-3 text-sm opacity-70"
                  >
                    <span className="truncate text-[var(--text)]">{row.merchant}</span>
                    <span
                      className={`shrink-0 font-[family-name:var(--font-mono)] text-[13px] font-medium ${
                        row.type === 'credit' ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                      }`}
                    >
                      {row.amount}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const HOW_STEPS = [
  {
    id: 'forward',
    icon: Smartphone,
    title: 'Forward bank SMS',
    body: 'On iPhone use Shortcuts; on Android use MacroDroid. Your phone sends alerts to a private Tally link — no bank login.',
    preview: 'Your phone already gets “Rs 500 spent…” — Tally just needs that text.',
  },
  {
    id: 'parse',
    icon: List,
    title: 'Parse every rupee',
    body: 'Works with Federal, ICICI, SIB, HDFC, SBI, Axis, and Kotak — amount and debit/credit, then you confirm.',
    preview: 'Wrong category? Fix once — Tally remembers for next time.',
  },
  {
    id: 'trust',
    icon: LayoutDashboard,
    title: 'Trust the ledger',
    body: 'Home, Spending, and Transactions stay front and center — the ledger customers actually use.',
    preview: 'The promise: a UPI/SMS ledger that doesn’t lie.',
  },
] as const

const TRUST_POINTS = [
  {
    icon: EyeOff,
    title: 'No bank password',
    body: 'We never ask for net-banking or UPI PIN. Only SMS and optional email you already receive.',
  },
  {
    icon: Shield,
    title: 'Your data stays yours',
    body: 'Each account is private. Passwords are hashed. You can delete everything from Profile anytime.',
  },
  {
    icon: PieChart,
    title: 'Spending from truth',
    body: 'Merchants and budgets come from real ledger rows — not scraped guesses.',
  },
] as const

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function LandingPage() {
  const { user, loading } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [showStickyCta, setShowStickyCta] = useState(false)
  const [activeId, setActiveId] = useState(SAMPLE_ALERTS[0].id)
  const [howStep, setHowStep] = useState(0)
  const heroEndRef = useRef<HTMLDivElement>(null)
  const stickyVisibleRef = useRef(false)
  const reducedMotion = usePrefersReducedMotion()
  const active = SAMPLE_ALERTS.find((s) => s.id === activeId) ?? SAMPLE_ALERTS[0]

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 12)
      const heroBottom = heroEndRef.current?.getBoundingClientRect().bottom ?? 0
      const next = stickyVisibleRef.current ? heroBottom < -40 : heroBottom < -120
      if (next !== stickyVisibleRef.current) {
        stickyVisibleRef.current = next
        setShowStickyCta(next)
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const pickSample = (id: string) => {
    setActiveId(id)
    trackEvent('landing_sample_alert', { bank: id })
  }

  const scrollToId = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 72
    window.scrollTo({
      top: Math.max(0, top),
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }

  const onSignupClick = (where: string) => {
    trackEvent('landing_cta_signup', { where })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
        <LoadingBlock />
      </div>
    )
  }

  if (user) {
    return <Navigate to={postAuthPath(user)} replace />
  }

  const how = HOW_STEPS[howStep]
  const HowIcon = how.icon

  return (
    <div className="landing-root min-h-screen overflow-x-hidden bg-[var(--canvas)] pb-16 text-[var(--text)]">
      <header
        className={`sticky top-0 z-40 border-b transition-[background,border-color,backdrop-filter] duration-200 ${
          scrolled
            ? 'border-[var(--border)] bg-[var(--glass-bg)] backdrop-blur-md'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <BrandMark size="sm" />
            <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight sm:text-base">
              Tally
            </span>
          </Link>
          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <a
              href="#demo"
              className="hidden text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)] md:inline"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('demo')
              }}
            >
              Try a sample
            </a>
            <a
              href="#how"
              className="hidden text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)] md:inline"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('how')
              }}
            >
              How it works
            </a>
            <Link
              to="/pricing"
              className="hidden text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)] sm:inline"
            >
              Pricing
            </Link>
            <Link
              to="/login"
              className="rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] sm:px-3"
            >
              Sign in
            </Link>
            <Link
              to="/login?mode=signup"
              className="btn btn-primary gap-1.5 px-3 py-2 text-sm sm:px-3.5"
              onClick={() => onSignupClick('nav')}
            >
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Start free</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="landing-hero-bg pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-6xl px-4 pb-2 pt-8 text-center sm:px-6 sm:pb-4 sm:pt-12">
          <h1 className="landing-fade-up font-[family-name:var(--font-display)] text-[2.5rem] font-semibold leading-[1.05] tracking-tight text-[var(--ink)] sm:text-6xl md:text-7xl">
            Tally
          </h1>
          <p className="landing-fade-up landing-delay-1 mx-auto mt-3 max-w-xl px-1 font-[family-name:var(--font-display)] text-lg font-medium leading-snug text-[var(--text)] sm:mt-4 sm:text-2xl">
            My UPI/SMS ledger that doesn’t lie.
          </p>
          <p className="landing-fade-up landing-delay-2 mx-auto mt-3 max-w-md px-1 text-[14px] leading-relaxed text-[var(--text-secondary)] sm:text-[15px]">
            Forward bank SMS from your phone. We parse every rupee. No bank password.
          </p>
          <div className="landing-fade-up landing-delay-3 mx-auto mt-6 flex w-full max-w-sm flex-col gap-2.5 sm:mt-7 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
            <Link
              to="/login?mode=signup"
              className="btn btn-primary w-full justify-center gap-2 px-5 py-3 text-[15px] sm:w-auto sm:py-2.5"
              onClick={() => onSignupClick('hero')}
            >
              Create free account
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a
              href="#demo"
              className="btn w-full justify-center gap-2 border border-[var(--border)] bg-[var(--sheet)] px-5 py-3 text-[15px] text-[var(--text)] shadow-[var(--elev-1)] sm:w-auto sm:py-2.5"
              onClick={(e) => {
                e.preventDefault()
                trackEvent('landing_see_demo')
                scrollToId('demo')
              }}
            >
              Try a sample
            </a>
          </div>
          <p className="landing-fade-up landing-delay-3 mt-3 text-xs text-[var(--muted)]">
            Free forever · ~10 minutes to first transaction
          </p>
        </div>

        <div id="demo" className="relative scroll-mt-24 overflow-hidden pb-6 pt-4 sm:pb-10 sm:pt-6">
          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Bank SMS → your ledger
          </p>
          <InteractiveHeroDemo active={active} onPick={pickSample} />
          <div ref={heroEndRef} className="h-px" aria-hidden />
        </div>
      </section>

      <section id="how" className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--sheet)] py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="max-w-lg font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
            Three steps. One honest ledger.
          </h2>
          <p className="mt-2 max-w-xl text-[var(--text-secondary)]">
            Tap a step — no net-banking scrape, just SMS you already get.
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
            <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" role="tablist">
              {HOW_STEPS.map((step, i) => {
                const Icon = step.icon
                const selected = i === howStep
                return (
                  <li key={step.id} className="shrink-0">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-150 lg:w-full ${
                        selected
                          ? 'border-[var(--sapphire)] bg-[var(--accent-soft)]'
                          : 'border-[var(--border)] bg-[var(--canvas)] hover:border-[var(--sapphire)]/40'
                      }`}
                      onClick={() => {
                        setHowStep(i)
                        trackEvent('landing_how_step', { step: step.id })
                      }}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          selected
                            ? 'bg-[var(--sapphire)] text-white'
                            : 'bg-[var(--accent-soft)] text-[var(--sapphire)]'
                        }`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">
                          Step {i + 1}
                        </span>
                        <span className="block text-sm font-semibold text-[var(--text)]">{step.title}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>

            <div
              key={how.id}
              className="landing-how-panel min-h-[240px] rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-5 sm:min-h-[260px] sm:p-8"
              role="tabpanel"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--sapphire)]">
                <HowIcon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold sm:text-2xl">
                {how.title}
              </h3>
              <p className="mt-2 max-w-lg text-[var(--text-secondary)] leading-relaxed">{how.body}</p>
              <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--sheet)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                {how.preview}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {howStep < HOW_STEPS.length - 1 ? (
                  <button
                    type="button"
                    className="btn btn-primary gap-1.5 text-sm"
                    onClick={() => setHowStep((s) => Math.min(s + 1, HOW_STEPS.length - 1))}
                  >
                    Next step
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : (
                  <Link
                    to="/login?mode=signup"
                    className="btn btn-primary gap-1.5 text-sm"
                    onClick={() => onSignupClick('how')}
                  >
                    Create free account
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
                <a
                  href="#demo"
                  className="btn text-sm"
                  onClick={(e) => {
                    e.preventDefault()
                    scrollToId('demo')
                  }}
                >
                  Try a sample
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionLabel>Why people stay</SectionLabel>
          <h2 className="max-w-lg font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
            Convenience without giving up the bank
          </h2>
          <ul className="mt-10 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {TRUST_POINTS.map((f) => {
              const Icon = f.icon
              return (
                <li
                  key={f.title}
                  className="group flex gap-4 py-5 transition-colors duration-150 hover:bg-[var(--sheet)] sm:gap-5 sm:px-2"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--sapphire)] transition-transform duration-150 group-hover:scale-105">
                    <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-[family-name:var(--font-display)] text-base font-semibold">
                      {f.title}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">
                      {f.body}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="mt-10">
            <p className="text-sm font-medium text-[var(--text)]">Works with SMS you already get</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                'Federal Bank',
                'ICICI',
                'South Indian Bank',
                'HDFC',
                'SBI',
                'Axis',
                'Kotak',
                'CSV / PDF',
                'Bank email',
              ].map((b) => (
                <span
                  key={b}
                  className="rounded-lg border border-[var(--border)] bg-[var(--sheet)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--sapphire)]/40 hover:text-[var(--text)]"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--sheet)] py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready when your next bank SMS arrives
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[var(--text-secondary)]">
            Create an account, connect your phone once, and every debit/credit lands as a clean
            transaction.
          </p>
          <Link
            to="/login?mode=signup"
            className="btn btn-primary mt-8 inline-flex gap-2 px-6 py-2.5 text-[15px]"
            onClick={() => onSignupClick('footer_cta')}
          >
            Create free account
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="mt-3 text-xs text-[var(--muted)]">
            <Link to="/privacy" className="underline-offset-2 hover:underline">
              Privacy
            </Link>
            {' · '}
            <Link to="/pricing" className="underline-offset-2 hover:underline">
              Pricing
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--border)] bg-[var(--canvas)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" />
            <div>
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold">Tally</p>
              <p className="text-xs text-[var(--muted)]">UPI/SMS ledger that doesn’t lie</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
            <Link to="/pricing" className="hover:text-[var(--text)]">
              Pricing
            </Link>
            <Link to="/privacy" className="hover:text-[var(--text)]">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-[var(--text)]">
              Terms
            </Link>
            <Link to="/login" className="hover:text-[var(--text)]">
              Sign in
            </Link>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl px-4 text-center text-[11px] text-[var(--muted)] sm:px-6 sm:text-left">
          © {new Date().getFullYear()} Tally. Not affiliated with any bank. Not a registered advisor —
          not financial advice.
        </p>
      </footer>

      {/* Sticky convert bar — after hero */}
      <div
        className={`landing-sticky-cta fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--glass-bg)] px-4 py-3 backdrop-blur-md sm:px-6 ${
          showStickyCta ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
        aria-hidden={!showStickyCta}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="hidden min-w-0 text-sm text-[var(--text-secondary)] sm:block">
            Ready for a ledger that doesn’t lie?
          </p>
          <p className="min-w-0 truncate text-sm font-medium text-[var(--text)] sm:hidden">
            Start free — ~10 min
          </p>
          <Link
            to="/login?mode=signup"
            className="btn btn-primary shrink-0 gap-1.5 px-4 py-2 text-sm"
            onClick={() => onSignupClick('sticky')}
            tabIndex={showStickyCta ? 0 : -1}
          >
            Create account
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
