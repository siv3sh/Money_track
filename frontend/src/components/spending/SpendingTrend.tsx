import { useMemo, useState } from 'react'
import { DailyCashflowBars } from '../charts'
import { ChartCard } from '../ui'
import { dailyToTrendPoints, weeklyFromDaily, type DailyPoint } from './utils'

type Grain = 'daily' | 'weekly'

export function SpendingTrend({ daily }: { daily: DailyPoint[] }) {
  const [grain, setGrain] = useState<Grain>('daily')

  const points = useMemo(
    () => (grain === 'daily' ? dailyToTrendPoints(daily) : weeklyFromDaily(daily)),
    [daily, grain],
  )

  return (
    <ChartCard
      title="Spending trend"
      subtitle={grain === 'daily' ? 'Debits by day' : 'Debits by ISO week'}
      className="mb-5"
      action={
        <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
          {(['daily', 'weekly'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`rounded-md px-2.5 py-1 capitalize ${
                grain === g
                  ? 'bg-[var(--sapphire)] text-white'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              onClick={() => setGrain(g)}
            >
              {g}
            </button>
          ))}
        </div>
      }
    >
      <DailyCashflowBars data={points} height={260} />
    </ChartCard>
  )
}
