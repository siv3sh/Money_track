import { useMemo } from 'react'
import type { DatePreset } from '../context/FilterContext'
import { useFilters } from '../context/FilterContext'

const PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'quarter', label: '3 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

export function FilterBar({ showBanks = true }: { showBanks?: boolean }) {
  const {
    preset,
    dateFrom,
    dateTo,
    banks,
    availableBanks,
    setPreset,
    setDateFrom,
    setDateTo,
    toggleBank,
    clearBanks,
    refresh,
    loading,
  } = useFilters()

  const bankOptions = useMemo(
    () => availableBanks.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [availableBanks],
  )

  return (
    <div className="filter-bar sticky top-0 z-20 -mx-1 mb-5 border-b border-[var(--border)] bg-[var(--canvas)] px-1 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--sheet)] p-1 shadow-[var(--elev-1)]">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                preset === p.id
                  ? 'seg-active'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          From
          <input
            type="date"
            className="field"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          To
          <input
            type="date"
            className="field"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>

        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {showBanks && bankOptions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Sources
          </span>
          <button
            type="button"
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              banks.length === 0
                ? 'border-[var(--sapphire)] bg-[var(--accent-soft)] text-[var(--sapphire)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]'
            }`}
            onClick={clearBanks}
          >
            All
          </button>
          {bankOptions.map((bank) => {
            const active = banks.includes(bank)
            return (
              <button
                key={bank}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-[var(--sapphire)] bg-[var(--accent-soft)] text-[var(--sapphire)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => toggleBank(bank)}
              >
                {bank}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
