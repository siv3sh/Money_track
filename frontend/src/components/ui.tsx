import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { pctChangeLabel } from '../lib/format'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  children,
  className = '',
  action,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1 p-3 sm:p-4">{children}</div>
    </section>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
  change,
  icon,
  to,
  linkLabel = 'View transactions',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'credit' | 'debit'
  change?: number | null
  icon?: ReactNode
  to?: string
  linkLabel?: string
}) {
  const toneClass =
    tone === 'credit'
      ? 'text-[var(--credit)]'
      : tone === 'debit'
        ? 'text-[var(--debit)]'
        : 'text-[var(--text)]'

  const changeTone =
    change == null
      ? 'text-[var(--muted)]'
      : change > 0
        ? 'text-[var(--credit)]'
        : change < 0
          ? 'text-[var(--debit)]'
          : 'text-[var(--muted)]'

  return (
    <article className="panel fade-in px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          {label}
        </p>
        {icon ? <span className="text-[var(--muted)]">{icon}</span> : null}
      </div>
      <p className={`kpi-value mt-2 text-2xl font-semibold sm:text-[1.65rem] ${toneClass}`}>
        {value}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {change !== undefined ? (
          <span className={`inline-flex items-center gap-0.5 font-medium ${changeTone}`}>
            {change == null || change === 0 ? (
              <Minus size={12} />
            ) : change > 0 ? (
              <ArrowUpRight size={12} />
            ) : (
              <ArrowDownRight size={12} />
            )}
            {pctChangeLabel(change)}
          </span>
        ) : null}
        {hint ? <span className="text-[var(--muted)]">{hint}</span> : null}
        {to ? (
          <Link to={to} className="font-medium text-[var(--accent)] hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </article>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-sm text-[var(--muted)]">
      {message}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-[var(--muted)]">
      {label}
    </div>
  )
}
