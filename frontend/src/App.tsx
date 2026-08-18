import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AiInsightsPage } from './pages/AiInsightsPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { IndmoneyImportPage } from './pages/IndmoneyImportPage'
import { MoneyPlanningPage } from './pages/MoneyPlanningPage'
import { MonthlyReportsPage } from './pages/MonthlyReportsPage'
import { SpendingPage } from './pages/SpendingPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { WealthPage } from './pages/WealthPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
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
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
