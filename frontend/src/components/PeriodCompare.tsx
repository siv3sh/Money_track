import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatINR, pctChangeLabel } from '../lib/format'
import type { BreakdownRow, MonthlyRow } from '../types'

const NON_LIFESTYLE = new Set(['Transfers', 'Investments', 'Income'])

function pct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10
}

function sumMonths(
  rows: MonthlyRow[],
  keys: string[],
): { credit: number; debit: number; net: number } {
  const set = new Set(keys)
  let credit = 0
  let debit = 0
  for (const r of rows) {
    if (!set.has(r.month)) continue
    credit += r.credit
    debit += r.debit
  }
  return { credit, debit, net: credit - debit }
}

function lifestyleForMonths(
  monthly: MonthlyRow[],
  byCategory: BreakdownRow[] | undefined,
  keys: string[],
): number {
  // Approximate: scale overall lifestyle share onto monthly debit for selected months
  const totals = sumMonths(monthly, keys)
  const lifestyleDebit = (byCategory || [])
    .filter((c) => !NON_LIFESTYLE.has(c.name))
    .reduce((s, c) => s + c.debit, 0)
  const allDebit = (byCategory || []).reduce((s, c) => s + c.debit, 0)
  if (!allDebit) return 0
  return Math.round((totals.debit * lifestyleDebit) / allDebit)
}

function quarterKeys(anchor: string): string[] {
  const [y, m] = anchor.split('-').map(Number)
  const startMonth = Math.floor((m - 1) / 3) * 3 + 1
  return [0, 1, 2].map((i) => {
    const mm = startMonth + i
    return `${y}-${String(mm).padStart(2, '0')}`
  })
}

function prevQuarterKeys(anchor: string): string[] {
  const [y, m] = anchor.split('-').map(Number)
  const startMonth = Math.floor((m - 1) / 3) * 3 + 1
  let py = y
  let pm = startMonth - 3
  if (pm < 1) {
    pm += 12
    py -= 1
  }
  return [0, 1, 2].map((i) => {
    const mm = pm + i
    return `${py}-${String(mm).padStart(2, '0')}`
  })
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--muted)]">—</span>
  const tone =
    value > 0 ? 'text-[var(--credit)]' : value < 0 ? 'text-[var(--debit)]' : 'text-[var(--muted)]'
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}>
      {value === 0 ? <Minus size={12} /> : value > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {pctChangeLabel(value)}
    </span>
  )
}

function CompareTable({
  title,
  currentLabel,
  previousLabel,
  current,
  previous,
}: {
  title: string
  currentLabel: string
  previousLabel: string
  current: { credit: number; debit: number; net: number; lifestyle: number }
  previous: { credit: number; debit: number; net: number; lifestyle: number }
}) {
  const rows = [
    { label: 'Total credited', curr: current.credit, prev: previous.credit, tone: 'credit' as const },
    { label: 'Total debited', curr: current.debit, prev: previous.debit, tone: 'debit' as const },
    { label: 'Net savings', curr: current.net, prev: previous.net, tone: 'neutral' as const },
    {
      label: 'Lifestyle spend',
      curr: current.lifestyle,
      prev: previous.lifestyle,
      tone: 'debit' as const,
    },
  ]
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-[var(--muted)]">
          {currentLabel} vs {previousLabel}
        </p>
      </div>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-4 py-2 text-right font-medium">Current</th>
            <th className="px-4 py-2 text-right font-medium">Previous</th>
            <th className="px-4 py-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--border)]">
              <td className="px-4 py-2.5">{r.label}</td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                  r.tone === 'credit'
                    ? 'text-[var(--credit)]'
                    : r.tone === 'debit'
                      ? 'text-[var(--debit)]'
                      : ''
                }`}
              >
                {formatINR(r.curr)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--muted)]">
                {formatINR(r.prev)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Change value={pct(r.curr, r.prev)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PeriodCompare({
  monthly,
  byCategory,
  className,
}: {
  monthly: MonthlyRow[]
  byCategory?: BreakdownRow[]
  className?: string
}) {
  if (monthly.length < 2) return null
  const sorted = [...monthly].sort((a, b) => a.month.localeCompare(b.month))
  const thisMonth = sorted[sorted.length - 1]?.month
  const lastMonth = sorted[sorted.length - 2]?.month
  if (!thisMonth || !lastMonth) return null

  const momCurr = sumMonths(sorted, [thisMonth])
  const momPrev = sumMonths(sorted, [lastMonth])
  const qCurrKeys = quarterKeys(thisMonth)
  const qPrevKeys = prevQuarterKeys(thisMonth)
  const qCurr = sumMonths(sorted, qCurrKeys)
  const qPrev = sumMonths(sorted, qPrevKeys)

  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${className || ''}`}>
      <CompareTable
        title="This month vs last month"
        currentLabel={thisMonth}
        previousLabel={lastMonth}
        current={{
          ...momCurr,
          lifestyle: lifestyleForMonths(sorted, byCategory, [thisMonth]),
        }}
        previous={{
          ...momPrev,
          lifestyle: lifestyleForMonths(sorted, byCategory, [lastMonth]),
        }}
      />
      <CompareTable
        title="This quarter vs last quarter"
        currentLabel={qCurrKeys.join(' · ')}
        previousLabel={qPrevKeys.join(' · ')}
        current={{
          ...qCurr,
          lifestyle: lifestyleForMonths(sorted, byCategory, qCurrKeys),
        }}
        previous={{
          ...qPrev,
          lifestyle: lifestyleForMonths(sorted, byCategory, qPrevKeys),
        }}
      />
    </div>
  )
}
