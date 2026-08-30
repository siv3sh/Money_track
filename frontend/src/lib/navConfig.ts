import {
  ArrowLeftRight,
  FileText,
  LayoutDashboard,
  List,
  PieChart,
  Smartphone,
  Sparkles,
  Target,
  Upload,
  Wallet,
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

/** Side nav only — Profile lives in the top-right avatar menu. */
export const APP_NAV: NavItem[] = [
  { id: 'dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { id: 'wealth', to: '/wealth', label: 'Wealth', icon: Wallet },
  { id: 'planning', to: '/planning', label: 'Advisor', icon: Target },
  { id: 'cash-flow', to: '/cash-flow', label: 'Cash Flow', icon: ArrowLeftRight },
  { id: 'spending', to: '/spending', label: 'Spending', icon: PieChart },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: List },
  { id: 'ai', to: '/ai', label: 'AI Insights', icon: Sparkles },
  { id: 'monthly-reports', to: '/monthly-reports', label: 'Reports', icon: FileText },
  { id: 'import', to: '/import', label: 'Import', icon: Upload },
  { id: 'accounts', to: '/accounts', label: 'Phones & email', icon: Smartphone },
]
