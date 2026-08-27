import { useEffect, useRef, useState } from 'react'
import { formatINR } from '../lib/format'

export type PlaqueTone = 'credit' | 'debit' | 'wealth' | 'sapphire' | 'neutral'
/** @deprecated Prefer PlaqueTone; `brass` maps to wealth. */
export type LedgerRail = 'credit' | 'debit' | 'brass' | 'wealth' | 'sapphire' | 'neutral'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function normalizeTone(rail: LedgerRail | PlaqueTone): PlaqueTone {
  if (rail === 'brass') return 'wealth'
  return rail
}

function formatSignedINR(value: number, signed: boolean): string {
  const abs = formatINR(Math.abs(value))
  if (!signed) return formatINR(value)
  if (value > 0) return `+${abs}`
  if (value < 0) return `−${abs}`
  return formatINR(0)
}

export function LedgerAmount({
  amount,
  rail = 'neutral',
  animate = false,
  signed = false,
  size = 'md',
  className = '',
}: {
  amount: number
  rail?: LedgerRail | PlaqueTone
  /** Count-up once when amount/animate key changes; respects prefers-reduced-motion. */
  animate?: boolean
  signed?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const tone = normalizeTone(rail)
  const [display, setDisplay] = useState(() => (animate && !prefersReducedMotion() ? 0 : amount))
  const frameRef = useRef<number | null>(null)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (!animate || reduced) {
      setDisplay(amount)
      return
    }

    const from = 0
    const to = amount
    const duration = 720
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [amount, animate, reduced])

  const sizeClass =
    size === 'lg'
      ? 'text-2xl sm:text-[1.65rem]'
      : size === 'sm'
        ? 'text-sm'
        : 'text-xl sm:text-2xl'

  return (
    <div className={`rupee-plaque rupee-plaque--${tone} ${className}`.trim()}>
      <span className="rupee-plaque__bar" aria-hidden />
      <p className={`rupee-plaque__value ${sizeClass}`}>{formatSignedINR(display, signed)}</p>
    </div>
  )
}
