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
    timeZone: 'Asia/Kolkata',
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

/** Calendar date in India (YYYY-MM-DD), independent of browser timezone. */
export function toInputDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Hour 0–23 in Asia/Kolkata. */
export function hourInIST(value: string | Date): number {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return NaN
  const raw = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  }).format(d)
  const h = Number(raw.replace(/:.*/, ''))
  // en-GB can yield "24" for midnight in some engines
  if (h === 24) return 0
  return h
}

/** Statement/date-only rows are stored at 00:00 UTC — no real clock time. */
export function hasClockTime(iso: string, source?: string | null): boolean {
  if (source === 'statement') return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return !(
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  )
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

export type IstYmd = { y: number; m: number; d: number }

/** Today's calendar date in Asia/Kolkata. */
export function todayIST(): IstYmd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function weekdaySun0(ymd: IstYmd): number {
  // UTC noon on that civil date → stable weekday
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0)).getUTCDay()
}

function compareYmd(a: IstYmd, b: IstYmd): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.m !== b.m) return a.m - b.m
  return a.d - b.d
}

function addMonths(ymd: IstYmd, n: number): IstYmd {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1 + n, 1))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: 1 }
}

/**
 * Salary rule: credited on the 1st, or the next weekday if the 1st is Sat/Sun.
 * (Sat/Sun holidays only — no public-holiday calendar.)
 */
export function salaryPaydayForMonth(year: number, month: number): IstYmd {
  let day = 1
  const wd = weekdaySun0({ y: year, m: month, d: 1 })
  if (wd === 6) day = 3 // Saturday → Monday
  else if (wd === 0) day = 2 // Sunday → Monday
  return { y: year, m: month, d: day }
}

export function nextSalaryPayday(from: IstYmd = todayIST()): {
  date: IstYmd
  iso: string
  label: string
  daysUntil: number
  isToday: boolean
  rolledFromWeekend: boolean
} {
  let candidate = salaryPaydayForMonth(from.y, from.m)
  if (compareYmd(from, candidate) > 0) {
    const next = addMonths(from, 1)
    candidate = salaryPaydayForMonth(next.y, next.m)
  }
  const firstWasWeekend = weekdaySun0({ y: candidate.y, m: candidate.m, d: 1 }) % 6 === 0
  // days until
  const start = Date.UTC(from.y, from.m - 1, from.d)
  const end = Date.UTC(candidate.y, candidate.m - 1, candidate.d)
  const daysUntil = Math.round((end - start) / 86_400_000)
  const iso = `${candidate.y}-${String(candidate.m).padStart(2, '0')}-${String(candidate.d).padStart(2, '0')}`
  const label = new Date(Date.UTC(candidate.y, candidate.m - 1, candidate.d, 12)).toLocaleDateString(
    'en-IN',
    { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  )
  return {
    date: candidate,
    iso,
    label,
    daysUntil,
    isToday: daysUntil === 0,
    rolledFromWeekend: firstWasWeekend && candidate.d !== 1,
  }
}
