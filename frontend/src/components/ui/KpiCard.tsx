import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

interface Props {
  label: string
  value: string
  hint?: string
  tone?: 'debit' | 'credit' | 'neutral' | 'warning'
  delta?: number | null
  deltaInvert?: boolean
  icon?: ReactNode
  className?: string
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
  delta,
  deltaInvert = false,
  icon,
  className = '',
}: Props) {
  const valueColor =
    tone === 'debit'
      ? 'text-[var(--debit)]'
      : tone === 'credit'
        ? 'text-[var(--credit)]'
        : tone === 'warning'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text)]'

  const accentBar =
    tone === 'debit'
      ? 'bg-[var(--debit)]'
      : tone === 'credit'
        ? 'bg-[var(--credit)]'
        : tone === 'warning'
          ? 'bg-[var(--warning)]'
          : 'bg-[var(--accent)]'

  let deltaPositive = delta != null ? delta >= 0 : null
  if (deltaInvert && deltaPositive != null) deltaPositive = !deltaPositive

  return (
    <div className={`panel relative overflow-hidden px-5 py-4 fade-up ${className}`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${accentBar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            {label}
          </p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${valueColor}`}>
            {value}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {delta != null && Number.isFinite(delta) ? (
              <span
                className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                  deltaPositive
                    ? 'bg-[var(--credit-soft)] text-[var(--credit)]'
                    : 'bg-[var(--debit-soft)] text-[var(--debit)]'
                }`}
              >
                {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}
              </span>
            ) : null}
            {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
          </div>
        </div>
        {icon ? (
          <span className="rounded-xl bg-[var(--surface-2)] p-2.5 text-[var(--muted)]">
            {icon}
          </span>
        ) : null}
      </div>
    </div>
  )
}
