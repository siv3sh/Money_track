import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createLinkedAccount,
  deleteLinkedAccount,
  fetchLinkedAccounts,
  pasteBankEmail,
  rotateLinkedAccountToken,
  type LinkedAccount,
} from '../api'
import { BankEmailSetupCard } from '../components/BankEmailSetupCard'
import { GuideSteps } from '../components/GuideSteps'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { ANDROID_SMS_STEPS, IPHONE_SMS_STEPS } from '../lib/setupGuide'

export function AccountsPage() {
  const [items, setItems] = useState<LinkedAccount[]>([])
  const [inboundConfigured, setInboundConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [platform, setPlatform] = useState<'ios' | 'android'>('android')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedPhoneId, setExpandedPhoneId] = useState<string | null>(null)

  const [emailFrom, setEmailFrom] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailText, setEmailText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLinkedAccounts(true)
      setItems(res.items)
      setInboundConfigured(Boolean(res.resend_inbound_configured))
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
      setError('Copy failed — tap the text and copy manually')
    }
  }

  const onPasteEmail = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailText.trim() && !emailSubject.trim()) {
      setError('Paste the email body (the part with the amount)')
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
        flashOk(
          `Saved${res.transaction?.amount != null ? ` · ₹${res.transaction.amount}` : ''} — check Transactions`,
        )
        setEmailText('')
        setEmailSubject('')
        await load()
      } else {
        setError(
          res.reason?.includes('not a bank')
            ? 'That did not look like a transaction email (OTP and promos are ignored).'
            : res.reason || res.hint || 'Could not save this email',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save email')
    } finally {
      setBusy(false)
    }
  }

  const primary = items[0]

  return (
    <div className="fade-in">
      <PageHeader
        title="Accounts"
        description="Your private SMS link and optional bank email forwarding. Stuck? Open the full setup guide."
        actions={
          <Link to="/getting-started" className="btn text-sm">
            Setup guide
          </Link>
        }
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
          <BankEmailSetupCard
            primary={primary}
            inboundConfigured={inboundConfigured}
            busy={busy}
            emailFrom={emailFrom}
            emailSubject={emailSubject}
            emailText={emailText}
            onEmailFrom={setEmailFrom}
            onEmailSubject={setEmailSubject}
            onEmailText={setEmailText}
            onPasteSubmit={(e) => void onPasteEmail(e)}
            onCopy={(text, id) => void copy(text, id)}
            copiedId={copiedId}
          />

          <ChartCard title="Bank SMS on your phone" subtitle="One private link per phone — for Shortcuts or MacroDroid">
            {items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No phone linked yet. Finish <strong>Setup</strong> or add one below.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((row) => {
                  const expanded = expandedPhoneId === row.id
                  return (
                    <li key={row.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--text)]">{row.label}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {row.identifier}
                            {row.platform ? ` · ${row.platform}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {row.last_seen_at
                              ? `Last activity ${new Date(row.last_seen_at).toLocaleString('en-IN')}`
                              : 'Waiting for first SMS'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-primary text-xs"
                            onClick={() => void copy(row.webhook_url, `${row.id}-sms`)}
                          >
                            {copiedId === `${row.id}-sms` ? 'Copied' : 'Copy SMS link'}
                          </button>
                          <button
                            type="button"
                            className="btn text-xs"
                            onClick={() => setExpandedPhoneId(expanded ? null : row.id)}
                          >
                            {expanded ? 'Hide' : 'More'}
                          </button>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <p className="break-all font-mono text-[11px] text-[var(--muted)]">
                            {row.webhook_url}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {row.inbound_email ? (
                              <button
                                type="button"
                                className="btn text-xs"
                                onClick={() => void copy(row.inbound_email, `${row.id}-inbound`)}
                              >
                                {copiedId === `${row.id}-inbound` ? 'Copied' : 'Copy forward address'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn text-xs"
                              disabled={busy}
                              onClick={() =>
                                void (async () => {
                                  if (
                                    !confirm(
                                      'Generate new links? Update Shortcuts/MacroDroid with the new SMS link.',
                                    )
                                  ) {
                                    return
                                  }
                                  setBusy(true)
                                  try {
                                    await rotateLinkedAccountToken(row.id)
                                    await load()
                                    flashOk('New links generated')
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Could not refresh links')
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
                                  if (!confirm('Remove this phone? SMS from it will stop.')) return
                                  setBusy(true)
                                  try {
                                    await deleteLinkedAccount(row.id)
                                    await load()
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Could not remove')
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
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </ChartCard>

          <ChartCard title="Add another phone" subtitle="Second SIM, work phone, family member, etc.">
            <form className="grid max-w-lg gap-3" onSubmit={(e) => void onAdd(e)}>
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                placeholder="Nickname (e.g. Work phone)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
              <input
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                placeholder="Phone number (for your reference)"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
              <select
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
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
            title="SMS setup help"
            subtitle="Detailed steps also in Setup wizard and Help & guide"
          >
            <p className="mb-3 text-sm text-[var(--muted)]">
              <Link to="/getting-started" className="font-medium text-[var(--sapphire)] hover:underline">
                Open the full setup guide
              </Link>{' '}
              for end-to-end instructions including troubleshooting.
            </p>
            <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-sm font-medium">iPhone (Shortcuts)</summary>
              <div className="mt-3">
                <GuideSteps steps={IPHONE_SMS_STEPS} />
              </div>
            </details>
            <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-sm font-medium">Android (MacroDroid)</summary>
              <div className="mt-3">
                <GuideSteps steps={ANDROID_SMS_STEPS} />
              </div>
            </details>
          </ChartCard>
        </div>
      )}
    </div>
  )
}
