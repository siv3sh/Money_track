import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { FilterProvider } from '../context/FilterContext'
import { useAdvisorSettings } from '../hooks/useAdvisorSettings'
import { useWealthSettings } from '../hooks/useWealthSettings'
import { useNavVisibility } from '../hooks/useNavVisibility'
import { APP_NAV } from '../lib/navConfig'
import { AccountMenu } from './AccountMenu'
import { AdvisorChatWidget } from './AdvisorChatWidget'

/** Pages that need shared FilterContext analytics on mount. Dashboard has its own loader. */
const FILTER_ANALYTICS_PATHS = new Set([
  '/wealth',
  '/cash-flow',
  '/spending',
  '/transactions',
  '/ai',
  '/investments/indmoney',
])

/** Full analytics (merchants, recurring, budgets, alerts) — slower path. */
const FULL_ANALYTICS_PATHS = new Set(['/ai', '/spending'])

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isVisible } = useNavVisibility()
  const { enabled: advisorEnabled } = useAdvisorSettings()
  const { enabled: wealthEnabled } = useWealthSettings()
  const shownNav = APP_NAV.filter((item) => {
    if (item.id === 'planning' && !advisorEnabled) return false
    if (item.id === 'wealth' && !wealthEnabled) return false
    return isVisible(item.id)
  })
  const location = useLocation()
  const loadSharedAnalytics = FILTER_ANALYTICS_PATHS.has(location.pathname)
  const liteAnalytics = !FULL_ANALYTICS_PATHS.has(location.pathname)

  return (
    <FilterProvider autoLoad={loadSharedAnalytics} lite={liteAnalytics}>
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
        {mobileOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ink)_40%,transparent)] lg:hidden"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <aside
          className={`app-sidebar fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-w)] flex-col border-r border-[var(--border)] bg-[var(--sheet)] transition-transform lg:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ width: 248 }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--sapphire)] text-sm font-semibold text-white"
                  aria-hidden
                >
                  ₹
                </span>
                <div>
                  <p className="display text-sm font-semibold tracking-tight">Money Track</p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Sapphire Vault
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
            {shownNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end === true}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="lg:pl-[248px]">
          <header className="app-topbar elev-float sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 sm:px-6">
            <button
              type="button"
              className="btn lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--muted)]">SMS + email + statements</p>
            </div>
            <AccountMenu />
          </header>

          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
        {advisorEnabled ? <AdvisorChatWidget /> : null}
      </div>
    </FilterProvider>
  )
}
