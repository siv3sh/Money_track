import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_COLORS } from '../types'
import { formatCompactINR, formatINR, formatMonth } from '../lib/format'
import { EmptyState } from './ui'

function useChartTheme() {
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement)
    return {
      text: s.getPropertyValue('--muted').trim() || '#6b7280',
      border: s.getPropertyValue('--border').trim() || '#e2e6eb',
      surface: s.getPropertyValue('--surface').trim() || '#fff',
      debit: s.getPropertyValue('--debit').trim() || '#dc3d33',
      credit: s.getPropertyValue('--credit').trim() || '#0d9f6e',
      accent: s.getPropertyValue('--accent').trim() || '#2563eb',
      colors: CHART_COLORS.map((c) => {
        if (c.startsWith('var(')) {
          const name = c.slice(4, -1)
          return s.getPropertyValue(name).trim() || c
        }
        return c
      }),
    }
  }, [])
}

function Tip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color?: string; dataKey?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow-lg)]"
      style={{ minWidth: 140 }}
    >
      {label ? <p className="mb-1.5 font-semibold text-[var(--text)]">{label}</p> : null}
      {payload.map((p) => (
        <div key={`${p.name}-${p.dataKey || ''}`} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-[var(--muted)]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: p.color }}
            />
            {p.name}
          </span>
          <span className="font-medium tabular-nums text-[var(--text)]">
            {formatINR(Number(p.value) || 0)}
          </span>
        </div>
      ))}
    </div>
  )
}

function tipDelta({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload?: { prior?: number; current?: number; delta?: number }; value?: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow-lg)]">
      {label ? <p className="mb-1.5 font-semibold text-[var(--text)]">{label}</p> : null}
      <div className="space-y-0.5 tabular-nums text-[var(--muted)]">
        <p>Prior {formatINR(Number(row?.prior) || 0)}</p>
        <p>Now {formatINR(Number(row?.current) || 0)}</p>
        <p className="font-medium text-[var(--text)]">
          Δ {Number(row?.delta) >= 0 ? '+' : ''}
          {formatINR(Number(row?.delta) || 0)}
        </p>
      </div>
    </div>
  )
}

function mixHex(hex: string, t: number, toward = '#0b1220'): string {
  const parse = (h: string) => {
    const x = h.replace('#', '')
    const n = x.length === 3 ? x.split('').map((c) => c + c).join('') : x
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  }
  try {
    const [r, g, b] = parse(hex.startsWith('#') ? hex : '#888888')
    const [tr, tg, tb] = parse(toward)
    const m = (a: number, b: number) => Math.round(a + (b - a) * t)
    return `rgb(${m(r, tr)}, ${m(g, tg)}, ${m(b, tb)})`
  } catch {
    return hex
  }
}

