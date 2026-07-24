import { NavLink, Outlet } from 'react-router-dom'
import { FileSpreadsheet, LayoutDashboard, Moon, PieChart, RefreshCw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

const THEME_KEY = 'money-track-theme'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm ${
    isActive
      ? 'bg-[var(--accent)] text-white'
      : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
  }`

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark((d) => !d) }
}

interface Props {
  onRefresh?: () => void
}

export function AppShell({ onRefresh }: Props) {
  const { dark, toggle } = useDarkMode()

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Personal finance
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Money Track</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            SMS capture · statements · detailed reports
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className="btn">
              <RefreshCw size={14} />
              Refresh
            </button>
          ) : null}
          <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="btn">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        <NavLink to="/" end className={linkClass}>
          <span className="inline-flex items-center gap-1.5">
            <LayoutDashboard size={14} />
            Dashboard
          </span>
        </NavLink>
        <NavLink to="/reports" className={linkClass}>
          <span className="inline-flex items-center gap-1.5">
            <PieChart size={14} />
            Reports
          </span>
        </NavLink>
        <NavLink to="/import" className={linkClass}>
          <span className="inline-flex items-center gap-1.5">
            <FileSpreadsheet size={14} />
            Import
          </span>
        </NavLink>
      </nav>

      <Outlet />
    </div>
  )
}
