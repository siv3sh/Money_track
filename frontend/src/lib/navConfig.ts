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
  /** Optional extras — off by default in Customise. */
  advanced?: boolean
}

/** Side nav — core ledger first; advanced pages last. Profile is in the avatar menu. */
export const APP_NAV: NavItem[] = [
  { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { id: 'spending', to: '/spending', label: 'Spending', icon: PieChart },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: List },
  { id: 'accounts', to: '/accounts', label: 'Phones & email', icon: Smartphone },
  { id: 'import', to: '/import', label: 'Import', icon: Upload },
  { id: 'cash-flow', to: '/cash-flow', label: 'Cash Flow', icon: ArrowLeftRight, advanced: true },
  { id: 'monthly-reports', to: '/monthly-reports', label: 'Reports', icon: FileText, advanced: true },
  { id: 'wealth', to: '/wealth', label: 'Wealth (optional)', icon: Wallet, advanced: true },
  { id: 'planning', to: '/planning', label: 'Advisor (optional)', icon: Target, advanced: true },
  { id: 'ai', to: '/ai', label: 'Ask Tally (optional)', icon: Sparkles, advanced: true },
]
