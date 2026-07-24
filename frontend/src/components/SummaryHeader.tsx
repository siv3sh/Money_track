import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { Summary } from '../types'
import { formatINR, pctChange } from '../lib/format'

interface Props {
  summary: Summary
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'debit' | 'credit' | 'neutral'
  hint?: string | null
}) {
  const color =
    tone === 'debit'
      ? 'text-[var(--debit)]'
      : tone === 'credit'
        ? 'text-[var(--credit)]'
        : 'text-[var(--text)]'

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  )
}

export function SummaryHeader({ summary }: Props) {
  const debitDelta = pctChange(summary.this_month_debit, summary.last_month_debit)
  const creditDelta = pctChange(summary.this_month_credit, summary.last_month_credit)
  const netDelta = pctChange(summary.this_month_net, summary.last_month_net)

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total debit" value={formatINR(summary.total_debit)} tone="debit" />
        <Stat label="Total credit" value={formatINR(summary.total_credit)} tone="credit" />
        <Stat
          label="Net"
          value={formatINR(summary.net)}
          tone={summary.net >= 0 ? 'credit' : 'debit'}
        />
        <Stat label="Transactions" value={String(summary.count)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--muted)]">
            <ArrowDownRight size={14} className="text-[var(--debit)]" />
            This month debit
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--debit)]">
            {formatINR(summary.this_month_debit)}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Last month {formatINR(summary.last_month_debit)}
            {debitDelta ? ` · ${debitDelta}` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--muted)]">
            <ArrowUpRight size={14} className="text-[var(--credit)]" />
            This month credit
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--credit)]">
            {formatINR(summary.this_month_credit)}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Last month {formatINR(summary.last_month_credit)}
            {creditDelta ? ` · ${creditDelta}` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">This month net</div>
          <div
            className={`mt-1 text-lg font-semibold tabular-nums ${
              summary.this_month_net >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
            }`}
          >
            {formatINR(summary.this_month_net)}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Last month {formatINR(summary.last_month_net)}
            {netDelta ? ` · ${netDelta}` : ''}
          </div>
        </div>
      </div>
    </section>
  )
}
