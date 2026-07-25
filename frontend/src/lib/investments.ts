/** Seed portfolio used when no dedicated investments API exists. */

export type AssetClass = 'Equity' | 'Debt' | 'Gold' | 'International' | 'Cash'

export interface SipHolding {
  id: string
  name: string
  assetClass: AssetClass
  invested: number
  current: number
  xirr: number
  startDate: string
  monthlySip: number
}

export interface EquityHolding {
  symbol: string
  name: string
  qty: number
  avgPrice: number
  ltp: number
  invested: number
  current: number
  pnl: number
  pnlPct: number
  cagr: number
}

export interface AssetGrowthPoint {
  month: string
  label: string
  Equity: number
  Debt: number
  Gold: number
  International: number
  Cash: number
}

export interface PortfolioSnapshot {
  sips: SipHolding[]
  equities: EquityHolding[]
  allocation: Array<{ name: AssetClass; value: number }>
  growth: AssetGrowthPoint[]
  overallXirr: number
  overallCagr: number
  totalInvested: number
  totalCurrent: number
  investmentToIncome: Array<{ month: string; label: string; ratio: number; invested: number; income: number }>
}

function monthLabels(count: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = count - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    const ym = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
    out.push(ym)
  }
  return out
}

function label(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

export function buildDemoPortfolio(monthlyIncomeHint = 120000): PortfolioSnapshot {
  const sips: SipHolding[] = [
    {
      id: 'sip-1',
      name: 'Parag Parikh Flexi Cap',
      assetClass: 'Equity',
      invested: 180000,
      current: 214200,
      xirr: 18.4,
      startDate: '2023-01-05',
      monthlySip: 10000,
    },
    {
      id: 'sip-2',
      name: 'UTI Nifty 50 Index',
      assetClass: 'Equity',
      invested: 144000,
      current: 168480,
      xirr: 15.2,
      startDate: '2023-03-10',
      monthlySip: 8000,
    },
    {
      id: 'sip-3',
      name: 'ICICI Pru Corporate Bond',
      assetClass: 'Debt',
      invested: 90000,
      current: 97200,
      xirr: 7.1,
      startDate: '2023-06-01',
      monthlySip: 5000,
    },
    {
      id: 'sip-4',
      name: 'Nippon India ETF Gold BeES',
      assetClass: 'Gold',
      invested: 48000,
      current: 55680,
      xirr: 12.6,
      startDate: '2024-01-15',
      monthlySip: 4000,
    },
    {
      id: 'sip-5',
      name: 'Motilal Oswal Nasdaq 100',
      assetClass: 'International',
      invested: 60000,
      current: 71400,
      xirr: 16.8,
      startDate: '2023-09-01',
      monthlySip: 5000,
    },
  ]

  const equities: EquityHolding[] = [
    {
      symbol: 'RELIANCE',
      name: 'Reliance Industries',
      qty: 25,
      avgPrice: 2450,
      ltp: 2780,
      invested: 61250,
      current: 69500,
      pnl: 8250,
      pnlPct: 13.5,
      cagr: 14.2,
    },
    {
      symbol: 'INFY',
      name: 'Infosys',
      qty: 40,
      avgPrice: 1480,
      ltp: 1625,
      invested: 59200,
      current: 65000,
      pnl: 5800,
      pnlPct: 9.8,
      cagr: 11.1,
    },
    {
      symbol: 'HDFCBANK',
      name: 'HDFC Bank',
      qty: 30,
      avgPrice: 1620,
      ltp: 1540,
      invested: 48600,
      current: 46200,
      pnl: -2400,
      pnlPct: -4.9,
      cagr: -3.2,
    },
    {
      symbol: 'TCS',
      name: 'Tata Consultancy',
      qty: 15,
      avgPrice: 3650,
      ltp: 3920,
      invested: 54750,
      current: 58800,
      pnl: 4050,
      pnlPct: 7.4,
      cagr: 8.6,
    },
    {
      symbol: 'ASIANPAINT',
      name: 'Asian Paints',
      qty: 20,
      avgPrice: 3100,
      ltp: 2880,
      invested: 62000,
      current: 57600,
      pnl: -4400,
      pnlPct: -7.1,
      cagr: -5.4,
    },
  ]

  const byClass = new Map<AssetClass, number>()
  for (const s of sips) {
    byClass.set(s.assetClass, (byClass.get(s.assetClass) || 0) + s.current)
  }
  byClass.set('Equity', (byClass.get('Equity') || 0) + equities.reduce((a, e) => a + e.current, 0))
  byClass.set('Cash', 45000)

  const allocation = ([...byClass.entries()] as Array<[AssetClass, number]>).map(
    ([name, value]) => ({ name, value }),
  )

  const months = monthLabels(12)
  let eq = 280000
  let debt = 70000
  let gold = 35000
  let intl = 40000
  let cash = 50000
  const growth: AssetGrowthPoint[] = months.map((m, i) => {
    eq *= 1 + (0.01 + (i % 3) * 0.004)
    debt *= 1.0055
    gold *= 1 + (i % 2 === 0 ? 0.012 : 0.004)
    intl *= 1 + (0.008 + (i % 4) * 0.003)
    cash = 45000 + i * 800
    return {
      month: m,
      label: label(m),
      Equity: Math.round(eq),
      Debt: Math.round(debt),
      Gold: Math.round(gold),
      International: Math.round(intl),
      Cash: Math.round(cash),
    }
  })

  const totalInvested =
    sips.reduce((a, s) => a + s.invested, 0) + equities.reduce((a, e) => a + e.invested, 0)
  const totalCurrent =
    sips.reduce((a, s) => a + s.current, 0) +
    equities.reduce((a, e) => a + e.current, 0) +
    (byClass.get('Cash') || 0)

  const sipInvestedMonthly = sips.reduce((a, s) => a + s.monthlySip, 0)
  const investmentToIncome = months.map((m, i) => {
    const income = monthlyIncomeHint * (0.95 + (i % 5) * 0.02)
    const invested = sipInvestedMonthly + (i % 4 === 0 ? 15000 : 0)
    return {
      month: m,
      label: label(m),
      invested,
      income,
      ratio: income > 0 ? (invested / income) * 100 : 0,
    }
  })

  return {
    sips,
    equities,
    allocation,
    growth,
    overallXirr: 14.8,
    overallCagr: 13.2,
    totalInvested,
    totalCurrent,
    investmentToIncome,
  }
}
