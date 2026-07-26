import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AiInsightsPage } from './pages/AiInsightsPage'
import { AlertsPage } from './pages/AlertsPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { IndmoneyImportPage } from './pages/IndmoneyImportPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { MonthlyReportsPage } from './pages/MonthlyReportsPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { SourcesPage } from './pages/SourcesPage'
import { SpendingPage } from './pages/SpendingPage'
import { TransactionsPage } from './pages/TransactionsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="net-worth" element={<NetWorthPage />} />
          <Route path="cash-flow" element={<CashFlowPage />} />
          <Route path="spending" element={<SpendingPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="investments" element={<InvestmentsPage />} />
          <Route path="investments/indmoney" element={<IndmoneyImportPage />} />
          <Route path="ai" element={<AiInsightsPage />} />
          <Route path="monthly-reports" element={<MonthlyReportsPage />} />
          <Route path="monthly-reports/:month" element={<MonthlyReportsPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="reports" element={<MonthlyReportsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
