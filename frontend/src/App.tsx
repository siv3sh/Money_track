import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './hooks/useTheme'
import { NavVisibilityProvider } from './hooks/useNavVisibility'
import { AccountsPage } from './pages/AccountsPage'
import { AdminPage } from './pages/AdminPage'
import { DashboardPage } from './pages/DashboardPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { GettingStartedPage } from './pages/GettingStartedPage'
import { ImportPage } from './pages/ImportPage'
import { LandingPage } from './pages/LandingPage'
import { PrivacyPage, TermsPage } from './pages/LegalPages'
import { LoginPage } from './pages/LoginPage'
import { PricingPage } from './pages/PricingPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SetupPage } from './pages/SetupPage'
import { SpendingPage } from './pages/SpendingPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { ProfilePage } from './pages/ProfilePage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
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

/** Customer main: SMS ledger only. Wealth / Advisor / AI / Cash Flow / Reports live on `dev`. */
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <NavVisibilityProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route element={<RequireLogin />}>
                  <Route path="/setup" element={<SetupPage />} />
                  <Route element={<RequireSetupDone />}>
                    <Route element={<AppShell />}>
                      <Route path="getting-started" element={<GettingStartedPage />} />
                      <Route element={<RequireOnboardingForHome />}>
                        <Route path="dashboard" element={<DashboardPage />} />
                      </Route>
                      <Route path="spending" element={<SpendingPage />} />
                      <Route path="transactions" element={<TransactionsPage />} />
                      <Route path="import" element={<ImportPage />} />
                      <Route path="accounts" element={<AccountsPage />} />
                      <Route path="profile" element={<ProfilePage />} />
                      <Route path="admin" element={<AdminPage />} />
                      {/* Old bookmarks → core app */}
                      <Route path="wealth" element={<Navigate to="/dashboard" replace />} />
                      <Route path="net-worth" element={<Navigate to="/dashboard" replace />} />
                      <Route path="investments" element={<Navigate to="/dashboard" replace />} />
                      <Route path="investments/indmoney" element={<Navigate to="/import" replace />} />
                      <Route path="planning" element={<Navigate to="/profile" replace />} />
                      <Route path="ai" element={<Navigate to="/dashboard" replace />} />
                      <Route path="cash-flow" element={<Navigate to="/dashboard" replace />} />
                      <Route path="monthly-reports" element={<Navigate to="/dashboard" replace />} />
                      <Route path="monthly-reports/:month" element={<Navigate to="/dashboard" replace />} />
                      <Route path="reports" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </NavVisibilityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
