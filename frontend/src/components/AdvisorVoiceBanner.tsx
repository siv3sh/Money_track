import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'

export type AdvisorBriefing = {
  preferred_name?: string
  level?: string
  mood?: string
  headline?: string
  reasons?: string[]
  /** When false, hide Soft spot/Goal footer under firm alerts (stakes not relevant to trigger). */
  show_profile_stakes?: boolean
  profile?: {
    preferred_name?: string | null
    coach_tone?: string | null
    soft_spot?: string | null
    motivation?: string | null
    completeness?: number
  }
  context_line?: string | null
}

export function AdvisorVoiceBanner({
  advisor,
  className = '',
}: {
  advisor?: AdvisorBriefing | null
  className?: string
}) {
  if (!advisor?.headline) return null
  const level = (advisor.level || 'informational').toLowerCase()
  const mood = (advisor.mood || '').toLowerCase()
  const firm = level === 'strict' || level === 'concerned'
  const happy = mood === 'salary_happy' || mood === 'month_start' || (!firm && level === 'informational')
  // Firm banners: hide Soft spot/Goal when backend says stakes aren't relevant to the trigger.
  // Informational/happy: keep as ambient trained-profile context (default true if omitted).
  const showStakes = advisor.show_profile_stakes !== false
  const showProfileFooter =
    showStakes && Boolean(advisor.profile?.motivation || advisor.profile?.soft_spot)
  return (
    <section
      className={`advisor-banner mb-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${
        happy ? 'advisor-banner--happy' : ''
      } ${firm ? 'advisor-banner--firm' : ''} ${className}`}
    >
      <div className="relative border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              <span className="advisor-spark">
                <Sparkles size={13} />
              </span>
              Advisor
              {advisor.preferred_name ? ` · ${advisor.preferred_name}` : ''}
              <span className={firm ? 'text-[var(--debit)]' : 'text-[var(--credit)]'}>
                · {mood && mood !== 'steady' ? mood.replace(/_/g, ' ') : level}
              </span>
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--text)] sm:text-[15px]">
              {advisor.headline}
            </p>
            {showProfileFooter ? (
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                {advisor.profile?.soft_spot ? `Soft spot: ${advisor.profile.soft_spot}` : null}
                {advisor.profile?.soft_spot && advisor.profile?.motivation ? ' · ' : null}
                {advisor.profile?.motivation ? `Goal: ${advisor.profile.motivation}` : null}
              </p>
            ) : null}
          </div>
          <Link to="/planning" className="btn shrink-0 text-xs">
            Open Advisor
          </Link>
        </div>
      </div>
    </section>
  )
}
