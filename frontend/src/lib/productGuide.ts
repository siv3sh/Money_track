import type { LucideIcon } from 'lucide-react'
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
} from 'lucide-react'

export type GuideFeature = {
  id: string
  title: string
  description: string
  to: string
  icon: LucideIcon
  note?: string
}

export type GuideChecklistItem = {
  id: string
  title: string
  description: string
  to?: string
}

export const GUIDE_WELCOME = {
  title: 'Welcome to Money Track',
  subtitle:
    'One place for SMS bank alerts, statements, and portfolio imports — so you can see spend, cash flow, and wealth without spreadsheet chaos.',
}

export const GUIDE_SETUP_STEPS: Array<{ title: string; body: string; to?: string; cta?: string }> = [
  {
    title: '1. Connect bank SMS',
    body: 'Use the setup wizard on your iPhone (Shortcuts) or Android (MacroDroid). This is the main way transactions appear.',
    to: '/setup',
    cta: 'Open setup wizard',
  },
  {
    title: '2. Confirm Transactions',
    body: 'Wait for one real bank SMS, then check Transactions for the correct amount.',
    to: '/transactions',
    cta: 'View Transactions',
  },
  {
    title: '3. Bank emails (optional)',
    body: 'Forward only debit/credit alert emails from Gmail — step-by-step on Accounts.',
    to: '/accounts',
    cta: 'Email setup',
  },
  {
    title: '4. Import history (optional)',
    body: 'Upload a bank CSV/PDF or INDmoney export when you want older data or holdings.',
    to: '/import',
    cta: 'Import',
  },
]

export const GUIDE_FEATURES: GuideFeature[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Period overview of money in and out, with recent activity.',
    to: '/',
    icon: LayoutDashboard,
  },
  {
    id: 'spending',
    title: 'Spending',
    description: 'Categories, trends, merchants, budgets, subscriptions, and anomalies.',
    to: '/spending',
    icon: PieChart,
  },
  {
    id: 'cash-flow',
    title: 'Cash Flow',
    description: 'Credits vs debits and how your balance moves over time.',
    to: '/cash-flow',
    icon: ArrowLeftRight,
  },
  {
    id: 'transactions',
    title: 'Transactions',
    description: 'Search, filter, and recategorize individual SMS and imports.',
    to: '/transactions',
    icon: List,
  },
  {
    id: 'wealth',
    title: 'Wealth',
    description: 'Net worth, holdings, and INDmoney snapshot.',
    to: '/wealth',
    icon: Wallet,
    note: 'Can be turned off in Profile',
  },
  {
    id: 'planning',
    title: 'Advisor',
    description: 'Goals, coaching, and planning with the Money Advisor.',
    to: '/planning',
    icon: Target,
    note: 'Can be turned off in Profile',
  },
  {
    id: 'ai',
    title: 'AI Insights',
    description: 'Ask questions about your spend and get structured answers.',
    to: '/ai',
    icon: Sparkles,
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Monthly digests you can revisit and share.',
    to: '/monthly-reports',
    icon: FileText,
  },
  {
    id: 'import',
    title: 'Import',
    description: 'Bring in statement CSVs and portfolio files.',
    to: '/import',
    icon: Upload,
  },
  {
    id: 'accounts',
    title: 'Phones & email',
    description: 'Manage webhook links, rotate tokens, and add more phones.',
    to: '/accounts',
    icon: Smartphone,
  },
]

export const GUIDE_CHECKLIST: GuideChecklistItem[] = [
  {
    id: 'sms',
    title: 'Confirm an SMS arrived',
    description: 'Send a small bank alert or wait for the next debit — it should show under Transactions.',
    to: '/transactions',
  },
  {
    id: 'categorize',
    title: 'Fix a few categories',
    description: 'Recategorize 3–5 merchants so Spending and budgets stay accurate.',
    to: '/transactions',
  },
  {
    id: 'profile',
    title: 'Set salary & budgets',
    description: 'Add employer/salary keywords and soft category caps in Profile.',
    to: '/profile',
  },
  {
    id: 'wealth',
    title: 'Optional: import Wealth',
    description: 'If you use INDmoney or broker CSVs, import holdings so net worth is complete.',
    to: '/investments/indmoney',
  },
]

export const GUIDE_TIPS: string[] = [
  'Use the date filters on each page to switch Day / Week / Month / Year views.',
  'Profile lets you hide Advisor or Wealth if you want a simpler menu.',
  'Reopen this guide anytime from the avatar menu → Help & guide.',
  'Private SMS links are secret — never post them publicly; rotate in Accounts if leaked.',
]
