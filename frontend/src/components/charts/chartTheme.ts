import type { TooltipProps } from 'recharts'
import { formatINR } from '../../lib/format'

export const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  boxShadow: 'var(--shadow)',
  fontSize: 12,
  padding: '8px 10px',
}

export const axisTick = { fill: 'var(--muted)', fontSize: 11 }
export const gridStroke = 'var(--border)'

export function inrAxis(v: number): string {
  if (Math.abs(v) >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`
  if (Math.abs(v) >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return `₹${v}`
}

export function formatTooltipValue(value: unknown): string {
  return formatINR(Number(value ?? 0))
}

export type ChartTooltipProps = TooltipProps<number, string>
