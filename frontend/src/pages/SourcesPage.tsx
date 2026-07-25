import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  DonutChart,
  GroupedSourceBars,
  MultiLineChart,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR, formatMonth } from '../lib/format'
import { transactionsHref } from '../lib/transactionsLink'

export function SourcesPage() {
  const navigate = useNavigate()
  const { data, loading, error, banks, dateFrom, dateTo } = useFilters()
  const o = data?.overview

  const goSource = (source: string) =>
    navigate(
      transactionsHref({
        source,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    )

  const sourceNet = useMemo(
    () =>
      (data?.by_bank || []).map((r) => ({
        source: r.name,
        debit: r.debit,
        credit: r.credit,
        net: r.net,
      })),
    [data?.by_bank],
  )

  const months = useMemo(() => {
    const set = new Set((data?.source_monthly || []).map((r) => r.month))
    return [...set].sort()
  }, [data?.source_monthly])

  const sources = useMemo(() => {
    const set = new Set((data?.source_monthly || []).map((r) => r.source))
    return [...set].sort()
  }, [data?.source_monthly])

  const netBySourceMonth = useMemo(() => {
    const map = new Map<string, Record<string, string | number>>()
    for (const m of months) map.set(m, { month: m })
    for (const row of data?.source_monthly || []) {
      const bucket = map.get(row.month)
      if (bucket) bucket[row.source] = row.net
    }
    return [...map.values()]
  }, [data?.source_monthly, months])

  const crossTab = useMemo(() => {
    const cell = new Map<string, { debit: number; credit: number; net: number }>()
    for (const row of data?.source_monthly || []) {
      cell.set(`${row.source}::${row.month}`, {
        debit: row.debit,
        credit: row.credit,
        net: row.net,
      })
    }
    return { cell, months, sources }
  }, [data?.source_monthly, months, sources])

  return (
    <div className="fade-in">
      <PageHeader
        title="Credit vs Debit by Source"
        description="Bank-wise flows with a global source filter that updates every chart on this page."
      />
      <FilterBar showBanks />

      {banks.length ? (
        <p className="mb-3 text-xs text-[var(--muted)]">
          Filtering to: <span className="font-medium text-[var(--text)]">{banks.join(', ')}</span>
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <LoadingBlock />
      ) : o && data ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Sources active" value={String(data.by_bank.length)} />
            <KpiCard label="Total credit" value={formatINR(o.total_credit)} tone="credit" />
            <KpiCard label="Total debit" value={formatINR(o.total_debit)} tone="debit" />
            <KpiCard
              label="Net across sources"
              value={formatINR(o.net)}
              tone={o.net >= 0 ? 'credit' : 'debit'}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Credit vs debit per source" subtitle="Click a bank to open transactions">
              <GroupedSourceBars data={sourceNet} onSourceClick={goSource} />
            </ChartCard>
            <ChartCard title="Source-wise net flow" subtitle="Credit − debit">
              <GroupedSourceBars
                data={sourceNet.map((s) => ({
                  source: s.source,
                  debit: s.net < 0 ? Math.abs(s.net) : 0,
                  credit: s.net >= 0 ? s.net : 0,
                  net: s.net,
                }))}
                onSourceClick={goSource}
              />
            </ChartCard>
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Source → total credit" subtitle="Contribution donut">
              <DonutChart
                data={data.by_bank.map((r) => ({ name: r.name, value: r.credit }))}
                onSliceClick={goSource}
              />
            </ChartCard>
            <ChartCard title="Source → total debit" subtitle="Contribution donut">
              <DonutChart
                data={data.by_bank.map((r) => ({ name: r.name, value: r.debit }))}
                onSliceClick={goSource}
              />
            </ChartCard>
          </div>

          <ChartCard
            className="mb-5"
            title="Multi-line net trend"
            subtitle="One line per bank/source"
          >
            <MultiLineChart data={netBySourceMonth} keys={sources} />
          </ChartCard>

          <section className="panel overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold">Cross-tab · source × month</h3>
              <p className="text-xs text-[var(--muted)]">
                Cells show credit / debit / net
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="sticky left-0 bg-[var(--surface)] px-3 py-2 font-medium">
                      Source
                    </th>
                    {crossTab.months.map((m) => (
                      <th key={m} className="px-3 py-2 font-medium">
                        {formatMonth(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crossTab.sources.map((source) => (
                    <tr key={source} className="border-t border-[var(--border)]">
                      <td className="sticky left-0 bg-[var(--surface)] px-3 py-2 font-medium">
                        {source}
                      </td>
                      {crossTab.months.map((month) => {
                        const cell = crossTab.cell.get(`${source}::${month}`)
                        if (!cell) {
                          return (
                            <td key={month} className="px-3 py-2 text-[var(--muted)]">
                              —
                            </td>
                          )
                        }
                        return (
                          <td key={month} className="px-3 py-2 tabular-nums">
                            <div className="text-[var(--credit)]">+{formatINR(cell.credit)}</div>
                            <div className="text-[var(--debit)]">−{formatINR(cell.debit)}</div>
                            <div
                              className={
                                cell.net >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                              }
                            >
                              {formatINR(cell.net)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
