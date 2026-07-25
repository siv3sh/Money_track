import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AlertsPage } from './pages/AlertsPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { ImportPage } from './pages/ImportPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { SourcesPage } from './pages/SourcesPage'
import { SpendingPage } from './pages/SpendingPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<NetWorthPage />} />
          <Route path="cash-flow" element={<CashFlowPage />} />
          <Route path="spending" element={<SpendingPage />} />
          <Route path="investments" element={<InvestmentsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="reports" element={<Navigate to="/spending" replace />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
