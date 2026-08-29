import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  createLinkedAccount,
  fetchLinkedAccounts,
  saveSetup,
  updateLinkedAccount,
  type LinkedAccount,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { LoadingBlock, PageHeader } from '../components/ui'

type Platform = 'ios' | 'android'

export function SetupPage() {
  const { user, loading, setUser, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [label, setLabel] = useState('My phone')
  const [phone, setPhone] = useState('')
  const [account, setAccount] = useState<LinkedAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return
    void (async () => {
      try {
        const res = await fetchLinkedAccounts(true)
        if (res.items[0]) {
          setAccount(res.items[0])
          if (res.items[0].label) setLabel(res.items[0].label)
          if (res.items[0].identifier && res.items[0].identifier !== 'primary') {
            setPhone(res.items[0].identifier)
          }
        }
      } catch {
        /* ignore until accounts exist */
      }
    })()
  }, [user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
        <LoadingBlock />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.setup_completed) return <Navigate to="/" replace />

  const webhookUrl = account?.webhook_url || ''

  const choosePlatform = (p: Platform) => {
    setPlatform(p)
    setStep(2)
    setError(null)
  }

  const createLink = async () => {
    if (!platform) return
    setBusy(true)
    setError(null)
    const nextLabel = label.trim() || 'My phone'
    const nextId = phone.trim() || `phone-${platform}`
    try {
      if (account?.id) {
        const updated = await updateLinkedAccount(account.id, {
          label: nextLabel,
          identifier: nextId,
          platform,
        })
        setAccount(updated)
      } else {
        const created = await createLinkedAccount({
          label: nextLabel,
          identifier: nextId,
          kind: 'phone',
          platform,
        })
        setAccount(created)
      }
      setStep(3)
    } catch (err) {
      try {
        const res = await fetchLinkedAccounts(true)
        if (res.items[0]) {
          setAccount(res.items[0])
          setStep(3)
          return
        }
      } catch {
        /* fall through */
      }
      setError(err instanceof Error ? err.message : 'Could not create link')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!platform) return
    setBusy(true)
    setError(null)
    try {
      const next = await saveSetup({ platform, setup_completed: true })
      setUser(next)
      await refreshUser()
      navigate('/accounts', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save setup')
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = async () => {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — long-press the link and copy manually')
    }
  }

  return (
    <div className="fade-in mx-auto max-w-2xl px-4 py-8">
      <PageHeader
        title="Set up Money Track"
        description="We’ll ask a few easy questions. No tech skills needed — follow the numbered steps."
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5">
          <h2 className="text-lg font-semibold text-[var(--text)]">1. Which phone sends your bank SMS?</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Pick the phone that receives messages like “Rs 500 spent…” from your bank.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" className="btn h-auto flex-col gap-1 py-4" onClick={() => choosePlatform('ios')}>
              <span className="text-base font-semibold">iPhone</span>
              <span className="text-xs font-normal text-[var(--muted)]">Uses Apple Shortcuts</span>
            </button>
            <button
              type="button"
              className="btn h-auto flex-col gap-1 py-4"
              onClick={() => choosePlatform('android')}
            >
              <span className="text-base font-semibold">Android</span>
              <span className="text-xs font-normal text-[var(--muted)]">Uses MacroDroid or Tasker</span>
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && platform ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5">
          <h2 className="text-lg font-semibold">2. Name this phone</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Example: “Personal Pixel” or “Work iPhone”. You can add more phones later.
          </p>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Phone nickname"
            />
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number (optional, e.g. +91…)"
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void createLink()}>
              {busy ? 'Creating…' : 'Create my SMS link'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && platform ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5">
            <h2 className="text-lg font-semibold">3. Copy your private SMS link</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              This link is like a mailbox key for <strong>{label}</strong>. Don’t share it publicly.
            </p>
            <div className="mt-3 break-all rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-xs">
              {webhookUrl || 'Loading link…'}
            </div>
            <button type="button" className="btn mt-3" disabled={!webhookUrl} onClick={() => void copyUrl()}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>

          {platform === 'ios' ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5">
              <h2 className="text-lg font-semibold">4. iPhone — do this on the phone</h2>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-[var(--text)]">
                <li>Open the built-in <strong>Shortcuts</strong> app.</li>
                <li>Tap <strong>Automation</strong> → <strong>+</strong> → <strong>Message</strong> / SMS received (or “Message”).</li>
                <li>Choose when a message arrives (you can start with “Any Sender”, then tighten later).</li>
                <li>
                  Add action <strong>Get Contents of URL</strong>.
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
                    <li>URL = paste the private link you copied</li>
                    <li>Method = <strong>POST</strong> (important — not GET)</li>
                    <li>Request Body = JSON</li>
                    <li>
                      Fields: <code>sender</code> = Sender, <code>body</code> = Message Contents (blue chips)
                    </li>
                  </ul>
                </li>
                <li>Turn off “Ask Before Running” if you want it fully automatic.</li>
                <li>Send yourself a test bank SMS (or wait for a real one). Then open Money Track Dashboard.</li>
              </ol>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5">
              <h2 className="text-lg font-semibold">4. Android — do this on the phone</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Easiest free app for most people: <strong>MacroDroid</strong> (Play Store). Tasker also works.
              </p>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                <li>Install <strong>MacroDroid</strong> and allow SMS / notification permissions it asks for.</li>
                <li>Create a new macro → Trigger: <strong>SMS Received</strong>.</li>
                <li>
                  Action: <strong>HTTP Request</strong>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
                    <li>Method = <strong>POST</strong></li>
                    <li>URL = paste your private Money Track link</li>
                    <li>Content type = application/json</li>
                    <li>
                      Body example:{' '}
                      <code className="break-all">
                        {"{ \"sender\": \"[sms_from]\", \"body\": \"[sms_body]\" }"}
                      </code>{' '}
                      (use MacroDroid’s magic text for sender & body)
                    </li>
                  </ul>
                </li>
                <li>
                  In phone <strong>Battery</strong> settings, allow MacroDroid to run in the background (otherwise
                  Android may stop it).
                </li>
                <li>Wait for a real bank SMS, then open Money Track Dashboard to confirm it arrived.</li>
              </ol>
            </div>
          )}

          <button type="button" className="btn" disabled={busy} onClick={() => void finish()}>
            {busy ? 'Saving…' : 'I’ve finished — take me to Accounts'}
          </button>
        </section>
      ) : null}
    </div>
  )
}
