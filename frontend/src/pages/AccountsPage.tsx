import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createLinkedAccount,
  deleteLinkedAccount,
  fetchLinkedAccounts,
  pasteBankEmail,
  rotateLinkedAccountToken,
  type LinkedAccount,
} from '../api'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'

export function AccountsPage() {
  const [items, setItems] = useState<LinkedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [platform, setPlatform] = useState<'ios' | 'android'>('android')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [emailFrom, setEmailFrom] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailText, setEmailText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLinkedAccounts(true)
      setItems(res.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const flashOk = (msg: string) => {
    setOkMsg(msg)
    setTimeout(() => setOkMsg(null), 3500)
  }

  const onAdd = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createLinkedAccount({
        label: label.trim() || 'Phone',
        identifier: identifier.trim() || `phone-${Date.now()}`,
        kind: 'phone',
        platform,
      })
      setLabel('')
      setIdentifier('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add account')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string | null | undefined, id: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError('Copy failed — select the link text manually')
    }
  }

  const onPasteEmail = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailText.trim() && !emailSubject.trim()) {
      setError('Paste the email body (or at least the subject + body text)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await pasteBankEmail({
        from: emailFrom.trim() || undefined,
        subject: emailSubject.trim() || undefined,
        text: emailText.trim(),
      })
      if (res.stored) {
        flashOk(`Saved email transaction${res.transaction?.amount != null ? ` · ₹${res.transaction.amount}` : ''}`)
        setEmailText('')
        setEmailSubject('')
      } else {
        setError(res.reason || res.hint || 'Email was not stored as a transaction')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email paste failed')
    } finally {
      setBusy(false)
    }
  }

  const primary = items[0]

  return (
    <div className="fade-in">
      <PageHeader
        title="Phones & email"
        description="Each phone gets a private SMS link. Bank alert emails can use a matching email link — or paste one email to try it."
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="mb-4 rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-sm text-[var(--credit)]">
          {okMsg}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <ChartCard title="Linked phones" subtitle="Copy the SMS link into Shortcuts / MacroDroid">
            {items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No phones yet — add one below or finish Setup.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((row) => (
                  <li key={row.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--text)]">{row.label}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {row.identifier}
                          {row.platform ? ` · ${row.platform}` : ''}
                          {row.last_seen_at
                            ? ` · last activity ${new Date(row.last_seen_at).toLocaleString('en-IN')}`
                            : ' · waiting for first SMS/email'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn text-xs"
                          onClick={() => void copy(row.webhook_url, `${row.id}-sms`)}
                        >
                          {copiedId === `${row.id}-sms` ? 'Copied' : 'Copy SMS link'}
                        </button>
                        <button
                          type="button"
                          className="btn text-xs"
                          onClick={() => void copy(row.email_webhook_url, `${row.id}-email`)}
                        >
                          {copiedId === `${row.id}-email` ? 'Copied' : 'Copy email link'}
                        </button>
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={busy}
                          onClick={() =>
                            void (async () => {
                              setBusy(true)
                              try {
                                await rotateLinkedAccountToken(row.id)
                                await load()
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Rotate failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }
                        >
                          New links
                        </button>
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={busy || items.length <= 1}
                          onClick={() =>
                            void (async () => {
                              if (!confirm('Remove this phone link? SMS/email from it will stop arriving.')) return
                              setBusy(true)
                              try {
                                await deleteLinkedAccount(row.id)
                                await load()
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Remove failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <p className="break-all rounded-lg bg-[var(--surface-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--muted)]">
                      SMS: {row.webhook_url}
                    </p>
                    <p className="break-all rounded-lg bg-[var(--surface-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--muted)]">
                      Email: {row.email_webhook_url}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>

          <ChartCard
            title="Bank alert emails"
            subtitle="Paste one email to test — or auto-forward using the email link above"
          >
            <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
              <li>
                Easiest: open a bank / credit-card alert email → copy the text → paste below → Save.
              </li>
              <li>
                Automatic: point Resend Inbound, Zapier, or Make to your <strong>email link</strong>
                {primary?.email_webhook_url ? ' (copied from the phone card)' : ''} with JSON fields{' '}
                <code>from</code>, <code>subject</code>, <code>text</code>.
              </li>
              <li>
                Gmail tip: create a filter for bank alerts → forward to an inbound address that POSTs to
                that link (or keep pasting until you set that up).
              </li>
            </ol>
            <form className="grid max-w-2xl gap-3" onSubmit={(e) => void onPasteEmail(e)}>
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                placeholder="From (optional) — e.g. alerts@hdfcbank.net"
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
              />
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                placeholder="Subject (optional)"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
              <textarea
                className="min-h-[140px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs"
                placeholder="Paste the full email body here (the part with Rs / INR / spent / credited)…"
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
              />
              <button type="submit" className="btn self-start" disabled={busy}>
                {busy ? 'Parsing…' : 'Parse & save email'}
              </button>
            </form>
          </ChartCard>

          <ChartCard title="Add another phone" subtitle="Wife’s SIM, work phone, second Android, etc.">
            <form className="grid max-w-lg gap-3" onSubmit={(e) => void onAdd(e)}>
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                placeholder="Nickname (e.g. Work Pixel)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                placeholder="Phone number or short id"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
              <select
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as 'ios' | 'android')}
              >
                <option value="android">Android</option>
                <option value="ios">iPhone</option>
              </select>
              <button type="submit" className="btn self-start" disabled={busy}>
                {busy ? 'Adding…' : 'Add phone'}
              </button>
            </form>
          </ChartCard>

          <ChartCard
            title="Need the phone steps again?"
            subtitle="Plain English — do this on the phone that receives bank SMS"
          >
            <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-sm font-medium">iPhone (Shortcuts)</summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
                <li>Open the Shortcuts app.</li>
                <li>Tap Automation → + → Message / SMS received.</li>
                <li>Add “Get Contents of URL” → Method POST → paste your private SMS link.</li>
                <li>
                  JSON body with fields <code>sender</code> and <code>body</code> from the message.
                </li>
                <li>Turn off “Ask Before Running” if you want it automatic.</li>
              </ol>
            </details>
            <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-sm font-medium">Android (MacroDroid)</summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
                <li>Install MacroDroid from the Play Store and allow SMS permission.</li>
                <li>New macro → Trigger: SMS Received.</li>
                <li>Action: HTTP Request → POST → paste your private SMS link.</li>
                <li>
                  Body like{' '}
                  <code className="break-all">{"{ \"sender\": \"[sms_from]\", \"body\": \"[sms_body]\" }"}</code>
                </li>
                <li>In Battery settings, allow MacroDroid to run in the background.</li>
              </ol>
            </details>
          </ChartCard>
        </div>
      )}
    </div>
  )
}
