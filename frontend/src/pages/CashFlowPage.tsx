import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  CashflowBars,
  DonutChart,
  HorizontalBars,
  NetTrendLine,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

export function CashFlowPage() {
  const { data, loading, error } = useFilters()
  const o = data?.overview
  const mom = data?.mom

  return (
    <div className="fade-in">
      <PageHeader
        title="Cash Flow"
        description="Monthly credited vs debited, savings trend, and income sources."
      />
      <FilterBar />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <LoadingBlock />
      ) : o ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total credited"
              value={formatINR(o.total_credit)}
              change={mom?.credit_pct}
              tone="credit"
              hint={`${o.credit_count} credits`}
            />
            <KpiCard
              label="Total debited"
              value={formatINR(o.total_debit)}
              change={mom?.debit_pct}
              tone="debit"
              hint={`${o.debit_count} debits`}
            />
            <KpiCard
              label="Net savings"
              value={formatINR(o.net)}
              change={mom?.net_pct}
              tone={o.net >= 0 ? 'credit' : 'debit'}
              hint="Credit − debit"
            />
            <KpiCard
              label="Avg daily spend"
              value={formatINR(o.avg_daily_debit)}
              hint={`${o.active_days} active days`}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Monthly credited vs debited" subtitle="Grouped bars by month">
              <CashflowBars data={data.monthly} />
            </ChartCard>
            <ChartCard title="Net savings trend" subtitle="Running credit − debit">
              <NetTrendLine
                data={data.monthly.map((m) => ({
                  month: m.month,
                  running_net: m.running_net ?? 0,
                }))}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Income source breakdown" subtitle="Where credits came from">
              <DonutChart
                data={data.income_sources.map((r) => ({
                  name: r.name,
                  value: r.amount,
                }))}
              />
            </ChartCard>
            <ChartCard title="Running balances" subtitle="Latest known account balances">
              <HorizontalBars
                data={data.accounts.map((a) => ({
                  name: `${a.bank} ••${a.account_last4}`,
                  value: a.balance,
                }))}
                color="var(--credit)"
              />
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
