import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { APP_NAV } from '../lib/navConfig'
import { useAdvisorSettings } from '../hooks/useAdvisorSettings'
import { useWealthSettings } from '../hooks/useWealthSettings'
import { ALWAYS_VISIBLE_NAV, useNavVisibility } from '../hooks/useNavVisibility'

export function NavCustomizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { visible, toggle, showAll } = useNavVisibility()
  const { enabled: advisorEnabled } = useAdvisorSettings()
  const { enabled: wealthEnabled } = useWealthSettings()
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

  const hintParts: string[] = []
  if (!advisorEnabled) hintParts.push('Advisor is off')
  if (!wealthEnabled) hintParts.push('Wealth is off')

  const items = APP_NAV.filter((item) => {
    if (!advisorEnabled && item.id === 'planning') return false
    if (!wealthEnabled && item.id === 'wealth') return false
    return true
  })

  return (
    /* full-screen dim backdrop */
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      {/* click-outside close */}
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />

      {/* dialog card */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-cust-title"
        tabIndex={-1}
        className="relative z-[61] w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--sheet)] shadow-[0_24px_64px_rgba(0,0,0,0.22)] outline-none"
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="nav-cust-title" className="text-base font-semibold text-[var(--text)]">
              Customise menu
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Pick the pages you want in the sidebar.
              {hintParts.length ? ` ${hintParts.join(' · ')} — enable in Profile.` : ''}
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

        {/* item list */}
        <ul className="max-h-[55vh] overflow-y-auto py-2">
          {items.map((item) => {
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
                  {/* custom checkbox */}
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
                  {/* nav icon */}
                  <item.icon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      checked ? 'text-[var(--sapphire)]' : 'text-[var(--muted)]'
                    }`}
                    aria-hidden
                  />
                  {/* label */}
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

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            className="text-xs font-medium text-[var(--sapphire)] hover:underline"
            onClick={showAll}
          >
            Show all
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
