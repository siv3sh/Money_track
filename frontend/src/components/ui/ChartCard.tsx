import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  tall?: boolean
}

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = '',
  tall = false,
}: Props) {
  return (
    <section className={`panel flex flex-col p-4 sm:p-5 fade-up ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-[var(--text)]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className={tall ? 'min-h-[340px] flex-1' : 'min-h-[280px] flex-1'}>{children}</div>
    </section>
  )
}
