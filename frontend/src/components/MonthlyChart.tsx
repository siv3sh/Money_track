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
import type { MonthlyBucket } from '../types'
import { formatINR } from '../lib/format'

interface Props {
  data: MonthlyBucket[]
}

export function MonthlyChart({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">
        No monthly data yet
      </div>
    )
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} />
          <YAxis
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${v}`
            }
            width={52}
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
          <Legend />
          <Bar dataKey="debit" name="Debit" fill="var(--chart-debit)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="credit" name="Credit" fill="var(--chart-credit)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
