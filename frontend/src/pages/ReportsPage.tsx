import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchDetailedReport } from '../api'
import type { DetailedReport } from '../types'
import { formatDate, formatINR } from '../lib/format'
import { CARD_TYPE_LABELS, type CardType } from '../types'

const field =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)]'

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'debit' | 'credit' | 'neutral'
}) {
  const color =
    tone === 'debit'
      ? 'text-[var(--debit)]'
      : tone === 'credit'
        ? 'text-[var(--credit)]'
        : 'text-[var(--text)]'
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
  nameLabel = 'Name',
}: {
  title: string
  rows: DetailedReport['by_bank']
  nameLabel?: string
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2 font-medium">{nameLabel}</th>
                <th className="px-4 py-2 font-medium">Debit</th>
                <th className="px-4 py-2 font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">Net</th>
                <th className="px-4 py-2 font-medium">Txns</th>
                <th className="px-4 py-2 font-medium">Debit %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                    {formatINR(r.debit)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-[var(--credit)]">
                    {formatINR(r.credit)}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatINR(r.net)}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{r.count}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{r.debit_share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function labelCardType(name: string): string {
  if (name in CARD_TYPE_LABELS) return CARD_TYPE_LABELS[name as CardType]
  return name
}

export function ReportsPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<DetailedReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchDetailedReport({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        merchant_limit: 15,
      })
      setReport(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

  const o = report?.overview

  return (
    <div className="space-y-6">
      <section className="panel flex flex-wrap items-end gap-3 p-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Detailed reports</h2>
          <p className="text-sm text-[var(--muted)]">
            Filter by date for deeper spend analysis
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            From
            <input
              type="date"
              className={`${field} mt-1 block`}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input
              type="date"
              className={`${field} mt-1 block`}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDateFrom('')
              setDateTo('')
            }}
          >
            Clear
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/35 bg-[var(--debit)]/10 px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <p className="text-sm text-[var(--muted)]">Loading report…</p>
      ) : null}

      {o ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total debit" value={formatINR(o.total_debit)} tone="debit" />
            <StatCard label="Total credit" value={formatINR(o.total_credit)} tone="credit" />
            <StatCard
              label="Net"
              value={formatINR(o.net)}
              tone={o.net >= 0 ? 'credit' : 'debit'}
            />
            <StatCard
              label="Transactions"
              value={String(o.count)}
              hint={`${o.debit_count} debit · ${o.credit_count} credit`}
            />
            <StatCard label="Avg debit" value={formatINR(o.avg_debit)} tone="debit" />
            <StatCard label="Avg credit" value={formatINR(o.avg_credit)} tone="credit" />
            <StatCard label="Largest debit" value={formatINR(o.max_debit)} tone="debit" />
            <StatCard
              label="Avg daily spend"
              value={formatINR(o.avg_daily_debit)}
              hint={`${o.active_days} active days`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-4">
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Monthly debit vs credit
              </h3>
              <div className="h-72">
                {report.monthly.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                    No monthly data
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.monthly}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis
                        tick={{ fill: 'var(--muted)', fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                        }
                        width={48}
                      />
                      <Tooltip formatter={(v) => formatINR(Number(v ?? 0))} />
                      <Legend />
                      <Bar dataKey="debit" name="Debit" fill="var(--chart-debit)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="credit" name="Credit" fill="var(--chart-credit)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="panel p-4">
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Spend by weekday
              </h3>
              <div className="h-72">
                {report.weekday.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                    No weekday data
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.weekday}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis
                        tick={{ fill: 'var(--muted)', fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                        }
                        width={48}
                      />
                      <Tooltip formatter={(v) => formatINR(Number(v ?? 0))} />
                      <Bar dataKey="amount" name="Debit" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <BreakdownTable title="By bank" rows={report.by_bank} nameLabel="Bank" />
          <BreakdownTable
            title="By payment type"
            rows={report.by_card_type.map((r) => ({ ...r, name: labelCardType(r.name) }))}
            nameLabel="Type"
          />
          <BreakdownTable title="By source" rows={report.by_source} nameLabel="Source" />

          <section className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Top merchants
            </div>
            {report.merchants.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No merchant data</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 font-medium">Spend</th>
                      <th className="px-4 py-2 font-medium">Txns</th>
                      <th className="px-4 py-2 font-medium">Avg</th>
                      <th className="px-4 py-2 font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.merchants.map((m) => (
                      <tr key={m.merchant} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2 font-medium">{m.merchant}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                          {formatINR(m.amount)}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{m.count}</td>
                        <td className="px-4 py-2 tabular-nums">{formatINR(m.avg)}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{m.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Largest transactions
            </div>
            {report.largest.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No transactions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 font-medium">Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.largest.map((t) => (
                      <tr key={t._id} className="border-t border-[var(--border)]">
                        <td className="whitespace-nowrap px-4 py-2 text-[var(--muted)]">
                          {formatDate(t.received_at)}
                        </td>
                        <td
                          className={`px-4 py-2 capitalize ${
                            t.type === 'debit' ? 'text-[var(--debit)]' : 'text-[var(--credit)]'
                          }`}
                        >
                          {t.type}
                        </td>
                        <td className="px-4 py-2 font-medium tabular-nums">
                          {formatINR(t.amount)}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-2">{t.merchant || '—'}</td>
                        <td className="px-4 py-2 text-[var(--muted)]">{t.bank || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Daily breakdown
            </div>
            {report.daily.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No daily data</p>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[var(--surface)] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Debit</th>
                      <th className="px-4 py-2 font-medium">Credit</th>
                      <th className="px-4 py-2 font-medium">Net</th>
                      <th className="px-4 py-2 font-medium">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2">{d.date}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--debit)]">
                          {formatINR(d.debit)}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-[var(--credit)]">
                          {formatINR(d.credit)}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{formatINR(d.net)}</td>
                        <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
