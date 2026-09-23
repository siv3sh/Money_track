import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  List,
  PieChart,
  Smartphone,
  Upload,
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
  title: 'Welcome to Tally',
  subtitle:
    'Your UPI/SMS ledger that doesn’t lie — connect bank alerts, confirm amounts, and see real spending. No bank password.',
}

export const GUIDE_SETUP_STEPS: Array<{ title: string; body: string; to?: string; cta?: string }> = [
  {
    title: '1. Connect bank SMS',
    body: 'Copy your private SMS link from Phones & email into Shortcuts (iPhone) or MacroDroid (Android).',
    to: '/accounts',
    cta: 'Open Phones & email',
  },
  {
    title: '2. Confirm the first SMS',
    body: 'Wait for one real bank alert, then open Transactions and check the amount and debit/credit sign.',
    to: '/transactions',
    cta: 'View Transactions',
  },
  {
    title: '3. Fix a few categories',
    body: 'Recategorize 3–5 merchants so Spending stays accurate. Tally learns from your corrections.',
    to: '/transactions',
    cta: 'Categorize',
  },
  {
    title: '4. Optional: email or history',
    body: 'Paste a bank email on Phones & email, or import a CSV/PDF for older data.',
    to: '/accounts',
    cta: 'Phones & email',
  },
]

export const GUIDE_FEATURES: GuideFeature[] = [
  {
    id: 'dashboard',
    title: 'Home',
    description: 'Cash pulse — spent, received, net, and the latest bank alerts.',
    to: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'spending',
    title: 'Spending',
    description: 'Where it went — categories, then merchants. Click to open the rows.',
    to: '/spending',
    icon: PieChart,
  },
  {
    id: 'transactions',
    title: 'Transactions',
    description: 'Every SMS and import — search, filter, fix categories.',
    to: '/transactions',
    icon: List,
  },
  {
    id: 'accounts',
    title: 'Phones & email',
    description: 'Copy SMS links, paste bank emails, set Gmail forward.',
    to: '/accounts',
    icon: Smartphone,
  },
  {
    id: 'import',
    title: 'Import',
    description: 'Statement CSV/PDF when you need history before SMS started.',
    to: '/import',
    icon: Upload,
  },
]

export const GUIDE_CHECKLIST: GuideChecklistItem[] = [
  {
    id: 'sms',
    title: 'Confirm an SMS arrived',
    description: 'One real debit/credit in Transactions with the right ₹ amount.',
    to: '/transactions',
  },
  {
    id: 'categorize',
    title: 'Fix a few categories',
    description: 'Recategorize 3–5 merchants so Spending is trustworthy.',
    to: '/transactions',
  },
  {
    id: 'profile',
    title: 'Optional: salary keywords',
    description: 'Add employer/salary words in Profile so credits label cleanly.',
    to: '/profile',
  },
]

export const GUIDE_TIPS: string[] = [
  'Trust the ledger first — amount and sign matter more than charts.',
  'Private SMS links are secret — rotate in Accounts if leaked.',
  'Tally is not a bank and not financial advice.',
]
