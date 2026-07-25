import { useMemo } from 'react'
import { ChartLine, Percent, PiggyBank, TrendingUp } from 'lucide-react'
import {
  DonutChart,
  DualBarCompare,
  NetTrendLine,
  StackedAreaChart,
} from '../components/charts/FinanceCharts'
import { FilterBar } from '../components/layout/FilterBar'
import { ChartCard } from '../components/ui/ChartCard'
import { KpiCard } from '../components/ui/KpiCard'
import { PageHeader } from '../components/ui/PageHeader'
import { useFinanceReport } from '../hooks/useFinanceReport'
import { buildDemoPortfolio } from '../lib/investments'
import { formatINR } from '../lib/format'

export function InvestmentsPage() {
  const { summary, report, loading, error, reload } = useFinanceReport({ txnLimit: 50 })
  const portfolio = useMemo(
    () => buildDemoPortfolio(summary?.this_month_credit || report?.overview.total_credit || 120000),
    [summary?.this_month_credit, report?.overview.total_credit],
  )

  const pnl = portfolio.totalCurrent - portfolio.totalInvested
  const pnlPct =
    portfolio.totalInvested > 0 ? (pnl / portfolio.totalInvested) * 100 : 0

  const sipBars = portfolio.sips.map((s) => ({
    label: s.name.split(' ').slice(0, 2).join(' '),
    invested: s.invested,
    current: s.current,
  }))

  return (
    <div>
      <PageHeader
        title="Investments"
        description="Portfolio allocation, SIP tracker, equity P&L, and investment-to-income ratio. Demo holdings until a broker sync is connected."
      />
      <FilterBar
        availableSources={(report?.by_bank || []).map((r) => r.name)}
        onRefresh={reload}
        loading={loading}
        showCategoryFilter={false}
        showSourceFilter={false}
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/35 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Portfolio value"
          value={formatINR(portfolio.totalCurrent)}
          tone="credit"
          delta={pnlPct}
          icon={<PiggyBank size={18} />}
          hint={`Invested ${formatINR(portfolio.totalInvested)}`}
        />
        <KpiCard
          label="Unrealized P&L"
          value={formatINR(pnl)}
          tone={pnl >= 0 ? 'credit' : 'debit'}
          icon={<TrendingUp size={18} />}
        />
        <KpiCard
          label="Overall XIRR"
          value={`${portfolio.overallXirr.toFixed(1)}%`}
          tone="credit"
          icon={<Percent size={18} />}
        />
        <KpiCard
          label="Overall CAGR"
          value={`${portfolio.overallCagr.toFixed(1)}%`}
          tone="credit"
          icon={<ChartLine size={18} />}
        />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <ChartCard title="Allocation by asset class" subtitle="Current market value mix">
          <DonutChart
            data={portfolio.allocation.map((a) => ({ name: a.name, value: a.value }))}
          />
        </ChartCard>
        <ChartCard
          title="SIP tracker"
          subtitle="Invested vs current value"
          className="xl:col-span-2"
        >
          <DualBarCompare data={sipBars} />
        </ChartCard>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Investment-to-income ratio" subtitle="% of income invested each month">
          <NetTrendLine
            data={portfolio.investmentToIncome}
            dataKey="ratio"
            name="Invested / income %"
            color="var(--chart-4)"
          />
        </ChartCard>
        <ChartCard title="Asset class growth" subtitle="Stacked value over time">
          <StackedAreaChart
            data={portfolio.growth}
            series={['Equity', 'Debt', 'Gold', 'International', 'Cash']}
          />
        </ChartCard>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <section className="panel overflow-hidden fade-up">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">SIP performance</h3>
            <p className="text-xs text-[var(--muted)]">XIRR per instrument</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Fund</th>
                  <th className="px-4 py-2 font-medium">Class</th>
                  <th className="px-4 py-2 text-right font-medium">Invested</th>
                  <th className="px-4 py-2 text-right font-medium">Current</th>
                  <th className="px-4 py-2 text-right font-medium">XIRR</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.sips.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5 text-[var(--muted)]">{s.assetClass}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(s.invested)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--credit)]">
                      {formatINR(s.current)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--credit)]">
                      {s.xirr.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel overflow-hidden fade-up">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold">Direct equity holdings</h3>
            <p className="text-xs text-[var(--muted)]">P&L color-coded green / red</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Stock</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Avg</th>
                  <th className="px-4 py-2 text-right font-medium">LTP</th>
                  <th className="px-4 py-2 text-right font-medium">P&L</th>
                  <th className="px-4 py-2 text-right font-medium">CAGR</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.equities.map((e) => (
                  <tr key={e.symbol} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{e.symbol}</div>
                      <div className="text-xs text-[var(--muted)]">{e.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{e.qty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(e.avgPrice)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(e.ltp)}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                        e.pnl >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                      }`}
                    >
                      {formatINR(e.pnl)}
                      <div className="text-xs font-medium">
                        {e.pnlPct >= 0 ? '+' : ''}
                        {e.pnlPct.toFixed(1)}%
                      </div>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        e.cagr >= 0 ? 'text-[var(--credit)]' : 'text-[var(--debit)]'
                      }`}
                    >
                      {e.cagr.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
