import { X } from 'lucide-react'
import { APP_NAV } from '../lib/navConfig'
import { useAdvisorSettings } from '../hooks/useAdvisorSettings'
import { ALWAYS_VISIBLE_NAV, useNavVisibility } from '../hooks/useNavVisibility'

export function NavCustomizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { visible, toggle, showAll } = useNavVisibility()
  const { enabled: advisorEnabled } = useAdvisorSettings()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[color-mix(in_srgb,var(--ink)_45%,transparent)] p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close customize menu"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="nav-customize-title"
        className="relative z-[61] w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="nav-customize-title" className="text-lg font-semibold text-[var(--text)]">
              What shows in the menu?
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Tick only the pages you use. Dashboard stays in the sidebar; Profile is in the top-right avatar menu.
              {!advisorEnabled
                ? ' Advisor is off in Profile — the Advisor page stays hidden until you turn it back on.'
                : null}
            </p>
          </div>
          <button type="button" className="btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {APP_NAV.filter((item) => advisorEnabled || item.id !== 'planning').map((item) => {
            const locked = ALWAYS_VISIBLE_NAV.includes(item.id)
            const checked = visible[item.id] !== false
            return (
              <li key={item.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                    locked ? 'opacity-80' : 'hover:bg-[var(--surface)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--sapphire)]"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggle(item.id)}
                  />
                  <item.icon size={16} className="shrink-0 text-[var(--muted)]" />
                  <span className="flex-1 text-[var(--text)]">{item.label}</span>
                  {locked ? (
                    <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Always on</span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={showAll}>
            Show all
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
