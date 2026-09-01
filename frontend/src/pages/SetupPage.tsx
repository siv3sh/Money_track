import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  createLinkedAccount,
  fetchLinkedAccounts,
  saveSetup,
  updateLinkedAccount,
  type LinkedAccount,
} from '../api'
import { GuideSteps, SetupProgressBar } from '../components/GuideSteps'
import { useAuth } from '../context/AuthContext'
import { LoadingBlock, PageHeader } from '../components/ui'
import {
  ANDROID_SMS_STEPS,
  IPHONE_SMS_STEPS,
  SETUP_INTRO,
  SETUP_PROGRESS_LABELS,
} from '../lib/setupGuide'

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

  const totalSteps = 4

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
  if (user.setup_completed) {
    return <Navigate to={user.onboarding_completed ? '/' : '/getting-started'} replace />
  }

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
      navigate('/getting-started', { replace: true })
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
      setError('Could not copy — select the link below and copy manually')
    }
  }

  const goBack = () => {
    setError(null)
    if (step === 2) {
      setStep(1)
      setPlatform(null)
    } else if (step === 3) setStep(2)
    else if (step === 4) setStep(3)
  }

  return (
    <div className="fade-in mx-auto max-w-2xl px-4 py-8">
      <PageHeader title={SETUP_INTRO.title} description={SETUP_INTRO.subtitle} />

      <SetupProgressBar step={step} total={totalSteps} />
      <p className="-mt-4 mb-6 text-sm font-medium text-[var(--text)]">{SETUP_PROGRESS_LABELS[step - 1]}</p>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      {step > 1 ? (
        <button
          type="button"
          className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]"
          onClick={goBack}
        >
          <ArrowLeft size={14} aria-hidden />
          Back
        </button>
      ) : null}

      {step === 1 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-1)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">Which phone gets bank SMS?</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Choose the phone that receives texts like “Rs 500 spent at…” from your bank. This is how
            Money Track learns your spending automatically.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="btn h-auto flex-col gap-1 border-2 py-4 transition hover:border-[var(--sapphire)]"
              onClick={() => choosePlatform('ios')}
            >
              <span className="text-base font-semibold">iPhone</span>
              <span className="text-xs font-normal text-[var(--muted)]">Apple Shortcuts (free, built-in)</span>
            </button>
            <button
              type="button"
              className="btn h-auto flex-col gap-1 border-2 py-4 transition hover:border-[var(--sapphire)]"
              onClick={() => choosePlatform('android')}
            >
              <span className="text-base font-semibold">Android</span>
              <span className="text-xs font-normal text-[var(--muted)]">MacroDroid (free app)</span>
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && platform ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-1)]">
          <h2 className="text-lg font-semibold">Name this phone</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            So you can tell phones apart later (e.g. “Personal” vs “Work”). You can add more phones
            anytime under Accounts.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">Nickname</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My phone"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted)]">Phone number (optional)</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile — for your reference only"
              />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void createLink()}>
              {busy ? 'Creating…' : 'Continue → get my SMS link'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && platform ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-1)]">
            <h2 className="text-lg font-semibold">Copy your private SMS link</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              This link is unique to <strong>{label}</strong>. Keep it private — anyone with the link
              could post fake transactions.
            </p>
            <div className="mt-3 break-all rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 font-mono text-xs">
              {webhookUrl || 'Creating link…'}
            </div>
            <button
              type="button"
              className="btn btn-primary mt-3"
              disabled={!webhookUrl}
              onClick={() => void copyUrl()}
            >
              {copied ? 'Copied!' : 'Copy SMS link'}
            </button>
          </div>
          <button type="button" className="btn w-full justify-center" onClick={() => setStep(4)}>
            I copied it — show phone steps
          </button>
        </section>
      ) : null}

      {step === 4 && platform ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-1)]">
            <h2 className="text-lg font-semibold">
              {platform === 'ios' ? 'Set up on your iPhone' : 'Set up on your Android'}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Do these on the phone that receives bank SMS. Come back here when done.
            </p>
            <div className="mt-4">
              <GuideSteps steps={platform === 'ios' ? IPHONE_SMS_STEPS : ANDROID_SMS_STEPS} />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            <p className="font-medium text-[var(--text)]">What about bank emails?</p>
            <p className="mt-1">
              Optional. After you finish here, open{' '}
              <Link to="/accounts" className="font-medium text-[var(--sapphire)] hover:underline">
                Accounts
              </Link>{' '}
              for step-by-step Gmail forwarding — or skip if SMS is enough.
            </p>
          </div>

          <button type="button" className="btn btn-primary w-full justify-center" disabled={busy} onClick={() => void finish()}>
            {busy ? 'Saving…' : 'Done — continue to full guide'}
          </button>
        </section>
      ) : null}
    </div>
  )
}
