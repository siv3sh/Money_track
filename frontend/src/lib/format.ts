export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Map DLT sender IDs like VM-HDFCBK → display bank name. */
const SENDER_BANK: Record<string, string> = {
  HDFCBK: 'HDFC Bank',
  HDFC: 'HDFC Bank',
  SBIINB: 'SBI',
  SBIPSG: 'SBI',
  SBI: 'SBI',
  ICICIB: 'ICICI Bank',
  ICICI: 'ICICI Bank',
  AXISBK: 'Axis Bank',
  AXIS: 'Axis Bank',
  KOTAKB: 'Kotak Bank',
  KOTAK: 'Kotak Bank',
  IDFCFB: 'IDFC First Bank',
  IDFC: 'IDFC First Bank',
}

export function bankLabel(bank: string | null | undefined, sender?: string | null): string {
  if (bank && bank.trim()) return bank
  const cleaned = (sender || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (!cleaned) return 'Unknown bank'
  const keys = Object.keys(SENDER_BANK).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (cleaned === key || cleaned.endsWith(key)) return SENDER_BANK[key]
  }
  return sender || 'Unknown bank'
}

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    // timestamp may be YYYY-MM prefix only
    return iso.slice(0, 16).replace('T', ' ')
  }
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function pctChange(current: number, previous: number): string | null {
  if (previous === 0) {
    if (current === 0) return null
    return current > 0 ? '+∞' : null
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}
