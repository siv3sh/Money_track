import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { PortfolioEditor } from '../components/PortfolioEditor'
import { DonutChart, HorizontalBars, NetTrendLine, StackedAreaChart } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

export function InvestmentsPage() {
  const { data, loading, error, refresh } = useFilters()
  const inv = data?.investments
  const o = data?.overview

  const income = o?.total_credit || 0
  const ratioSeries =
    data?.monthly.map((m) => ({
      month: m.month,
      ratio: m.credit > 0 ? Math.round(((inv?.monthly.find((i) => i.month === m.month)?.invested || 0) / m.credit) * 1000) / 10 : 0,
    })) || []

  const assetKeys = (inv?.asset_allocation || []).map((a) => a.name)

  // Build stacked area from monthly holdings approximated by asset class share of invested that month
  const growthRows =
    inv?.monthly.map((m) => {
      const row: Record<string, string | number> = { month: m.month }
      const total = inv.total_invested || 1
      for (const a of inv.asset_allocation) {
        row[a.name] = Math.round((m.cumulative * a.value) / total)
      }
      return row
    }) || []

  return (
    <div className="fade-in">
      <PageHeader
        title="Investments"
        description="SIP flows from transactions plus market values you sync from broker apps."
      />
      <FilterBar />
      <PortfolioEditor onSaved={refresh} />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !inv ? (
        <LoadingBlock />
      ) : inv && o ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total invested" value={formatINR(inv.total_invested)} tone="credit" />
            <KpiCard
              label="Current value"
              value={formatINR(inv.total_current)}
              hint={inv.note}
            />
            <KpiCard
              label="Overall P&L"
              value={formatINR(inv.pnl)}
              tone={inv.pnl >= 0 ? 'credit' : 'debit'}
              hint="Needs live prices"
            />
            <KpiCard
              label="Invest / income"
              value={`${o.investment_to_income}%`}
              hint={income ? `of ${formatINR(income)} credited` : undefined}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Portfolio allocation" subtitle="By asset class (cost basis)">
              <DonutChart
                data={inv.asset_allocation.map((a) => ({
                  name: a.name,
                  value: a.value,
                }))}
              />
            </ChartCard>
            <ChartCard title="SIP / instrument tracker" subtitle="Invested amount per vehicle">
              <HorizontalBars
                data={inv.holdings.map((h) => ({
                  name: h.name.length > 24 ? `${h.name.slice(0, 22)}…` : h.name,
                  value: h.invested,
                }))}
                color="var(--accent)"
              />
            </ChartCard>
          </div>

          <section className="panel mb-5 overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold">Holdings table</h3>
              <p className="text-xs text-[var(--muted)]">
                Direct equity / gold / brokerage vehicles detected from merchants
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-2 font-medium">Instrument</th>
                    <th className="px-4 py-2 font-medium">Class</th>
                    <th className="px-4 py-2 text-right font-medium">Invested</th>
                    <th className="px-4 py-2 text-right font-medium">Current</th>
                    <th className="px-4 py-2 text-right font-medium">P&L</th>
                    <th className="px-4 py-2 text-right font-medium">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.holdings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">
                        No investment transactions categorized yet
                      </td>
                    </tr>
                  ) : (
                    inv.holdings.map((h) => (
                      <tr key={h.name} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2.5 font-medium">{h.name}</td>
                        <td className="px-4 py-2.5 text-[var(--muted)]">{h.asset_class}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatINR(h.invested)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatINR(h.current_value)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                            h.pnl >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                          }`}
                        >
                          {formatINR(h.pnl)} ({h.pnl_pct.toFixed(1)}%)
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--muted)]">{h.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
              XIRR / CAGR needs purchase dates + current NAV — shown as 0% until market prices are
              linked. Digital Gold SIPs appear as recurring NEFT debits.
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Investment-to-income ratio" subtitle="% of monthly credit invested">
              <NetTrendLine data={ratioSeries} dataKey="ratio" name="Invest / income %" />
            </ChartCard>
            <ChartCard title="Asset class growth" subtitle="Cumulative invested (approx split)">
              <StackedAreaChart data={growthRows} keys={assetKeys} />
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
