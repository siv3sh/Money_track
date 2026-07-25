import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  PieChart,
  Sun,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { FilterProvider } from '../context/FilterContext'

const THEME_KEY = 'money-track-theme'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cash-flow', label: 'Cash Flow', icon: Wallet },
  { to: '/spending', label: 'Spending', icon: PieChart },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/sources', label: 'Sources', icon: ArrowLeftRight },
  { to: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { to: '/import', label: 'Import', icon: FileSpreadsheet },
] as const

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

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {NAV.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in rest ? rest.end : false}
          onClick={onNavigate}
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <Icon size={16} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { dark, toggle } = useDarkMode()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <FilterProvider>
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w)] flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:flex">
          <div className="flex h-[var(--header-h)] items-center gap-2.5 border-b border-[var(--border)] px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Landmark size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">Money Track</p>
              <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                Personal finance
              </p>
            </div>
          </div>
          <SidebarNav />
          <div className="border-t border-[var(--border)] p-3">
            <button type="button" onClick={toggle} className="btn w-full justify-center" aria-label="Toggle theme">
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-[min(280px,85vw)] flex-col bg-[var(--surface)] shadow-lg">
              <div className="flex h-[var(--header-h)] items-center justify-between border-b border-[var(--border)] px-4">
                <div className="flex items-center gap-2">
                  <Landmark size={16} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold">Money Track</span>
                </div>
                <button type="button" className="btn" onClick={() => setMobileOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-h-screen w-full flex-1 flex-col lg:pl-[var(--sidebar-w)]">
          <header className="app-topbar sticky top-0 z-20 flex h-[var(--header-h)] items-center justify-between gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] px-4 backdrop-blur-md sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu size={16} />
              </button>
              <p className="text-sm text-[var(--muted)] lg:hidden">Money Track</p>
            </div>
            <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="btn lg:hidden">
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 xl:px-10">
            <div className="mx-auto w-full max-w-[1600px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </FilterProvider>
  )
}
