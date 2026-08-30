import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, LogOut, Moon, Settings2, Sun, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../hooks/useTheme'
import { NavCustomizeDialog } from './NavCustomizeDialog'

export function AccountMenu() {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const email = user?.email || 'Account'
  const initial = email.trim().charAt(0).toUpperCase() || 'U'

  return (
    <>
      <div className="relative shrink-0" ref={rootRef}>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--sapphire)] text-sm font-semibold text-white shadow-sm outline-none ring-[var(--sapphire)] transition hover:opacity-90 focus-visible:ring-2"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
          title={email}
          onClick={() => setOpen((v) => !v)}
        >
          {initial}
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--sheet)] py-1 shadow-[var(--shadow-lg)]"
          >
            <p className="truncate px-3 py-2 text-[11px] text-[var(--muted)]" title={email}>
              {email}
            </p>
            <div className="mb-1 border-t border-[var(--border)]" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface)]"
              onClick={() => {
                setOpen(false)
                navigate('/profile')
              }}
            >
              <UserRound size={14} />
              Profile
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface)]"
              onClick={() => {
                setOpen(false)
                navigate('/getting-started')
              }}
            >
              <BookOpen size={14} />
              Help & guide
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface)]"
              onClick={() => {
                setOpen(false)
                setCustomizeOpen(true)
              }}
            >
              <Settings2 size={14} />
              Customize menu
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface)]"
              onClick={() => {
                toggle()
                setOpen(false)
              }}
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--debit)] hover:bg-[var(--surface)]"
              onClick={() => {
                setOpen(false)
                logout()
                navigate('/login')
              }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        ) : null}
      </div>

      <NavCustomizeDialog open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
    </>
  )
}
