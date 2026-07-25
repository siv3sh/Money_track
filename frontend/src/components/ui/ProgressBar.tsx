interface Props {
  value: number
  max?: number
  tone?: 'credit' | 'debit' | 'accent' | 'warning'
  label?: string
}

export function ProgressBar({ value, max = 100, tone = 'accent', label }: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color =
    tone === 'debit'
      ? 'bg-[var(--debit)]'
      : tone === 'credit'
        ? 'bg-[var(--credit)]'
        : tone === 'warning'
          ? 'bg-[var(--warning)]'
          : 'bg-[var(--accent)]'

  return (
    <div>
      {label ? (
        <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
