import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_COLORS } from '../../lib/analytics'
import { formatINR } from '../../lib/format'
import { EmptyState } from '../ui/EmptyState'
import { axisTick, formatTooltipValue, gridStroke, inrAxis, tooltipStyle } from './chartTheme'

export function GroupedCreditDebitBars({
  data,
}: {
  data: Array<{ label: string; credit: number; debit: number }>
}) {
  if (!data.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Legend />
        <Bar dataKey="credit" name="Credit" fill="var(--chart-credit)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="debit" name="Debit" fill="var(--chart-debit)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function NetTrendLine({
  data,
  dataKey = 'net',
  name = 'Net savings',
  color = 'var(--accent)',
}: {
  data: Array<Record<string, string | number>>
  dataKey?: string
  name?: string
  color?: string
}) {
  if (!data.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          fill="url(#netFill)"
          strokeWidth={2.25}
          animationDuration={900}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data,
  colors = CHART_COLORS,
  innerRadius = 62,
  outerRadius = 92,
}: {
  data: Array<{ name: string; value: number }>
  colors?: string[]
  innerRadius?: number
  outerRadius?: number
}) {
  if (!data.length) return <EmptyState />
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="var(--surface)"
            strokeWidth={2}
            animationDuration={800}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value) => <span style={{ color: 'var(--muted)', fontSize: 11 }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-8">
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Total
          </p>
          <p className="text-sm font-semibold tabular-nums">{formatINR(total)}</p>
        </div>
      </div>
    </div>
  )
}

export function HorizontalRankBars({
  data,
  color = 'var(--accent)',
}: {
  data: Array<{ name: string; value: number }>
  color?: string
}) {
  if (!data.length) return <EmptyState />
  const chartData = [...data].reverse()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
      >
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Bar dataKey="value" name="Amount" fill={color} radius={[0, 5, 5, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StackedAreaChart({
  data,
  series,
  colors = CHART_COLORS,
}: {
  data: Array<Record<string, string | number> | object>
  series: string[]
  colors?: string[]
}) {
  if (!data.length || !series.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Legend />
        {series.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stackId="1"
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.55}
            strokeWidth={1.5}
            animationDuration={900}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MultiLineChart({
  data,
  series,
  colors = CHART_COLORS,
}: {
  data: Array<Record<string, string | number>>
  series: string[]
  colors?: string[]
}) {
  if (!data.length || !series.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Legend />
        {series.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={colors[i % colors.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            animationDuration={900}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function SimpleBars({
  data,
  dataKey,
  name,
  color = 'var(--accent)',
}: {
  data: Array<Record<string, string | number>>
  dataKey: string
  name: string
  color?: string
}) {
  if (!data.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[5, 5, 0, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DualBarCompare({
  data,
}: {
  data: Array<{ label: string; invested: number; current: number }>
}) {
  if (!data.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Legend />
        <Bar dataKey="invested" name="Invested" fill="var(--chart-7)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="current" name="Current" fill="var(--chart-credit)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function AssetsLiabilitiesBars({
  assets,
  liabilities,
}: {
  assets: number
  liabilities: number
}) {
  const data = [
    { label: 'Assets', value: assets, fill: 'var(--chart-credit)' },
    { label: 'Liabilities', value: liabilities, fill: 'var(--chart-debit)' },
  ]
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={inrAxis} width={52} />
        <Tooltip formatter={formatTooltipValue} contentStyle={tooltipStyle} />
        <Bar dataKey="value" name="Amount" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
