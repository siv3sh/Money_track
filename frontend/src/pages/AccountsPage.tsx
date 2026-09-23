import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import {
  createLinkedAccount,
  deleteLinkedAccount,
  fetchLinkedAccounts,
  pasteBankEmail,
  rotateLinkedAccountToken,
  type LinkedAccount,
} from '../api'
import { BankEmailSetupCard } from '../components/BankEmailSetupCard'
import { ConnectStatusCard } from '../components/ConnectStatusCard'
import { GuideSteps } from '../components/GuideSteps'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { trackEvent } from '../lib/analytics'
import {
  ANDROID_SMS_JSON_BODY,
  ANDROID_SMS_STEPS,
  IPHONE_SMS_STEPS,
} from '../lib/setupGuide'

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

  const load = useCallback(async (opts?: { expandFirst?: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLinkedAccounts(true)
      setItems(res.items)
      setInboundConfigured(Boolean(res.resend_inbound_configured))
      if (opts?.expandFirst && res.items[0]) {
        setExpandedPhoneId(res.items[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load({ expandFirst: true })
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
      const created = await createLinkedAccount({
        label: label.trim() || 'Phone',
        identifier: identifier.trim() || `phone-${Date.now()}`,
        kind: 'phone',
        platform,
      })
      setLabel('')
      setIdentifier('')
      setExpandedPhoneId(created.id)
      await load()
      flashOk('Phone added — copy the SMS link below')
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
      if (id.endsWith('-sms')) trackEvent('activation_copy_sms_link')
      if (id === 'forward-addr' || id.endsWith('-inbound')) trackEvent('activation_copy_email_address')
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
        trackEvent('activation_email_paste_ok')
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
        title="Phones & email"
        description="Connect bank SMS (main feed) and optional bank emails. One private link per phone."
        actions={
          <Link to="/getting-started" className="btn text-sm">
            Setup guide
          </Link>
        }
      />

      <div className="mb-4 rounded-xl border border-[var(--sapphire)]/20 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--text-secondary)]">
        <p className="font-medium text-[var(--text)]">Your SMS link is a secret</p>
        <p className="mt-1 text-xs leading-relaxed">
          Anyone with the link can post transactions into your ledger. Do not share it in chats or
          screenshots. If it leaks, tap <strong>New links</strong> under the phone.
        </p>
      </div>
      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="mb-4 rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-sm text-[var(--credit)]">
          {okMsg}
          {okMsg.includes('Transactions') ? (
            <>
              {' · '}
              <Link to="/transactions" className="font-medium underline-offset-2 hover:underline">
                Open
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <ConnectStatusCard accounts={items} inboundConfigured={inboundConfigured} />

          <ChartCard
            title="Bank SMS on your phone"
            subtitle="Copy the link → paste into Shortcuts (iPhone) or MacroDroid (Android)"
          >
            {items.length === 0 ? (
              <div className="space-y-3 text-sm text-[var(--muted)]">
                <p>No phone linked yet. Add one below — nickname is enough.</p>
                <Link to="/getting-started" className="btn text-sm">
                  Open setup guide
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((row) => {
                  const expanded = expandedPhoneId === row.id
                  const isAndroid = row.platform === 'android'
                  const isIos = row.platform === 'ios'
                  return (
                    <li key={row.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--text)]">{row.label}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {row.identifier}
                            {row.platform ? ` · ${row.platform === 'ios' ? 'iPhone' : 'Android'}` : ''}
                          </p>
                          <p
                            className={`mt-1 text-xs ${
                              row.last_seen_at ? 'text-[var(--credit)]' : 'text-[var(--muted)]'
                            }`}
                          >
                            {row.last_seen_at
                              ? `Last activity ${new Date(row.last_seen_at).toLocaleString('en-IN')}`
                              : 'Waiting for first SMS — finish phone steps below'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-primary gap-1.5 text-xs"
                            onClick={() => void copy(row.webhook_url, `${row.id}-sms`)}
                          >
                            {copiedId === `${row.id}-sms` ? (
                              <>
                                <Check size={12} aria-hidden />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy size={12} aria-hidden />
                                Copy SMS link
                              </>
                            )}
                          </button>
                          {isAndroid ? (
                            <button
                              type="button"
                              className="btn gap-1.5 text-xs"
                              onClick={() => void copy(ANDROID_SMS_JSON_BODY, `${row.id}-json`)}
                            >
                              {copiedId === `${row.id}-json` ? 'Copied' : 'Copy JSON body'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn text-xs"
                            onClick={() => setExpandedPhoneId(expanded ? null : row.id)}
                          >
                            {expanded ? 'Hide steps' : 'Show steps'}
                          </button>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="mt-3 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <div>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                              SMS link
                            </p>
                            <p className="break-all font-mono text-[11px] text-[var(--muted)]">
                              {row.webhook_url}
                            </p>
                          </div>
                          {isAndroid ? (
                            <div>
                              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                                MacroDroid body
                              </p>
                              <code className="block break-all rounded-lg bg-[var(--surface-2)] px-2 py-1.5 font-mono text-[11px]">
                                {ANDROID_SMS_JSON_BODY}
                              </code>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {row.inbound_email ? (
                              <button
                                type="button"
                                className="btn text-xs"
                                onClick={() => void copy(row.inbound_email, `${row.id}-inbound`)}
                              >
                                {copiedId === `${row.id}-inbound` ? 'Copied' : 'Copy email address'}
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
                                    setError(
                                      err instanceof Error ? err.message : 'Could not refresh links',
                                    )
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
                          <div className="border-t border-[var(--border)] pt-3">
                            {isIos || isAndroid ? (
                              <>
                                <p className="mb-2 text-sm font-medium text-[var(--text)]">
                                  {isIos ? 'iPhone (Shortcuts)' : 'Android (MacroDroid)'}
                                </p>
                                <GuideSteps steps={isIos ? IPHONE_SMS_STEPS : ANDROID_SMS_STEPS} />
                              </>
                            ) : (
                              <div className="space-y-3">
                                <details open className="rounded-lg border border-[var(--border)] p-2">
                                  <summary className="cursor-pointer text-xs font-medium">
                                    iPhone (Shortcuts)
                                  </summary>
                                  <div className="mt-2">
                                    <GuideSteps steps={IPHONE_SMS_STEPS} />
                                  </div>
                                </details>
                                <details className="rounded-lg border border-[var(--border)] p-2">
                                  <summary className="cursor-pointer text-xs font-medium">
                                    Android (MacroDroid)
                                  </summary>
                                  <div className="mt-2">
                                    <GuideSteps steps={ANDROID_SMS_STEPS} />
                                  </div>
                                </details>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </ChartCard>

          <ChartCard title="Add another phone" subtitle="Second SIM, work phone, or family — nickname is enough">
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
                placeholder="Phone number (optional)"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              <select
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as 'ios' | 'android')}
              >
                <option value="android">Android (MacroDroid)</option>
                <option value="ios">iPhone (Shortcuts)</option>
              </select>
              <button type="submit" className="btn btn-primary self-start" disabled={busy}>
                {busy ? 'Adding…' : 'Add phone'}
              </button>
            </form>
          </ChartCard>

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
        </div>
      )}
    </div>
  )
}
