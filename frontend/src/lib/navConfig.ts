import {
  LayoutDashboard,
  List,
  PieChart,
  Smartphone,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { NavPrefId } from '../hooks/useNavVisibility'

export type NavItem = {
  id: NavPrefId
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

/** Customer main — SMS ledger only. Extras stay on the `dev` branch. */
export const APP_NAV: NavItem[] = [
  { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { id: 'spending', to: '/spending', label: 'Spending', icon: PieChart },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: List },
  { id: 'accounts', to: '/accounts', label: 'Phones & email', icon: Smartphone },
  { id: 'import', to: '/import', label: 'Import', icon: Upload },
]
