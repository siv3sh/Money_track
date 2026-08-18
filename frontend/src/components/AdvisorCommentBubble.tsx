import type { AdvisorComment, GoalImpact } from '../api'

export function AdvisorCommentBubble({
  comment,
  impact,
  className = '',
}: {
  comment?: AdvisorComment | string | null
  impact?: GoalImpact | null
  className?: string
}) {
  const text =
    typeof comment === 'string'
      ? comment
      : comment?.comment || impact?.comment || null
  if (!text) return null
  const severity =
    typeof comment === 'object' && comment?.advisor_severity
      ? comment.advisor_severity
      : undefined
  const firm = severity === 'strict' || severity === 'concerned'
  return (
    <div
      className={`advisor-comment mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed ${className}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
        <span className="advisor-spark mr-1 inline-flex align-middle">✦</span>
        Advisor
        {severity ? (
          <span className={firm ? ' text-[var(--debit)]' : ' text-[var(--credit)]'}>
            {' '}
            · {severity}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[var(--text)]">{text}</p>
      {impact?.impact?.delta_months != null && impact.impact.delta_months >= 0.1 ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Goal impact: ~{impact.impact.delta_months} mo on {impact.impact.goal_name}
        </p>
      ) : null}
    </div>
  )
}
