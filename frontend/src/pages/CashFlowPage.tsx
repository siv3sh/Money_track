import { useNavigate } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { FilterBar } from '../components/FilterBar'
import {
  CashflowBars,
  DonutChart,
  HorizontalBars,
  NetTrendLine,
} from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { AdvisorVoiceBanner } from '../components/AdvisorVoiceBanner'
import { PeriodCompare } from '../components/PeriodCompare'
import { formatINR } from '../lib/format'
import { resolveSalarySourceLabel } from '../lib/salarySource'
import { transactionsHref } from '../lib/transactionsLink'

export function CashFlowPage() {
  const navigate = useNavigate()
  const { data, loading, error, dateFrom, dateTo } = useFilters()
  const o = data?.overview
  const mom = data?.mom

  const goMonth = (month: string) => navigate(transactionsHref({ month }))

  const salarySource = resolveSalarySourceLabel(data)

  return (
    <div className="fade-in">
      <PageHeader
        title="Cash Flow"
        description="Monthly credited vs debited, savings trend, and income sources. Click a month to open its transactions."
      />
      <FilterBar />
      {data?.advisor ? <AdvisorVoiceBanner advisor={data.advisor} /> : null}

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
            <KpiCard
              label="Salary received"
              value={formatINR(o.salary_total ?? 0)}
              tone="credit"
              hint={
                o.salary_total
                  ? `${o.salary_count} credits · other income ${formatINR(o.other_income_total ?? 0)}`
                  : 'No salary credits detected'
              }
              to={transactionsHref({
                ...(salarySource ? { q: salarySource } : {}),
                type: 'credit',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            <KpiCard
              label="Total credited"
              value={formatINR(o.total_credit)}
              change={mom?.credit_pct}
              tone="credit"
              hint={`${o.credit_count} credits`}
              to={transactionsHref({
                type: 'credit',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            <KpiCard
              label="Total debited"
              value={formatINR(o.total_debit)}
              change={mom?.debit_pct}
              tone="debit"
              hint={`${o.debit_count} debits`}
              to={transactionsHref({
                type: 'debit',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            <KpiCard
              label="Credit card spend"
              value={formatINR(o.credit_card_spend ?? 0)}
              tone="debit"
              hint={
                o.credit_card_count
                  ? `${o.credit_card_count} card purchase(s)`
                  : 'Separate from bank/UPI'
              }
              to={transactionsHref({
                type: 'debit',
                card_type: 'credit_card',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
            <KpiCard
              label="Bank / UPI lifestyle"
              value={formatINR(
                o.bank_upi_spend ??
                  Math.max((o.lifestyle_spend ?? 0) - (o.credit_card_spend ?? 0), 0),
              )}
              hint={`Avg daily ${formatINR(o.avg_daily_lifestyle ?? o.avg_daily_debit)} · ${o.active_days} days`}
              to={transactionsHref({
                type: 'debit',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
              })}
            />
          </div>

          <PeriodCompare monthly={data.monthly} byCategory={data.by_category} className="mb-5" />

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Monthly credited vs debited" subtitle="Click a month to drill in">
              <CashflowBars data={data.monthly} onMonthClick={goMonth} />
            </ChartCard>
            <ChartCard title="Net savings trend" subtitle="Running credit − debit">
              <NetTrendLine
                data={data.monthly.map((m) => ({
                  month: m.month,
                  running_net: m.running_net ?? 0,
                }))}
                onMonthClick={goMonth}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Income source breakdown"
              subtitle="Salary sources are marked · click to open"
            >
              <DonutChart
                data={data.income_sources.map((r) => ({
                  name: r.is_salary ? `${r.name} (salary)` : r.name,
                  value: r.amount,
                  raw: r.name,
                }))}
                onSliceClick={(name) => {
                  const raw = name.replace(/ \(salary\)$/, '')
                  navigate(
                    transactionsHref({
                      q: raw,
                      type: 'credit',
                      date_from: dateFrom || undefined,
                      date_to: dateTo || undefined,
                    }),
                  )
                }}
              />
            </ChartCard>
            <ChartCard
              title="SMS account balances"
              subtitle="Last balance from SMS — may be incomplete"
            >
              <HorizontalBars
                data={data.accounts.map((a) => ({
                  name: `${a.bank}${a.incomplete ? ' (incomplete)' : ''} ••${a.account_last4}`,
                  value: a.balance,
                }))}
                color="var(--credit)"
              />
              {data.accounts[0]?.as_of ? (
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  SMS parsing last ran: {new Date(data.accounts[0].as_of).toLocaleString('en-IN')}
                </p>
              ) : null}
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
