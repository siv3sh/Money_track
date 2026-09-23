import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { APP_NAV } from '../lib/navConfig'
import { ALWAYS_VISIBLE_NAV, useNavVisibility } from '../hooks/useNavVisibility'

export function NavCustomizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { visible, toggle, showAll, resetDefaults } = useNavVisibility()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-cust-title"
        tabIndex={-1}
        className="relative z-[61] w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--sheet)] shadow-[0_24px_64px_rgba(0,0,0,0.22)] outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="nav-cust-title" className="text-base font-semibold text-[var(--text)]">
              Customise menu
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Hide Phones & email or Import if you prefer a shorter sidebar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <X size={15} />
          </button>
        </div>

        <ul className="max-h-[55vh] overflow-y-auto py-2">
          {APP_NAV.map((item) => {
            const locked = ALWAYS_VISIBLE_NAV.includes(item.id)
            const checked = visible[item.id] !== false
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${
                    locked
                      ? 'cursor-default opacity-60'
                      : 'cursor-pointer hover:bg-[var(--surface-2)]'
                  }`}
                  onClick={() => {
                    if (!locked) toggle(item.id)
                  }}
                  aria-pressed={checked}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      checked
                        ? 'border-[var(--sapphire)] bg-[var(--sapphire)]'
                        : 'border-[var(--border-strong)] bg-transparent'
                    }`}
                    aria-hidden
                  >
                    {checked ? <Check size={11} strokeWidth={3} className="text-white" /> : null}
                  </span>
                  <item.icon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      checked ? 'text-[var(--sapphire)]' : 'text-[var(--muted)]'
                    }`}
                    aria-hidden
                  />
                  <span
                    className={`flex-1 text-sm font-medium ${
                      checked ? 'text-[var(--text)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    {item.label}
                  </span>
                  {locked ? (
                    <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      Always on
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs font-medium text-[var(--sapphire)] hover:underline"
              onClick={showAll}
            >
              Show all
            </button>
            <button
              type="button"
              className="text-xs font-medium text-[var(--muted)] hover:underline"
              onClick={resetDefaults}
            >
              Defaults
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
