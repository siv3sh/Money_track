/** Helpers to deep-link into /transactions with filters. */

export function transactionsHref(opts: {
  category?: string
  source?: string
  bank?: string
  type?: 'debit' | 'credit' | ''
  month?: string
  date_from?: string
  date_to?: string
  q?: string
}): string {
  const p = new URLSearchParams()
  if (opts.category) p.set('category', opts.category)
  const source = opts.source || opts.bank
  if (source) p.set('source', source)
  if (opts.type) p.set('type', opts.type)
  if (opts.month) p.set('month', opts.month)
  if (opts.date_from) p.set('date_from', opts.date_from)
  if (opts.date_to) p.set('date_to', opts.date_to)
  if (opts.q) p.set('q', opts.q)
  const qs = p.toString()
  return qs ? `/transactions?${qs}` : '/transactions'
}
