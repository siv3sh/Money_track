import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AdvisorSettingsProvider, useAdvisorSettings } from './hooks/useAdvisorSettings'
import { WealthSettingsProvider, useWealthSettings } from './hooks/useWealthSettings'
import { ThemeProvider } from './hooks/useTheme'
import { NavVisibilityProvider } from './hooks/useNavVisibility'
import { AiInsightsPage } from './pages/AiInsightsPage'
import { AccountsPage } from './pages/AccountsPage'
import { AdminPage } from './pages/AdminPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { DashboardPage } from './pages/DashboardPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { GettingStartedPage } from './pages/GettingStartedPage'
import { ImportPage } from './pages/ImportPage'
import { IndmoneyImportPage } from './pages/IndmoneyImportPage'
import { LoginPage } from './pages/LoginPage'
import { MoneyPlanningPage } from './pages/MoneyPlanningPage'
import { MonthlyReportsPage } from './pages/MonthlyReportsPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
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

/** First visit home → Getting Started until they finish the guide. */
function RequireOnboardingForHome() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!user.setup_completed) return <Navigate to="/setup" replace />
  if (!user.onboarding_completed) return <Navigate to="/getting-started" replace />
  return <Outlet />
}

function RequireAdvisorEnabled() {
  const { enabled } = useAdvisorSettings()
  if (!enabled) return <Navigate to="/profile" replace />
  return <Outlet />
}

function RequireWealthEnabled() {
  const { enabled } = useWealthSettings()
  if (!enabled) return <Navigate to="/profile" replace />
  return <Outlet />
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <NavVisibilityProvider>
          <AdvisorSettingsProvider>
            <WealthSettingsProvider>
              <AuthProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route element={<RequireLogin />}>
                      <Route path="/setup" element={<SetupPage />} />
                      <Route element={<RequireSetupDone />}>
                        <Route element={<AppShell />}>
                          <Route path="getting-started" element={<GettingStartedPage />} />
                          <Route element={<RequireOnboardingForHome />}>
                            <Route index element={<DashboardPage />} />
                            <Route path="dashboard" element={<DashboardPage />} />
                          </Route>
                          <Route element={<RequireWealthEnabled />}>
                            <Route path="wealth" element={<WealthPage />} />
                            <Route path="investments/indmoney" element={<IndmoneyImportPage />} />
                          </Route>
                          <Route path="net-worth" element={<Navigate to="/wealth" replace />} />
                          <Route path="investments" element={<Navigate to="/wealth" replace />} />
                          <Route element={<RequireAdvisorEnabled />}>
                            <Route path="planning" element={<MoneyPlanningPage />} />
                          </Route>
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
                          <Route path="admin" element={<AdminPage />} />
                        </Route>
                      </Route>
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </AuthProvider>
            </WealthSettingsProvider>
          </AdvisorSettingsProvider>
        </NavVisibilityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
