import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MerchantSpend } from '../types'
import { formatINR } from '../lib/format'

interface Props {
  data: MerchantSpend[]
}

export function MerchantChart({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">
        No merchant spend yet
      </div>
    )
  }

  const chartData = [...data].reverse()

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${v}`
            }
          />
          <YAxis
            type="category"
            dataKey="merchant"
            width={100}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => formatINR(Number(value ?? 0))}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
            }}
          />
          <Bar dataKey="amount" name="Spend" fill="var(--accent)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
