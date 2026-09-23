import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import {
  createLinkedAccount,
  fetchLinkedAccounts,
  saveSetup,
  updateLinkedAccount,
  type LinkedAccount,
} from '../api'
import { GuideSteps, SetupProgressBar } from '../components/GuideSteps'
import { useAuth } from '../context/AuthContext'
import { trackEvent } from '../lib/analytics'
import { LoadingBlock, PageHeader } from '../components/ui'
import {
  ANDROID_SMS_JSON_BODY,
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
  const [copied, setCopied] = useState<'url' | 'json' | null>(null)

  const totalSteps = 3

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
          if (res.items[0].platform === 'ios' || res.items[0].platform === 'android') {
            setPlatform(res.items[0].platform)
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
    return <Navigate to="/accounts" replace />
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
      trackEvent('activation_setup_done', { platform })
      navigate('/getting-started', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save setup')
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (text: string, kind: 'url' | 'json') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
      if (kind === 'url') trackEvent('activation_copy_sms_link', { where: 'setup' })
    } catch {
      setError('Could not copy — select the text and copy manually')
    }
  }

  const goBack = () => {
    setError(null)
    if (step === 2) {
      setStep(1)
      setPlatform(null)
    } else if (step === 3) setStep(2)
  }

  return (
    <div className="fade-in mx-auto max-w-2xl px-4 py-8">
      <PageHeader title={SETUP_INTRO.title} description={SETUP_INTRO.subtitle} />

      <SetupProgressBar step={step} total={totalSteps} />
      <p className="-mt-4 mb-6 text-sm font-medium text-[var(--text)]">
        {SETUP_PROGRESS_LABELS[step - 1]}
      </p>

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
            Choose the phone that receives texts like “Rs 500 spent at…” — that is how Tally builds
            your ledger.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="btn h-auto flex-col gap-1 border-2 py-4 transition hover:border-[var(--sapphire)]"
              onClick={() => choosePlatform('ios')}
            >
              <span className="text-base font-semibold">iPhone</span>
              <span className="text-xs font-normal text-[var(--muted)]">
                Apple Shortcuts (built-in, free)
              </span>
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
            Nickname only — add more phones later under Phones & email.
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
                placeholder="10-digit mobile — for your reference"
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void createLink()}
            >
              {busy ? 'Creating…' : 'Continue → get my SMS link'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && platform ? (
        <section className="space-y-4">
          <div className="sticky top-2 z-10 rounded-2xl border border-[var(--sapphire)]/25 bg-[var(--sheet)] p-4 shadow-[var(--elev-1)]">
            <h2 className="text-base font-semibold text-[var(--text)]">Your private SMS link</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Unique to <strong>{label}</strong>. Keep private — anyone with it could post fake
              transactions.
            </p>
            <div className="mt-2 break-all rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px]">
              {webhookUrl || 'Creating link…'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary gap-1.5 text-sm"
                disabled={!webhookUrl}
                onClick={() => void copyText(webhookUrl, 'url')}
              >
                {copied === 'url' ? (
                  <>
                    <Check size={14} aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden />
                    Copy SMS link
                  </>
                )}
              </button>
              {platform === 'android' ? (
                <button
                  type="button"
                  className="btn gap-1.5 text-sm"
                  onClick={() => void copyText(ANDROID_SMS_JSON_BODY, 'json')}
                >
                  {copied === 'json' ? (
                    <>
                      <Check size={14} aria-hidden />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={14} aria-hidden />
                      Copy JSON body
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--sheet)] p-5 shadow-[var(--elev-1)]">
            <h2 className="text-lg font-semibold">
              {platform === 'ios' ? 'On your iPhone' : 'On your Android'}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Follow these on the phone that gets bank SMS. The link stays above so you can copy
              again anytime.
            </p>
            <div className="mt-4">
              <GuideSteps steps={platform === 'ios' ? IPHONE_SMS_STEPS : ANDROID_SMS_STEPS} />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            <p className="font-medium text-[var(--text)]">Bank emails?</p>
            <p className="mt-1">
              Optional. After this, open{' '}
              <Link to="/accounts" className="font-medium text-[var(--sapphire)] hover:underline">
                Phones & email
              </Link>{' '}
              to paste a bank alert or set Gmail forward.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary w-full justify-center"
            disabled={busy}
            onClick={() => void finish()}
          >
            {busy ? 'Saving…' : 'Done — continue to guide'}
          </button>
        </section>
      ) : null}
    </div>
  )
}
