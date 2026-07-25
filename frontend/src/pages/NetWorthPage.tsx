import { Landmark, PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  AssetsLiabilitiesBars,
  DonutChart,
  NetTrendLine,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { formatINR } from '../lib/format'

export function NetWorthPage() {
  const { data, loading, error } = useFilters()
  const o = data?.overview
  const mom = data?.mom

  return (
    <div className="fade-in">
      <PageHeader
        title="Net Worth"
        description="Estimated wealth from liquid account balances plus investment outflows tracked so far."
      />
      <FilterBar />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <LoadingBlock label="Loading net worth…" />
      ) : o ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Estimated net worth"
              value={formatINR(o.net_worth_estimate)}
              change={mom?.net_pct}
              hint="Liquid + invested cost"
              icon={<Wallet size={16} />}
            />
            <KpiCard
              label="This month's savings"
              value={formatINR(mom?.current_net ?? o.net)}
              change={mom?.savings_pct}
              tone={(mom?.current_net ?? o.net) >= 0 ? 'credit' : 'debit'}
              hint="Credit − debit"
              icon={<PiggyBank size={16} />}
            />
            <KpiCard
              label="Total invested"
              value={formatINR(o.total_invested)}
              tone="credit"
              hint={`${o.investment_to_income}% of income`}
              icon={<TrendingUp size={16} />}
            />
            <KpiCard
              label="Total debt"
              value={formatINR(0)}
              hint="No debt accounts linked yet"
              tone="neutral"
              icon={<TrendingDown size={16} />}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Net worth trend"
              subtitle="Cumulative credit − debit as a cash-position proxy"
              className="xl:col-span-2"
            >
              <NetTrendLine
                data={data.monthly.map((m) => ({
                  month: m.month,
                  running_net: m.running_net ?? m.net,
                }))}
                name="Cash position"
              />
            </ChartCard>
            <ChartCard title="Assets vs liabilities" subtitle="Debt tracking coming soon">
              <AssetsLiabilitiesBars
                assets={o.liquid_total + o.total_invested}
                liabilities={0}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Liquid vs invested" subtitle="Split of estimated assets">
              <DonutChart
                data={[
                  { name: 'Liquid', value: o.liquid_total },
                  { name: 'Invested', value: o.total_invested },
                ]}
              />
            </ChartCard>
            <ChartCard
              title="Account balances"
              subtitle="Latest SMS balance snapshots"
              action={<Landmark size={14} className="text-[var(--muted)]" />}
            >
              {data.accounts.length === 0 ? (
                <p className="py-16 text-center text-sm text-[var(--muted)]">
                  No balance fields found in SMS yet
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        <th className="px-2 py-2 font-medium">Account</th>
                        <th className="px-2 py-2 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.accounts.map((a) => (
                        <tr key={`${a.bank}-${a.account_last4}`} className="border-t border-[var(--border)]">
                          <td className="px-2 py-2.5">
                            <p className="font-medium">{a.bank}</p>
                            <p className="text-xs text-[var(--muted)]">••{a.account_last4}</p>
                          </td>
                          <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-[var(--credit)]">
                            {formatINR(a.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--border)]">
                        <td className="px-2 py-2.5 text-xs font-medium text-[var(--muted)]">
                          Liquid total
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                          {formatINR(o.liquid_total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