export function CashflowBars({
  data,
  onMonthClick,
}: {
  data: Array<{ month: string; debit: number; credit: number; net: number }>
  onMonthClick?: (month: string) => void
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No cash-flow data yet" />
  const rows = data.map((d) => ({ ...d, label: formatMonth(d.month) }))
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={rows}
        barGap={4}
        barCategoryGap="18%"
        style={{ cursor: onMonthClick ? 'pointer' : undefined }}
        onClick={(state) => {
          const payload = state as { activePayload?: Array<{ payload?: { month?: string } }> }
          const month = payload.activePayload?.[0]?.payload?.month
          if (month && onMonthClick) onMonthClick(month)
        }}
      >
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: theme.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip
          content={<Tip />}
          cursor={{ fill: theme.accent, fillOpacity: 0.1 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="credit" name="Credited" fill={theme.credit} radius={[4, 4, 0, 0]} />
        <Bar dataKey="debit" name="Debited" fill={theme.debit} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DailyCashflowBars({
  data,
  onPointClick,
  selectedKey,
  height = 280,
}: {
  data: Array<{ key: string; label: string; debit: number; credit: number; net?: number }>
  onPointClick?: (key: string) => void
  selectedKey?: string | null
  height?: number
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No activity in this period" />

  const handleSelect = (key?: string) => {
    if (key && onPointClick) onPointClick(key)
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        barGap={3}
        barCategoryGap="16%"
        style={{ cursor: onPointClick ? 'pointer' : undefined }}
        onClick={(state) => {
          const payload = state as { activePayload?: Array<{ payload?: { key?: string } }> }
          handleSelect(payload.activePayload?.[0]?.payload?.key)
        }}
      >
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip
          content={<Tip />}
          cursor={{ fill: theme.accent, fillOpacity: 0.1 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="credit"
          name="Credited"
          radius={[4, 4, 0, 0]}
          onClick={(entry) => {
            const row = entry as { key?: string; payload?: { key?: string } }
            handleSelect(row.key ?? row.payload?.key)
          }}
        >
          {data.map((row) => (
            <Cell
              key={`c-${row.key}`}
              fill={theme.credit}
              fillOpacity={selectedKey && selectedKey !== row.key ? 0.35 : 1}
              stroke={selectedKey === row.key ? theme.accent : 'transparent'}
              strokeWidth={selectedKey === row.key ? 1.5 : 0}
            />
          ))}
        </Bar>
        <Bar
          dataKey="debit"
          name="Debited"
          radius={[4, 4, 0, 0]}
          onClick={(entry) => {
            const row = entry as { key?: string; payload?: { key?: string } }
            handleSelect(row.key ?? row.payload?.key)
          }}
        >
          {data.map((row) => (
            <Cell
              key={`d-${row.key}`}
              fill={theme.debit}
              fillOpacity={selectedKey && selectedKey !== row.key ? 0.35 : 1}
              stroke={selectedKey === row.key ? theme.accent : 'transparent'}
              strokeWidth={selectedKey === row.key ? 1.5 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function NetTrendLine({
  data,
  dataKey = 'running_net',
  name = 'Running net',
  onMonthClick,
}: {
  data: Array<Record<string, string | number>>
  dataKey?: string
  name?: string
  onMonthClick?: (month: string) => void
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No trend data yet" />
  const rows = data.map((d) => ({
    ...d,
    label: formatMonth(String(d.month ?? d.date ?? '')),
  }))
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={rows}
        style={{ cursor: onMonthClick ? 'pointer' : undefined }}
        onClick={(state) => {
          const payload = state as { activePayload?: Array<{ payload?: { month?: string } }> }
          const month = String(payload.activePayload?.[0]?.payload?.month || '')
          if (month && onMonthClick) onMonthClick(month)
        }}
      >
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: theme.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip content={<Tip />} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={theme.accent}
          fill="url(#netFill)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data,
  nameKey = 'name',
  valueKey = 'value',
  onSliceClick,
  centerLabel,
}: {
  data: Array<Record<string, string | number>>
  nameKey?: string
  valueKey?: string
  onSliceClick?: (name: string) => void
  /** Optional center caption (e.g. total). */
  centerLabel?: string
}) {
  const theme = useChartTheme()
  const cleaned = data.filter((d) => Number(d[valueKey]) > 0)
  if (!cleaned.length) return <EmptyState message="No breakdown yet" />
  const total = cleaned.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0)
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={cleaned}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
            cursor={onSliceClick ? 'pointer' : undefined}
            onClick={(_, index) => {
              const name = String(cleaned[index]?.[nameKey] ?? '')
              if (name && onSliceClick) onSliceClick(name)
            }}
          >
            {cleaned.map((_, i) => (
              <Cell key={i} fill={theme.colors[i % theme.colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<Tip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Total</p>
        <p className="text-sm font-semibold tabular-nums text-[var(--text)]">
          {centerLabel || formatCompactINR(total)}
        </p>
      </div>
    </div>
  )
}

export function HorizontalBars({
  data,
  nameKey = 'name',
  valueKey = 'value',
  color,
  onBarClick,
  showLabels = false,
  toneByRank = false,
}: {
  data: Array<Record<string, string | number>>
  nameKey?: string
  valueKey?: string
  color?: string
  onBarClick?: (name: string) => void
  showLabels?: boolean
  /** Stronger fill for larger bars (report ranking charts). */
  toneByRank?: boolean
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No ranking data yet" />
  const peak = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1)
  const base = (() => {
    if (!color) return theme.debit
    if (color.startsWith('var(')) {
      if (color.includes('credit')) return theme.credit
      if (color.includes('accent')) return theme.accent
      return theme.debit
    }
    return color
  })()
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 4, right: showLabels ? 52 : 16, top: 4, bottom: 4 }}
        style={{ cursor: onBarClick ? 'pointer' : undefined }}
        onClick={(state) => {
          const payload = state as {
            activePayload?: Array<{ payload?: Record<string, string | number> }>
          }
          const name = String(payload.activePayload?.[0]?.payload?.[nameKey] ?? '')
          if (name && onBarClick) onBarClick(name)
        }}
      >
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
        />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={118}
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<Tip />} />
        <Bar dataKey={valueKey} name="Amount" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((d, i) => {
            const v = Number(d[valueKey]) || 0
            const fill = toneByRank ? mixHex(base, 0.55 * (1 - v / peak), '#ffffff') : base
            return <Cell key={i} fill={fill} />
          })}
          {showLabels ? (
            <LabelList
              dataKey={valueKey}
              position="right"
              formatter={(v) => formatCompactINR(Number(v) || 0)}
              style={{ fill: theme.text, fontSize: 10, fontWeight: 600 }}
            />
          ) : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Side-by-side prior vs this-month (report + budget). */
export function GroupedComparisonBars({
  data,
  leftLabel = 'Prior',
  rightLabel = 'This month',
  orientation = 'horizontal',
}: {
  data: Array<{ name: string; template: number; actual: number }>
  leftLabel?: string
  rightLabel?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No comparison yet" />
  const vertical = orientation === 'vertical'
  return (
    <ResponsiveContainer
      width="100%"
      height={vertical ? 280 : Math.max(260, data.length * 52)}
    >
      <BarChart
        data={data}
        layout={vertical ? 'horizontal' : 'vertical'}
        margin={{ left: 8, right: 12, top: 8, bottom: vertical ? 8 : 4 }}
        barGap={4}
        barCategoryGap="22%"
      >
        <CartesianGrid
          stroke={theme.border}
          strokeDasharray="3 3"
          horizontal={!vertical}
          vertical={vertical}
        />
        {vertical ? (
          <>
            <XAxis
              dataKey="name"
              tick={{ fill: theme.text, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: theme.text, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCompactINR(Number(v))}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              tick={{ fill: theme.text, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCompactINR(Number(v))}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={{ fill: theme.text, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
          </>
        )}
        <Tooltip content={<Tip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="template"
          name={leftLabel}
          fill={theme.accent}
          radius={vertical ? [6, 6, 0, 0] : [0, 4, 4, 0]}
          barSize={vertical ? 22 : 12}
        >
          {vertical ? (
            <LabelList
              dataKey="template"
              position="top"
              formatter={(v) => formatCompactINR(Number(v) || 0)}
              style={{ fill: theme.text, fontSize: 9 }}
            />
          ) : null}
        </Bar>
        <Bar
          dataKey="actual"
          name={rightLabel}
          fill={theme.debit}
          radius={vertical ? [6, 6, 0, 0] : [0, 4, 4, 0]}
          barSize={vertical ? 22 : 12}
        >
          {vertical ? (
            <LabelList
              dataKey="actual"
              position="top"
              formatter={(v) => formatCompactINR(Number(v) || 0)}
              style={{ fill: theme.text, fontSize: 9 }}
            />
          ) : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Diverging ±Δ bars for category / leakage moves. */
export function DeltaBars({
  data,
}: {
  data: Array<{ name: string; delta: number; prior?: number; current?: number }>
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No moves to chart" />
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 4, right: 56, top: 4, bottom: 4 }}
      >
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine x={0} stroke={theme.text} strokeOpacity={0.4} />
        <Tooltip content={tipDelta} />
        <Bar dataKey="delta" name="Change" radius={[4, 4, 4, 4]} barSize={14}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.delta >= 0 ? theme.debit : theme.credit} />
          ))}
          <LabelList
            dataKey="delta"
            position="right"
            formatter={(v) => {
              const n = Number(v) || 0
              return `${n >= 0 ? '+' : ''}${formatCompactINR(n)}`
            }}
            style={{ fill: theme.text, fontSize: 10, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StackedAreaChart({
  data,
  keys,
}: {
  data: Array<Record<string, string | number>>
  keys: string[]
}) {
  const theme = useChartTheme()
  if (!data.length || !keys.length) return <EmptyState message="No category trends yet" />
  const rows = data.map((d) => ({ ...d, label: formatMonth(String(d.month)) }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={rows}>
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: theme.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip content={<Tip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stackId="1"
            stroke={theme.colors[i % theme.colors.length]}
            fill={theme.colors[i % theme.colors.length]}
            fillOpacity={0.55}
            strokeWidth={1}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MultiLineChart({
  data,
  keys,
}: {
  data: Array<Record<string, string | number>>
  keys: string[]
}) {
  const theme = useChartTheme()
  if (!data.length || !keys.length) return <EmptyState message="No source trends yet" />
  const rows = data.map((d) => ({ ...d, label: formatMonth(String(d.month)) }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows}>
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: theme.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip content={<Tip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={theme.colors[i % theme.colors.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function GroupedSourceBars({
  data,
  onSourceClick,
}: {
  data: Array<{ source: string; debit: number; credit: number; net: number }>
  onSourceClick?: (source: string) => void
}) {
  const theme = useChartTheme()
  if (!data.length) return <EmptyState message="No source breakdown yet" />
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 48)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 12 }}
        style={{ cursor: onSourceClick ? 'pointer' : undefined }}
        onClick={(state) => {
          const payload = state as { activePayload?: Array<{ payload?: { source?: string } }> }
          const source = String(payload.activePayload?.[0]?.payload?.source || '')
          if (source && onSourceClick) onSourceClick(source)
        }}
      >
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="source"
          width={100}
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<Tip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="credit" name="Credit" fill={theme.credit} radius={[0, 3, 3, 0]} />
        <Bar dataKey="debit" name="Debit" fill={theme.debit} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function HeatmapGrid({
  cells,
}: {
  cells: Array<{ day: number; amount: number; count: number }>
}) {
  if (!cells.length) return <EmptyState message="No day-of-month pattern yet" />
  const max = Math.max(...cells.map((c) => c.amount), 1)
  const map = new Map(cells.map((c) => [c.day, c]))
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-8 md:grid-cols-11">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
        const cell = map.get(day)
        const intensity = cell ? cell.amount / max : 0
        return (
          <div
            key={day}
            title={
              cell
                ? `Day ${day}: ${formatINR(cell.amount)} · ${cell.count} txns`
                : `Day ${day}: no spend`
            }
            className="flex aspect-square flex-col items-center justify-center rounded-lg border border-[var(--border)] text-[10px] font-medium"
            style={{
              background:
                intensity > 0
                  ? `color-mix(in srgb, var(--debit) ${Math.round(intensity * 70 + 8)}%, var(--surface))`
                  : 'var(--surface-2)',
              color: intensity > 0.45 ? '#fff' : 'var(--muted)',
            }}
          >
            {day}
          </div>
        )
      })}
    </div>
  )
}

export function AssetsLiabilitiesBars({
  assets,
  liabilities,
}: {
  assets: number
  liabilities: number
}) {
  const theme = useChartTheme()
  const data = [
    { name: 'Assets', value: assets },
    { name: 'Liabilities', value: liabilities },
  ]
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="30%">
        <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: theme.text, fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: theme.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompactINR(Number(v))}
          width={56}
        />
        <Tooltip content={<Tip />} />
        <Bar dataKey="value" name="Amount" radius={[6, 6, 0, 0]}>
          <Cell fill={theme.credit} />
          <Cell fill={theme.debit} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
