import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Mail, Smartphone } from 'lucide-react'
import type { LinkedAccount } from '../api'
import { ChartCard } from './ui'

type Props = {
  accounts: LinkedAccount[]
  inboundConfigured: boolean
  /** Compact strip for Getting Started; fuller card for Accounts. */
  compact?: boolean
}

export function ConnectStatusCard({ accounts, inboundConfigured, compact }: Props) {
  const phones = accounts.filter((a) => a.kind !== 'email')
  const hasPhone = phones.length > 0
  const smsLive = phones.some((a) => Boolean(a.last_seen_at))
  const forwardReady = inboundConfigured && phones.some((a) => Boolean(a.inbound_email))

  const items = [
    {
      id: 'phone',
      done: hasPhone,
      label: hasPhone ? 'Phone linked' : 'Link a phone',
      hint: hasPhone ? 'Private SMS link ready' : 'Create your SMS link first',
      to: '/accounts',
      icon: Smartphone,
    },
    {
      id: 'sms',
      done: smsLive,
      label: smsLive ? 'First SMS received' : 'Waiting for first bank SMS',
      hint: smsLive
        ? 'Automation is working — check Transactions'
        : 'Paste the link into Shortcuts / MacroDroid, then wait for a bank alert',
      to: smsLive ? '/transactions' : '/accounts',
      icon: Smartphone,
    },
    {
      id: 'email',
      done: forwardReady,
      label: forwardReady ? 'Email auto-forward ready' : 'Bank email (optional)',
      hint: forwardReady
        ? 'Copy your address and add a Gmail filter'
        : 'Paste one bank email anytime — auto-forward when available',
      to: '/accounts',
      icon: Mail,
    },
  ] as const

  const doneCount = items.filter((i) => i.done).length

  return (
    <ChartCard
      title={compact ? 'Connect status' : 'Get connected'}
      subtitle={
        compact
          ? `${doneCount} of ${items.length} ready`
          : 'SMS first — email is optional. Tap an item for the next step.'
      }
    >
      <ul className={compact ? 'space-y-2' : 'space-y-3'}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 transition hover:border-[var(--sapphire)]/40 hover:bg-[var(--sheet)]"
            >
              {item.done ? (
                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0 text-[var(--credit)]"
                  aria-hidden
                />
              ) : (
                <Circle size={18} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text)]">{item.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{item.hint}</span>
              </span>
              <item.icon size={14} className="mt-1 shrink-0 text-[var(--muted)]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
