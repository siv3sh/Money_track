import { NavLink, Outlet } from 'react-router-dom'
import {
  Bell,
  FileText,
  Landmark,
  LayoutDashboard,
  List,
  Menu,
  Moon,
  PieChart,
  Sparkles,
  Sun,
  TrendingUp,
  Upload,
  Wallet,
  X,
  ArrowLeftRight,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { FilterProvider } from '../context/FilterContext'

const THEME_KEY = 'money-track-theme'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/net-worth', label: 'Net Worth', icon: Wallet },
  { to: '/cash-flow', label: 'Cash Flow', icon: ArrowLeftRight },
  { to: '/spending', label: 'Spending', icon: PieChart },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/sources', label: 'Sources', icon: Landmark },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/ai', label: 'AI Insights', icon: Sparkles },
  { to: '/monthly-reports', label: 'Reports', icon: FileText },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/import', label: 'Import', icon: Upload },
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

export function AppShell() {
  const { dark, toggle } = useDarkMode()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <FilterProvider>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        {/* Mobile overlay */}
        {mobileOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <aside
          className={`app-sidebar fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-w)] flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform lg:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ width: 248 }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">
                  M
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-tight">Money Track</p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Personal finance
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setMobileOpen(false)}
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-[var(--border)] p-3">
            <button type="button" className="btn w-full justify-center" onClick={toggle}>
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </aside>

        <div className="lg:pl-[248px]">
          <header className="app-topbar sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] px-4 py-3 backdrop-blur-md sm:px-6">
            <button
              type="button"
              className="btn lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--muted)]">
                Live SMS + statements · categorized cash flow
              </p>
            </div>
            <div className="hidden items-center gap-2 text-xs text-[var(--muted)] sm:flex">
              <Wallet size={14} />
              Premium dashboard
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </FilterProvider>
  )
}
