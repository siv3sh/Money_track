import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { ChartCard } from '../ui'
import { formatINR } from '../../lib/format'
import type { MomCompare } from './utils'

export function MomCompareStrip({ compare }: { compare: MomCompare | null }) {
  if (!compare) {
    return (
      <ChartCard title="Month vs last month" subtitle="Total lifestyle-related debit" className="mb-5">
        <p className="text-sm text-[var(--muted)]">Not enough monthly history to compare yet.</p>
      </ChartCard>
    )
  }

  const pct = compare.pct
  const up = pct != null && pct > 0
  const down = pct != null && pct < 0
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  const tone = up ? 'text-[var(--debit)]' : down ? 'text-[var(--credit)]' : 'text-[var(--muted)]'

  return (
    <ChartCard
      title="Month vs last month"
      subtitle={`${compare.previousMonth} → ${compare.currentMonth}`}
      className="mb-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-2 gap-6 sm:gap-10">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
              This month
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--debit)]">
              {formatINR(compare.currentDebit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
              Last month
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--text)]">
              {formatINR(compare.previousDebit)}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-sm font-semibold tabular-nums ${tone}`}>
          <Icon size={18} aria-hidden />
          {pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}
        </div>
      </div>
    </ChartCard>
  )
}
