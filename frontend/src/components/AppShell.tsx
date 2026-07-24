import { NavLink, Outlet } from 'react-router-dom'
import { FileSpreadsheet, LayoutDashboard, Moon, PieChart, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

const THEME_KEY = 'money-track-theme'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-[var(--accent)] text-white shadow-sm'
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

export function AppShell() {
  const { dark, toggle } = useDarkMode()

  return (
    <div className="app-shell mx-auto min-h-screen w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 xl:px-10">
      <header className="app-header mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Money Track</h1>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Cash-flow control
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Live activity · spend patterns · actionable reports
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <nav className="app-nav flex flex-wrap gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            <NavLink to="/" end className={linkClass}>
              <LayoutDashboard size={14} />
              Dashboard
            </NavLink>
            <NavLink to="/reports" className={linkClass}>
              <PieChart size={14} />
              Reports
            </NavLink>
            <NavLink to="/import" className={linkClass}>
              <FileSpreadsheet size={14} />
              Import
            </NavLink>
          </nav>
          <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="btn">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <Outlet />
    </div>
  )
}
