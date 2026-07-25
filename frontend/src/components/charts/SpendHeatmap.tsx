import { formatINR } from '../../lib/format'
import { EmptyState } from '../ui/EmptyState'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Props {
  matrix: number[][]
  max: number
}

function intensity(amount: number, max: number): string {
  if (amount <= 0) return 'var(--surface-2)'
  const t = Math.min(1, amount / max)
  const alpha = 0.12 + t * 0.78
  return `color-mix(in srgb, var(--debit) ${Math.round(alpha * 100)}%, var(--surface))`
}

export function SpendHeatmap({ matrix, max }: Props) {
  const hasData = matrix.some((row) => row.some((v) => v > 0))
  if (!hasData) return <EmptyState message="No spending heatmap data" />

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-[40px_repeat(31,minmax(0,1fr))] gap-0.5 text-[9px] text-[var(--muted)]">
        <div />
        {Array.from({ length: 31 }, (_, i) => (
          <div key={i} className="text-center tabular-nums">
            {i + 1}
          </div>
        ))}
        {matrix.map((row, wi) => (
          <div key={WEEKDAYS[wi]} className="contents">
            <div className="flex items-center text-[10px] font-medium">{WEEKDAYS[wi]}</div>
            {row.map((amount, di) => (
              <div
                key={`${wi}-${di}`}
                className="heatmap-cell aspect-square rounded-[3px]"
                style={{ background: intensity(amount, max) }}
                title={`${WEEKDAYS[wi]} · Day ${di + 1}: ${formatINR(amount)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-end gap-2 text-[10px] text-[var(--muted)]">
        <span>Less</span>
        {[0.15, 0.35, 0.55, 0.75, 0.95].map((t) => (
          <span
            key={t}
            className="h-3 w-3 rounded-sm"
            style={{
              background: `color-mix(in srgb, var(--debit) ${Math.round(t * 100)}%, var(--surface))`,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
