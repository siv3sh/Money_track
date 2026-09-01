import { useState, type FormEvent } from 'react'
import { Check, ChevronDown, Copy, Mail } from 'lucide-react'
import type { LinkedAccount } from '../api'
import { ChartCard } from './ui'

const GMAIL_BANK_FILTER =
  'from:(alerts@hdfcbank.net OR alerts@icicibank.com OR notice@axisbank.com OR ebanking@kotak.com OR alerts@sbi.co.in OR notification@yesbank.in)'

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
          : 'Paste an alert to try it now; auto-forward unlocks when live parsing is enabled'
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
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
              Auto-forward available
            </>
          ) : (
            'Paste mode — auto-forward coming soon'
          )}
        </span>
        {hasActivity ? (
          <span className="text-xs text-[var(--muted)]">
            Last activity {new Date(primary!.last_seen_at!).toLocaleString('en-IN')}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">No bank email or SMS received yet</span>
        )}
      </div>

      {liveReady ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--sapphire)]/20 bg-[var(--accent-soft)] p-4">
            <p className="mb-2 text-sm font-medium text-[var(--text)]">
              Step 1 — Copy your personal forwarding address
            </p>
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
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Only bank alerts sent to this address are parsed. Your other mail stays in Gmail.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-3 text-sm font-medium text-[var(--text)]">
              Step 2 — Tell Gmail to forward bank alerts
            </p>
            <ol className="space-y-3 text-sm leading-relaxed text-[var(--muted)]">
              <li className="flex gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text)]">
                  1
                </span>
                <span>
                  Open Gmail → <strong className="text-[var(--text)]">Settings</strong> →{' '}
                  <strong className="text-[var(--text)]">Filters and Blocked Addresses</strong> →{' '}
                  <strong className="text-[var(--text)]">Create a new filter</strong>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text)]">
                  2
                </span>
                <span className="min-w-0 flex-1">
                  In <strong className="text-[var(--text)]">From</strong>, paste this (covers HDFC, ICICI,
                  Axis, Kotak, SBI, Yes Bank):
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
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
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text)]">
                  3
                </span>
                <span>
                  Click <strong className="text-[var(--text)]">Create filter</strong> → tick{' '}
                  <strong className="text-[var(--text)]">Forward it to</strong> → add your address above
                  (Gmail may ask you to verify forwarding once).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text)]">
                  4
                </span>
                <span>
                  Done. The next debit/credit alert should show up in{' '}
                  <strong className="text-[var(--text)]">Transactions</strong> within a few seconds.
                </span>
              </li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--muted)]">
          <p className="font-medium text-[var(--text)]">Try it without setup</p>
          <p className="mt-1">
            Open any bank alert in your mail app, copy the text that mentions the amount (Rs / INR /
            debited / credited), and paste it below. When auto-forward is enabled on the server, you will
            see a personal address here instead.
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
          {liveReady ? 'Or paste one email to test' : 'Paste a bank email'}
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
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="From (optional) — e.g. alerts@hdfcbank.net"
            value={emailFrom}
            onChange={(e) => onEmailFrom(e.target.value)}
          />
          <input
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Subject (optional)"
            value={emailSubject}
            onChange={(e) => onEmailSubject(e.target.value)}
          />
          <textarea
            className="min-h-[120px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-[var(--sapphire)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Paste the email body — the part with the amount and merchant…"
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
            Advanced — for Zapier / Make / developers
          </summary>
          <p className="mt-2 break-all font-mono text-[11px] text-[var(--muted)]">
            {primary.email_webhook_url}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            POST JSON with <code>from</code>, <code>subject</code>, <code>text</code>. Most users should
            use forward address or paste instead.
          </p>
        </details>
      ) : null}
    </ChartCard>
  )
}
