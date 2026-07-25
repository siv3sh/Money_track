import { formatINR } from '../lib/format'
import type { DetailedReport } from '../types'

type Overview = DetailedReport['overview']

interface Props {
  overview: Overview
  byCategory?: DetailedReport['by_category']
  title?: string
  subtitle?: string
}

export function CreditDebitCompareTable({
  overview,
  byCategory = [],
  title = 'Credited vs Debited',
  subtitle = 'Side-by-side comparison for this period',
}: Props) {
  const o = overview
  const diff = o.total_credit - o.total_debit
  const volume = o.total_debit + o.total_credit
  const debitShare = volume > 0 ? Math.round((o.total_debit / volume) * 1000) / 10 : 0
  const creditShare = volume > 0 ? Math.round((o.total_credit / volume) * 1000) / 10 : 0

  const categoryRows = [...(byCategory || [])]
    .filter((r) => r.debit > 0 || r.credit > 0)
    .sort((a, b) => b.debit + b.credit - (a.debit + a.credit))

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-2.5 font-medium">Metric</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--debit)]">
                  Debited (out)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--credit)]">
                  Credited (in)
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--border)] bg-[var(--surface-2)]/50">
                <td className="px-4 py-3 font-semibold">Total amount</td>
                <td className="px-4 py-3 text-right text-base font-semibold tabular-nums text-[var(--debit)]">
                  {formatINR(o.total_debit)}
                </td>
                <td className="px-4 py-3 text-right text-base font-semibold tabular-nums text-[var(--credit)]">
                  {formatINR(o.total_credit)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-semibold tabular-nums ${
                    diff >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                  }`}
                >
                  {diff >= 0 ? '+' : '−'}
                  {formatINR(Math.abs(diff))}
                </td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">Transactions</td>
                <td className="px-4 py-3 text-right tabular-nums">{o.debit_count}</td>
                <td className="px-4 py-3 text-right tabular-nums">{o.credit_count}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                  {o.credit_count - o.debit_count >= 0 ? '+' : ''}
                  {o.credit_count - o.debit_count}
                </td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">Average per txn</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--debit)]">
                  {formatINR(o.avg_debit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--credit)]">
                  {formatINR(o.avg_credit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">—</td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">Largest single</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--debit)]">
                  {formatINR(o.max_debit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--credit)]">
                  {formatINR(o.max_credit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">—</td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">Share of volume</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--debit)]">
                  {debitShare}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--credit)]">
                  {creditShare}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">100%</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--border)]">
                <td colSpan={4} className="px-4 py-3 text-xs text-[var(--muted)]">
                  Net cash flow = credited − debited ={' '}
                  <span
                    className={`font-semibold tabular-nums ${
                      o.net >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                    }`}
                  >
                    {formatINR(o.net)}
                  </span>
                  {o.net >= 0 ? ' (surplus)' : ' (deficit)'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
            <span>Out {debitShare}%</span>
            <span>In {creditShare}%</span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="bg-[var(--debit)] transition-all"
              style={{ width: `${debitShare}%` }}
              title={`Debited ${debitShare}%`}
            />
            <div
              className="bg-[var(--credit)] transition-all"
              style={{ width: `${creditShare}%` }}
              title={`Credited ${creditShare}%`}
            />
          </div>
        </div>
      </section>

      {categoryRows.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              By category · credit vs debit
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Where money left vs where it came in
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--debit)]">
                    Debited
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--credit)]">
                    Credited
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">Net</th>
                  <th className="px-4 py-2.5 text-right font-medium">Txns</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map((r) => (
                  <tr key={r.name} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--debit)]">
                      {r.debit > 0 ? formatINR(r.debit) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--credit)]">
                      {r.credit > 0 ? formatINR(r.credit) : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        r.net >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                      }`}
                    >
                      {formatINR(r.net)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--muted)]">
                      {r.count}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-[var(--surface-2)]/40">
                  <td className="px-4 py-2.5 font-semibold">Total</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--debit)]">
                    {formatINR(o.total_debit)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--credit)]">
                    {formatINR(o.total_credit)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                      o.net >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                    }`}
                  >
                    {formatINR(o.net)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--muted)]">
                    {o.count}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
