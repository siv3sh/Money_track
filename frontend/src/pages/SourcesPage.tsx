import { useMemo } from 'react'
import { ArrowLeftRight, Building2, Layers, Scale } from 'lucide-react'
import {
  DonutChart,
  HorizontalRankBars,
  MultiLineChart,
} from '../components/charts/FinanceCharts'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { LoadingBlock } from '../components/ui/EmptyState'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { useFilters } from '../context/FilterContext'
import { useFinanceReport } from '../hooks/useFinanceReport'
import { CHART_COLORS, sourceMonthlyCrossTab, sourceMultiLine } from '../lib/analytics'
import { monthLabel } from '../lib/dates'
import { formatINR } from '../lib/format'
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
import { axisTick, formatTooltipValue, gridStroke, inrAxis, tooltipStyle } from '../components/charts/chartTheme'
import { EmptyState } from '../components/ui/EmptyState'

export function SourcesPage() {
  const { report, transactions, loading, error, reload } = useFinanceReport({ txnLimit: 1000 })
  const { sources } = useFilters()

  const cross = useMemo(() => sourceMonthlyCrossTab(transactions), [transactions])
  const activeSources = sources.length ? sources : cross.sources

  const grouped = useMemo(() => {
    return cross.months.map((month) => {
      let credit = 0
      let debit = 0
      for (const s of activeSources) {
        credit += cross.cells[s]?.[month]?.credit ?? 0
        debit += cross.cells[s]?.[month]?.debit ?? 0
      }
      return { label: monthLabel(month), credit, debit, month }
    })
  }, [cross, activeSources])

  const perSourceNet = useMemo(() => {
    return activeSources
      .map((s) => {
        let credit = 0
        let debit = 0
        for (const m of cross.months) {
          credit += cross.cells[s]?.[m]?.credit ?? 0
          debit += cross.cells[s]?.[m]?.debit ?? 0
        }
        return { name: s, credit, debit, net: credit - debit, value: credit - debit }
      })
      .sort((a, b) => b.net - a.net)
  }, [activeSources, cross])

  const creditShare = perSourceNet
    .filter((r) => r.credit > 0)
    .map((r) => ({ name: r.name, value: r.credit }))
  const debitShare = perSourceNet
    .filter((r) => r.debit > 0)
    .map((r) => ({ name: r.name, value: r.debit }))

  const multiLine = sourceMultiLine(
    {
      ...cross,
      sources: activeSources,
    },
    'net',
  )

  const stackedBySource = useMemo(() => {
    return cross.months.map((month) => {
      const row: Record<string, string | number> = {
        month,
        label: monthLabel(month),
      }
      for (const s of activeSources) {
        row[`${s} credit`] = cross.cells[s]?.[month]?.credit ?? 0
        row[`${s} debit`] = cross.cells[s]?.[month]?.debit ?? 0
      }
      return row
    })
  }, [cross, activeSources])

  const totalCredit = perSourceNet.reduce((s, r) => s + r.credit, 0)
  const totalDebit = perSourceNet.reduce((s, r) => s + r.debit, 0)

  return (
    <div>
      <PageHeader
        title="Credit vs debit by source"
        description="Compare every bank/account — toggle sources above to filter every chart on this page."
      />
      <FilterBar
        availableSources={cross.sources.length ? cross.sources : (report?.by_bank || []).map((r) => r.name)}
        availableCategories={report?.categories || []}
        onRefresh={reload}
        loading={loading}
        showCategoryFilter={false}
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/35 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Sources active"
              value={String(activeSources.length)}
              icon={<Building2 size={18} />}
            />
            <KpiCard
              label="Total credit"
              value={formatINR(totalCredit)}
              tone="credit"
              icon={<Layers size={18} />}
            />
            <KpiCard
              label="Total debit"
              value={formatINR(totalDebit)}
              tone="debit"
              icon={<ArrowLeftRight size={18} />}
            />
            <KpiCard
              label="Net across sources"
              value={formatINR(totalCredit - totalDebit)}
              tone={totalCredit - totalDebit >= 0 ? 'credit' : 'debit'}
              icon={<Scale size={18} />}
            />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Credit vs debit by month"
              subtitle="Aggregated for selected sources"
              className="xl:col-span-2"
            >
              <div className="h-full min-h-[280px]">
                {grouped.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={grouped} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={axisTick}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={inrAxis}
                        width={52}
                      />
                      <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="credit" name="Credit" stackId="a" fill="var(--chart-credit)" />
                      <Bar
                        dataKey="debit"
                        name="Debit"
                        stackId="b"
                        fill="var(--chart-debit)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
            <ChartCard title="Source-wise net flow" subtitle="Credit − debit per bank">
              <HorizontalRankBars
                data={perSourceNet.map((r) => ({ name: r.name, value: r.net }))}
                color="var(--chart-1)"
              />
            </ChartCard>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Contribution to credit" subtitle="Share of inflow by source">
              <DonutChart data={creditShare} colors={CHART_COLORS} />
            </ChartCard>
            <ChartCard title="Contribution to debit" subtitle="Share of outflow by source">
              <DonutChart data={debitShare} colors={[...CHART_COLORS].reverse()} />
            </ChartCard>
          </div>

          <div className="mb-4">
            <ChartCard
              title="Multi-line net trend"
              subtitle="One line per selected source"
              tall
            >
              <MultiLineChart data={multiLine} series={activeSources} />
            </ChartCard>
          </div>

          {/* Per-source stacked bars for credit/debit when few sources */}
          {activeSources.length > 0 && activeSources.length <= 4 ? (
            <ChartCard
              title="Per-source credit & debit"
              subtitle="Grouped by month for selected sources"
              className="mb-4"
            >
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackedBySource} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={axisTick}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={inrAxis}
                      width={52}
                    />
                    <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
                    <Legend />
                    {activeSources.flatMap((s, i) => [
                      <Bar
                        key={`${s}-c`}
                        dataKey={`${s} credit`}
                        name={`${s} credit`}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        stackId={`${s}`}
                      />,
                      <Bar
                        key={`${s}-d`}
                        dataKey={`${s} debit`}
                        name={`${s} debit`}
                        fill="var(--chart-debit)"
                        stackId={`${s}-d`}
                        fillOpacity={0.7}
                      />,
                    ])}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          ) : null}

          <section className="panel overflow-hidden fade-up">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold">Cross-tab: source × month</h3>
              <p className="text-xs text-[var(--muted)]">
                Cells show credit / debit / net for each bank and month
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="sticky left-0 bg-[var(--surface)] px-3 py-2 font-medium">
                      Source
                    </th>
                    {cross.months.map((m) => (
                      <th key={m} className="px-3 py-2 font-medium whitespace-nowrap">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Total net</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSources.map((s) => {
                    let totalNet = 0
                    return (
                      <tr key={s} className="border-t border-[var(--border)]">
                        <td className="sticky left-0 bg-[var(--surface)] px-3 py-2 font-semibold">
                          {s}
                        </td>
                        {cross.months.map((m) => {
                          const cell = cross.cells[s]?.[m] || {
                            credit: 0,
                            debit: 0,
                            net: 0,
                          }
                          totalNet += cell.net
                          return (
                            <td key={m} className="px-3 py-2 whitespace-nowrap tabular-nums">
                              <div className="text-[var(--credit)]">{formatINR(cell.credit)}</div>
                              <div className="text-[var(--debit)]">{formatINR(cell.debit)}</div>
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
                        <td
                          className={`px-3 py-2 font-semibold tabular-nums ${
                            totalNet >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                          }`}
                        >
                          {formatINR(totalNet)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
