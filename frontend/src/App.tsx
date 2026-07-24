import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { ReportsPage } from './pages/ReportsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="import" element={<ImportPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
