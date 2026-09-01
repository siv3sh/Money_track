import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Copy, Mail } from 'lucide-react'
import { GuideSteps } from './GuideSteps'
import type { LinkedAccount } from '../api'
import { GMAIL_BANK_FILTER, GMAIL_FORWARD_STEPS } from '../lib/setupGuide'
import { ChartCard } from './ui'

type Props = {
  primary: LinkedAccount | undefined
  inboundConfigured: boolean
  busy: boolean
  emailFrom: string
  emailSubject: string
  emailText: string
  onEmailFrom: (v: string) => void
  onEmailSubject: (v: string) => void
  onEmailText: (v: string) => void
  onPasteSubmit: (e: FormEvent) => void
  onCopy: (text: string | null | undefined, id: string) => void
  copiedId: string | null
}

export function BankEmailSetupCard({
  primary,
  inboundConfigured,
  busy,
  emailFrom,
  emailSubject,
  emailText,
  onEmailFrom,
  onEmailSubject,
  onEmailText,
  onPasteSubmit,
  onCopy,
  copiedId,
}: Props) {
  const [showPaste, setShowPaste] = useState(!inboundConfigured)
  const forwardAddress = primary?.inbound_email ?? null
  const hasActivity = Boolean(primary?.last_seen_at)
  const liveReady = inboundConfigured && forwardAddress

  return (
    <ChartCard
      title="Bank alert emails"
      subtitle={
        liveReady
          ? 'Forward bank emails once — we read them automatically'
          : 'Try paste below now; auto-forward unlocks when live parsing is enabled on the server'
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            liveReady
              ? 'bg-[var(--credit-soft)] text-[var(--credit)]'
              : 'bg-[var(--surface-2)] text-[var(--muted)]'
          }`}
        >
          {liveReady ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--credit)]" aria-hidden />
              Auto-forward ready
            </>
          ) : (
            'Paste mode'
          )}
        </span>
        <Link
          to="/getting-started"
          className="text-xs font-medium text-[var(--sapphire)] underline-offset-2 hover:underline"
        >
          Full setup guide →
        </Link>
      </div>

      {hasActivity ? (
        <p className="mb-4 text-xs text-[var(--muted)]">
          Last activity {new Date(primary!.last_seen_at!).toLocaleString('en-IN')}
        </p>
      ) : (
        <p className="mb-4 text-xs text-[var(--muted)]">No bank email or SMS received yet</p>
      )}

      {liveReady ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--sapphire)]/20 bg-[var(--accent-soft)] p-4">
            <p className="mb-2 text-sm font-medium text-[var(--text)]">Your forwarding address</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 break-all rounded-lg bg-[var(--sheet)] px-3 py-2.5 text-sm text-[var(--sapphire)]">
                {forwardAddress}
              </code>
              <button
                type="button"
                className="btn btn-primary shrink-0 justify-center gap-2"
                onClick={() => onCopy(forwardAddress, 'forward-addr')}
              >
                {copiedId === 'forward-addr' ? (
                  <>
                    <Check size={16} aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={16} aria-hidden />
                    Copy address
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-3 text-sm font-medium text-[var(--text)]">Gmail filter (copy this into From)</p>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start">
              <code className="block flex-1 break-all rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-[11px]">
                {GMAIL_BANK_FILTER}
              </code>
              <button
                type="button"
                className="btn shrink-0 text-xs"
                onClick={() => onCopy(GMAIL_BANK_FILTER, 'gmail-filter')}
              >
                {copiedId === 'gmail-filter' ? 'Copied' : 'Copy filter'}
              </button>
            </div>
            <GuideSteps steps={GMAIL_FORWARD_STEPS.slice(1)} startAt={2} />
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--muted)]">
          <p className="font-medium text-[var(--text)]">No auto-forward yet?</p>
          <p className="mt-1">
            Copy any bank alert email and paste it below — same result as automatic. See{' '}
            <Link to="/getting-started" className="font-medium text-[var(--sapphire)] hover:underline">
              setup guide
            </Link>{' '}
            Part 3 for Gmail forwarding when it is enabled.
          </p>
        </div>
      )}

      <button
        type="button"
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
        onClick={() => setShowPaste((v) => !v)}
        aria-expanded={showPaste}
      >
        <span className="flex items-center gap-2">
          <Mail size={16} className="text-[var(--sapphire)]" aria-hidden />
          {liveReady ? 'Or paste one email to test' : 'Paste a bank email now'}
        </span>
        <ChevronDown
          size={16}
          className={`text-[var(--muted)] transition-transform ${showPaste ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {showPaste ? (
        <form className="mt-3 grid max-w-2xl gap-3" onSubmit={onPasteSubmit}>
          <input
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="From (optional) — e.g. alerts@hdfcbank.net"
            value={emailFrom}
            onChange={(e) => onEmailFrom(e.target.value)}
          />
          <input
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Subject (optional)"
            value={emailSubject}
            onChange={(e) => onEmailSubject(e.target.value)}
          />
          <textarea
            className="min-h-[120px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Paste the email body — the part with Rs / INR / debited / credited…"
            value={emailText}
            onChange={(e) => onEmailText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary self-start" disabled={busy}>
            {busy ? 'Saving…' : 'Save to Transactions'}
          </button>
        </form>
      ) : null}

      {primary?.email_webhook_url ? (
        <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
            Advanced — Zapier / developers only
          </summary>
          <p className="mt-2 break-all font-mono text-[11px] text-[var(--muted)]">
            {primary.email_webhook_url}
          </p>
        </details>
      ) : null}
    </ChartCard>
  )
}
