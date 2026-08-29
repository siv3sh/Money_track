import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './hooks/useTheme'
import { NavVisibilityProvider } from './hooks/useNavVisibility'
import { AiInsightsPage } from './pages/AiInsightsPage'
import { AccountsPage } from './pages/AccountsPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { IndmoneyImportPage } from './pages/IndmoneyImportPage'
import { LoginPage } from './pages/LoginPage'
import { MoneyPlanningPage } from './pages/MoneyPlanningPage'
import { MonthlyReportsPage } from './pages/MonthlyReportsPage'
import { SetupPage } from './pages/SetupPage'
import { SpendingPage } from './pages/SpendingPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { WealthPage } from './pages/WealthPage'
import { ProfilePage } from './pages/ProfilePage'
import { LoadingBlock } from './components/ui'

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
      <LoadingBlock />
    </div>
  )
}

/** Logged-in users only (setup wizard included). */
function RequireLogin() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

/** App pages after the phone setup wizard is done. */
function RequireSetupDone() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!user.setup_completed) return <Navigate to="/setup" replace />
  return <Outlet />
}

export default function App() {
  return (
    <ThemeProvider>
      <NavVisibilityProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireLogin />}>
                <Route path="/setup" element={<SetupPage />} />
                <Route element={<RequireSetupDone />}>
                  <Route element={<AppShell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="wealth" element={<WealthPage />} />
                    <Route path="net-worth" element={<Navigate to="/wealth" replace />} />
                    <Route path="investments" element={<Navigate to="/wealth" replace />} />
                    <Route path="investments/indmoney" element={<IndmoneyImportPage />} />
                    <Route path="planning" element={<MoneyPlanningPage />} />
                    <Route path="cash-flow" element={<CashFlowPage />} />
                    <Route path="spending" element={<SpendingPage />} />
                    <Route path="transactions" element={<TransactionsPage />} />
                    <Route path="ai" element={<AiInsightsPage />} />
                    <Route path="monthly-reports" element={<MonthlyReportsPage />} />
                    <Route path="monthly-reports/:month" element={<MonthlyReportsPage />} />
                    <Route path="import" element={<ImportPage />} />
                    <Route path="reports" element={<MonthlyReportsPage />} />
                    <Route path="accounts" element={<AccountsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </NavVisibilityProvider>
    </ThemeProvider>
  )
}
