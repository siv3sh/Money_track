export type DatePreset = 'month' | 'last-month' | 'quarter' | 'year' | 'all'

export function toInputDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function presetDates(preset: DatePreset): [string, string] {
  const today = new Date()
  const end = toInputDate(today)

  switch (preset) {
    case 'month':
      return [toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), end]
    case 'last-month':
      return [
        toInputDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        toInputDate(new Date(today.getFullYear(), today.getMonth(), 0)),
      ]
    case 'quarter':
      return [toInputDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)), end]
    case 'year':
      return [toInputDate(new Date(today.getFullYear(), 0, 1)), end]
    case 'all':
      return ['', '']
    default: {
      const exhaustive: never = preset
      return exhaustive
    }
  }
}

export function formatRangeLabel(dateFrom: string, dateTo: string): string {
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  if (!dateFrom && !dateTo) return 'All time'
  if (dateFrom && dateTo) return `${fmt(dateFrom)} — ${fmt(dateTo)}`
  if (dateFrom) return `From ${fmt(dateFrom)}`
  return `Until ${fmt(dateTo)}`
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
