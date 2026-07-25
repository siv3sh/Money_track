export function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

export function formatCompactINR(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`
  if (abs >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`
  if (abs >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`
  return formatINR(value)
}

export function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

export function bankLabel(bank: string | null | undefined, sender?: string): string {
  if (bank) return bank
  if (sender) return sender
  return 'Unknown'
}

export function pctChangeLabel(pct: number | null | undefined): string {
  if (pct == null) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function toInputDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
