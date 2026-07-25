import { RefreshCw, X } from 'lucide-react'
import { useFilters } from '../../context/FilterContext'
import type { DatePreset } from '../../lib/dates'
import { formatRangeLabel } from '../../lib/dates'

const PRESETS: Array<[DatePreset, string]> = [
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['quarter', '3 months'],
  ['year', 'YTD'],
  ['all', 'All time'],
]

interface Props {
  availableSources?: string[]
  availableCategories?: string[]
  onRefresh?: () => void
  loading?: boolean
  showSourceFilter?: boolean
  showCategoryFilter?: boolean
}

export function FilterBar({
  availableSources = [],
  availableCategories = [],
  onRefresh,
  loading,
  showSourceFilter = true,
  showCategoryFilter = true,
}: Props) {
  const {
    dateFrom,
    dateTo,
    activePreset,
    sources,
    category,
    setDateFrom,
    setDateTo,
    applyPreset,
    toggleSource,
    setCategory,
    setSources,
    clearFilters,
  } = useFilters()

  return (
    <div className="filter-bar sticky top-0 z-20 -mx-1 mb-5 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-1 py-3 backdrop-blur-md">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {PRESETS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activePreset === id
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              onClick={() => applyPreset(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="text-[11px] font-medium text-[var(--muted)]">
          From
          <input
            type="date"
            className="field mt-1 block"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="text-[11px] font-medium text-[var(--muted)]">
          To
          <input
            type="date"
            className="field mt-1 block"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>

        {showCategoryFilter && availableCategories.length > 0 ? (
          <label className="text-[11px] font-medium text-[var(--muted)]">
            Category
            <select
              className="field mt-1 block min-w-[140px]"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">
            {formatRangeLabel(dateFrom, dateTo)}
          </span>
          {(sources.length > 0 || category) && (
            <button type="button" className="btn" onClick={clearFilters}>
              <X size={14} />
              Clear
            </button>
          )}
          {onRefresh ? (
            <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      {showSourceFilter && availableSources.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Sources
          </span>
          <button
            type="button"
            onClick={() => setSources([])}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              sources.length === 0
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            All
          </button>
          {availableSources.map((source) => {
            const selected = sources.includes(source)
            return (
              <button
                key={source}
                type="button"
                onClick={() => toggleSource(source)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {source}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
