import { Link, useNavigate } from 'react-router-dom'
import {
  Download,
  FileSpreadsheet,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import { LiabilitiesEditor } from '../components/LiabilitiesEditor'
import { PortfolioEditor } from '../components/PortfolioEditor'
import {
  AssetsLiabilitiesBars,
  DonutChart,
  HorizontalBars,
  NetTrendLine,
  StackedAreaChart,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { LedgerAmount } from '../components/LedgerAmount'
import { AdvisorVoiceBanner } from '../components/AdvisorVoiceBanner'
import { exportDataUrl } from '../api'
import { formatDate, formatINR } from '../lib/format'
import { transactionsHref } from '../lib/transactionsLink'

/** Merged net-worth + investments: wealth snapshot, portfolio, liabilities. */
export function WealthPage() {
  const navigate = useNavigate()
  const { data, loading, error, refresh, dateFrom, dateTo } = useFilters()
  const o = data?.overview
  const mom = data?.mom
  const inv = data?.investments
  const snap = data?.indmoney_snapshot
  const freshness = data?.freshness
  const liabilitiesTotal = o?.liabilities_total ?? 0
  const creditCardLiabilities = (data?.liabilities || []).filter(
    (l) => (l.source || '') === 'credit_cards',
  )
  const liquidHint =
    o?.liquid_source === 'indmoney'
      ? 'From INDmoney savings'
      : 'From SMS balances (incomplete)'

  const income = o?.total_credit || 0
  const ratioSeries =
    data?.monthly.map((m) => ({
      month: m.month,
      ratio:
        m.credit > 0
          ? Math.round(
              (((inv?.monthly.find((i) => i.month === m.month)?.invested || 0) / m.credit) *
                1000) /
                10,
            )
          : 0,
    })) || []

  const assetKeys = (inv?.asset_allocation || []).map((a) => a.name)
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
        title="Wealth"
        description="Net worth, portfolio, and liabilities — liquid cash plus investments minus what you owe."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/investments/indmoney" className="btn">
              <FileSpreadsheet size={14} />
              Import INDmoney
            </Link>
            <a className="btn" href={exportDataUrl('json')} download>
              <Download size={14} />
              JSON
            </a>
            <a className="btn" href={exportDataUrl('csv')} download>
              <Download size={14} />
              CSV
            </a>
          </div>
        }
      />
      <FilterBar />
      {data?.advisor ? <AdvisorVoiceBanner advisor={data.advisor} /> : null}

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {loading && !o ? (
        <LoadingBlock label="Loading wealth…" />
      ) : o ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Net worth"
              value={formatINR(o.net_worth_estimate)}
              amount={o.net_worth_estimate}
              rail="wealth"
              animate
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
              amount={o.liquid_total}
              tone="credit"
              animate
              hint={liquidHint}
              icon={<Landmark size={16} />}
            />
            <KpiCard
              label="Portfolio value"
              value={formatINR(inv?.total_current ?? o.total_invested)}
              amount={inv?.total_current ?? o.total_invested}
              rail="wealth"
              animate
              hint={
                inv
                  ? `Cost ${formatINR(inv.total_invested)}`
                  : `${o.investment_to_income}% of income`
              }
              icon={<TrendingUp size={16} />}
            />
            <KpiCard
              label="Overall P&L"
              value={formatINR(inv?.pnl ?? 0)}
              amount={inv?.pnl ?? 0}
              rail={(inv?.pnl ?? 0) >= 0 ? 'wealth' : 'debit'}
              animate
              hint={inv?.note || 'Needs live prices for accuracy'}
            />
            <KpiCard
              label="Liabilities"
              value={formatINR(liabilitiesTotal)}
              amount={liabilitiesTotal}
              tone={liabilitiesTotal > 0 ? 'debit' : 'neutral'}
              animate={liabilitiesTotal > 0}
              hint={
                liabilitiesTotal
                  ? creditCardLiabilities.length
                    ? `${creditCardLiabilities.length} card(s) + manual`
                    : 'Tracked below'
                  : 'Add loans / cards below'
              }
              icon={<PiggyBank size={16} />}
            />
          </div>

          {(freshness?.last_portfolio_at || freshness?.last_indmoney_at) && (
            <p className="mb-4 text-xs text-[var(--muted)]">
              Last synced:{' '}
              {freshness.last_portfolio_at
                ? formatDate(freshness.last_portfolio_at)
                : freshness.last_indmoney_at
                  ? formatDate(freshness.last_indmoney_at)
                  : '—'}
              {freshness.last_indmoney_at ? ' · INDmoney / CSV' : ' · portfolio editor'}
              {' · '}
              Invest / income {o.investment_to_income}%
              {income ? ` of ${formatINR(income)} credited` : ''}
            </p>
          )}

          <div className="mb-5 grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Cash-position trend"
              subtitle="Cumulative credit − debit · click a month"
              className="xl:col-span-2"
            >
              {data?.monthly?.length ? (
                <NetTrendLine
                  data={data.monthly.map((m) => ({
                    month: m.month,
                    running_net: m.running_net ?? m.net,
                  }))}
                  name="Cash position"
                  onMonthClick={(month) => navigate(transactionsHref({ month }))}
                />
              ) : (
                <p className="py-10 text-center text-sm text-[var(--muted)]">No monthly data yet</p>
              )}
            </ChartCard>
            <ChartCard
              title="Assets vs liabilities"
              subtitle={
                liabilitiesTotal
                  ? creditCardLiabilities.length
                    ? 'Includes SMS credit cards + manual'
                    : 'Manual liabilities included'
                  : 'No liabilities tracked yet'
              }
            >
              <AssetsLiabilitiesBars
                assets={o.assets_total ?? o.liquid_total + o.total_invested}
                liabilities={liabilitiesTotal}
              />
            </ChartCard>
          </div>

          {inv ? (
            <>
              {data?.smart?.drift &&
              (data.smart.drift.drifts.length > 0 || data.smart.drift.current.length > 0) ? (
                <ChartCard
                  title="Allocation drift"
                  subtitle={`Current vs ${data.smart.drift.reference_source} (±${data.smart.drift.threshold_pp} pp)`}
                  className="mb-5"
                >
                  {data.smart.drift.drifts.length === 0 ? (
                    <p className="text-sm text-[var(--credit)]">
                      Allocation within your drift threshold
                    </p>
                  ) : (
                    <ul className="mb-3 space-y-2">
                      {data.smart.drift.drifts.map((d) => (
                        <li
                          key={d.asset_class}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                        >
                          <strong>{d.asset_class}</strong> is {d.current_pct}%,{' '}
                          {d.direction === 'up' ? 'up' : 'down'} from your typical{' '}
                          {d.reference_pct}% — consider rebalancing
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid max-w-lg grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="mb-1 text-[var(--muted)]">Current %</p>
                      {data.smart.drift.current.map((c) => (
                        <div key={c.name} className="flex justify-between py-0.5">
                          <span className="truncate">{c.name}</span>
                          <span className="tabular-nums">{c.pct}%</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="mb-1 text-[var(--muted)]">Baseline %</p>
                      {(data.smart.drift.reference.length
                        ? data.smart.drift.reference
                        : data.smart.drift.current
                      ).map((c) => (
                        <div key={c.name} className="flex justify-between py-0.5">
                          <span className="truncate">{c.name}</span>
                          <span className="tabular-nums">{c.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              ) : null}

              <div className="mb-5 grid gap-4 xl:grid-cols-3">
                <ChartCard title="Liquid vs invested" subtitle="Split of estimated assets">
                  <DonutChart
                    data={[
                      { name: 'Liquid', value: o.liquid_total },
                      { name: 'Invested', value: o.total_invested },
                    ]}
                  />
                </ChartCard>
                <ChartCard title="Portfolio allocation" subtitle="By asset class (cost basis)">
                  <DonutChart
                    data={inv.asset_allocation.map((a) => ({
                      name: a.name,
                      value: a.value,
                    }))}
                  />
                </ChartCard>
                <ChartCard title="By instrument" subtitle="Invested amount per vehicle">
                  <HorizontalBars
                    data={inv.holdings.map((h) => ({
                      name: h.name.length > 22 ? `${h.name.slice(0, 20)}…` : h.name,
                      value: h.invested,
                    }))}
                    color="var(--wealth)"
                  />
                </ChartCard>
              </div>

              <section className="elev-sheet mb-5 overflow-hidden">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-semibold">Holdings</h3>
                  <p className="text-xs text-[var(--muted)]">
                    From investment transactions + portfolio sync
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
                            No investment holdings yet — import INDmoney or categorize SIPs
                          </td>
                        </tr>
                      ) : (
                        inv.holdings.map((h) => (
                          <tr key={h.name} className="border-t border-[var(--border)]">
                            <td className="px-4 py-2.5 font-medium">{h.name}</td>
                            <td className="px-4 py-2.5 text-[var(--muted)]">{h.asset_class}</td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-[var(--wealth)]">
                              {formatINR(h.invested)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-[var(--wealth)]">
                              {formatINR(h.current_value)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                                h.pnl >= 0 ? 'text-[var(--wealth)]' : 'text-[var(--debit)]'
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
              </section>

              <div className="mb-5 grid gap-4 xl:grid-cols-2">
                <ChartCard title="Invest / income %" subtitle="% of monthly credit put into investments">
                  <NetTrendLine data={ratioSeries} dataKey="ratio" name="Invest / income %" />
                </ChartCard>
                <ChartCard title="Asset class growth" subtitle="Cumulative invested (approx split)">
                  <StackedAreaChart data={growthRows} keys={assetKeys} />
                </ChartCard>
              </div>
            </>
          ) : null}

          {creditCardLiabilities.length > 0 ? (
            <section className="elev-sheet mb-5 overflow-hidden">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h3 className="text-sm font-semibold">Credit cards</h3>
                <p className="text-xs text-[var(--muted)]">
                  Statement outstanding + due date from SMS · counted in liabilities
                </p>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {creditCardLiabilities.map((card) => {
                  const due = card.due_date
                    ? formatDate(
                        card.due_date.includes('T')
                          ? card.due_date
                          : `${card.due_date}T00:00:00`,
                      )
                    : null
                  return (
                    <div
                      key={card.id}
                      className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--canvas)]/50 px-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{card.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {due ? `Due ${due}` : 'Due date unknown'}
                          {card.available_limit != null
                            ? ` · Avl ${formatINR(card.available_limit)}`
                            : ''}
                        </p>
                      </div>
                      <LedgerAmount
                        amount={card.outstanding}
                        rail="debit"
                        size="md"
                        animate
                        className="py-1"
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <div>
              <PortfolioEditor onSaved={refresh} />
            </div>
            <div>
              <LiabilitiesEditor onSaved={refresh} />
            </div>
          </div>

          <ChartCard
            title="SMS account balances"
            subtitle="Last balance from SMS — not your full cash picture"
            className="mb-5"
            action={<Landmark size={14} className="text-[var(--muted)]" />}
          >
            {!data?.accounts?.length ? (
              <p className="py-12 text-center text-sm text-[var(--muted)]">
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
                      <tr
                        key={`${a.bank}-${a.account_last4}`}
                        className="border-t border-[var(--border)]"
                      >
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
          </ChartCard>

          <p className="text-xs text-[var(--muted)]">
            {[
              freshness?.last_indmoney_at &&
                `INDmoney synced ${formatDate(freshness.last_indmoney_at)}`,
              freshness?.last_portfolio_at &&
                `Portfolio updated ${formatDate(freshness.last_portfolio_at)}`,
              freshness?.last_statement_at &&
                `Last statement activity ${formatDate(freshness.last_statement_at)}`,
              freshness?.last_sms_at && `SMS ${formatDate(freshness.last_sms_at)}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sync INDmoney or import statements to refresh wealth data.'}
            {' · '}
            <button
              type="button"
              className="text-[var(--sapphire)] hover:underline"
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
