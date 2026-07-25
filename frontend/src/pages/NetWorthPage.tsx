import { Landmark, PiggyBank, TrendingUp, Wallet, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { LiabilitiesEditor } from '../components/LiabilitiesEditor'
import { PeriodCompare } from '../components/PeriodCompare'
import {
  AssetsLiabilitiesBars,
  DonutChart,
  NetTrendLine,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { exportDataUrl } from '../api'
import { formatDate, formatINR } from '../lib/format'
import { transactionsHref } from '../lib/transactionsLink'

export function NetWorthPage() {
  const navigate = useNavigate()
  const { data, loading, error, refresh, dateFrom, dateTo } = useFilters()
  const o = data?.overview
  const mom = data?.mom
  const snap = data?.indmoney_snapshot
  const freshness = data?.freshness
  const liabilitiesTotal = o?.liabilities_total ?? 0
  const liquidHint =
    o?.liquid_source === 'indmoney'
      ? 'From INDmoney savings'
      : 'From SMS balances (incomplete)'

  return (
    <div className="fade-in">
      <PageHeader
        title="Net Worth"
        description="Assets from INDmoney / SMS plus investments, minus liabilities you track here."
        actions={
          <div className="flex gap-2">
            <a className="btn" href={exportDataUrl('json')} download>
              <Download size={14} />
              Export JSON
            </a>
            <a className="btn" href={exportDataUrl('csv')} download>
              <Download size={14} />
              Export CSV
            </a>
          </div>
        }
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
              hint={
                liabilitiesTotal
                  ? `Assets − liabilities (${formatINR(liabilitiesTotal)})`
                  : snap
                    ? 'INDmoney snapshot'
                    : 'Liquid + invested'
              }
              icon={<Wallet size={16} />}
            />
            <KpiCard
              label="Liquid cash"
              value={formatINR(o.liquid_total)}
              tone="credit"
              hint={liquidHint}
              icon={<Landmark size={16} />}
            />
            <KpiCard
              label="Total invested"
              value={formatINR(o.total_invested)}
              tone="credit"
              hint={`${o.investment_to_income}% of income`}
              icon={<TrendingUp size={16} />}
            />
            <KpiCard
              label="Total liabilities"
              value={formatINR(liabilitiesTotal)}
              tone={liabilitiesTotal > 0 ? 'debit' : 'neutral'}
              hint={liabilitiesTotal ? 'Tracked below' : 'Add credit cards / loans below'}
              icon={<PiggyBank size={16} />}
            />
          </div>

          {data ? (
            <PeriodCompare
              monthly={data.monthly}
              byCategory={data.by_category}
              className="mb-5"
            />
          ) : null}

          <div className="mb-5 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Net worth trend"
              subtitle="Cumulative credit − debit as a cash-position proxy · click a month"
              className="xl:col-span-2"
            >
              <NetTrendLine
                data={data.monthly.map((m) => ({
                  month: m.month,
                  running_net: m.running_net ?? m.net,
                }))}
                name="Cash position"
                onMonthClick={(month) => navigate(transactionsHref({ month }))}
              />
            </ChartCard>
            <ChartCard
              title="Assets vs liabilities"
              subtitle={
                liabilitiesTotal
                  ? 'Manual liabilities included'
                  : 'No liabilities tracked yet — chart uses ₹0 debt'
              }
            >
              <AssetsLiabilitiesBars
                assets={o.assets_total ?? o.liquid_total + o.total_invested}
                liabilities={liabilitiesTotal}
              />
            </ChartCard>
          </div>

          <LiabilitiesEditor onSaved={refresh} />

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
              title="SMS account balances"
              subtitle="Last balance from SMS — not your full cash picture"
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
                            <p className="text-xs text-[var(--muted)]">
                              ••{a.account_last4}
                              {a.incomplete ? ' · incomplete' : ''}
                            </p>
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
                          SMS snapshot total
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                          {formatINR(
                            o.sms_liquid_total ??
                              data.accounts.reduce((s, a) => s + a.balance, 0),
                          )}
                        </td>
                      </tr>
                      {o.liquid_source === 'indmoney' ? (
                        <tr>
                          <td className="px-2 py-1.5 text-xs font-medium text-[var(--muted)]">
                            Trusted liquid (INDmoney)
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-[var(--credit)]">
                            {formatINR(o.liquid_total)}
                          </td>
                        </tr>
                      ) : null}
                    </tfoot>
                  </table>
                </div>
              )}
              {freshness?.last_sms_at ? (
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  SMS parsing last ran: {formatDate(freshness.last_sms_at)}
                </p>
              ) : null}
            </ChartCard>
          </div>

          <p className="mt-3 text-xs text-[var(--muted)]">
            {[
              freshness?.last_indmoney_at &&
                `INDmoney synced ${formatDate(freshness.last_indmoney_at)}`,
              freshness?.last_portfolio_at &&
                `Portfolio updated ${formatDate(freshness.last_portfolio_at)}`,
              freshness?.last_statement_at &&
                `Last statement activity ${formatDate(freshness.last_statement_at)}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sync INDmoney or import statements to refresh wealth data.'}
            {' · '}
            <button
              type="button"
              className="text-[var(--accent)] hover:underline"
              onClick={() =>
                navigate(
                  transactionsHref({
                    date_from: dateFrom || undefined,
                    date_to: dateTo || undefined,
                  }),
                )
              }
            >
              View transactions
            </button>
          </p>
        </>
      ) : null}
    </div>
  )
}
