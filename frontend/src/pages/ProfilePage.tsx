import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Circle, UserRound } from 'lucide-react'
import {
  changePasswordRequest,
  createLearnedFact,
  deleteAccountRequest,
  deleteLearnedFact,
  fetchLearnedFacts,
  setStoredToken,
  type LearnedFact,
} from '../api'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const RELATION_OPTIONS = ['Mom', 'Dad', 'Spouse', 'Sibling', 'Family', 'Friend', 'Roommate', 'Other']

/** Customer main Profile — salary labels, people, budgets. No Wealth/Advisor/AI. */
export function ProfilePage() {
  const { logout, setUser, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const [employer, setEmployer] = useState('')
  const [salaryKeywords, setSalaryKeywords] = useState('')
  const [expectedNet, setExpectedNet] = useState('')
  const [ctcLpa, setCtcLpa] = useState('')
  const [designation, setDesignation] = useState('')
  const [incomeBaseline, setIncomeBaseline] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [people, setPeople] = useState<LearnedFact[]>([])
  const [personName, setPersonName] = useState('')
  const [personRelation, setPersonRelation] = useState('Family')
  const [personAliases, setPersonAliases] = useState('')

  const [budgets, setBudgets] = useState<LearnedFact[]>([])
  const [budgetCat, setBudgetCat] = useState('Shopping')
  const [budgetAmt, setBudgetAmt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const factsRes = await fetchLearnedFacts()
      const income = factsRes.facts.filter((f) => f.fact_type === 'income_profile')
      const byKey = Object.fromEntries(income.map((f) => [f.key, f.value]))
      setEmployer(String(byKey.employer || ''))
      setSalaryKeywords(String(byKey.salary_keywords || byKey.salary_sms_words || ''))
      setExpectedNet(
        byKey.expected_net_monthly != null && byKey.expected_net_monthly !== ''
          ? String(byKey.expected_net_monthly)
          : '',
      )
      setCtcLpa(byKey.ctc_lpa != null && byKey.ctc_lpa !== '' ? String(byKey.ctc_lpa) : '')
      setDesignation(String(byKey.designation || ''))
      setIncomeBaseline(
        JSON.stringify({
          employer: String(byKey.employer || ''),
          salaryKeywords: String(byKey.salary_keywords || byKey.salary_sms_words || ''),
          expectedNet:
            byKey.expected_net_monthly != null && byKey.expected_net_monthly !== ''
              ? String(byKey.expected_net_monthly)
              : '',
          ctcLpa: byKey.ctc_lpa != null && byKey.ctc_lpa !== '' ? String(byKey.ctc_lpa) : '',
          designation: String(byKey.designation || ''),
        }),
      )

      setPeople(factsRes.facts.filter((f) => f.fact_type === 'people_relation'))
      setBudgets(factsRes.facts.filter((f) => f.fact_type === 'budget_target'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const incomeDirty =
    !loading &&
    incomeBaseline !==
      JSON.stringify({
        employer,
        salaryKeywords,
        expectedNet,
        ctcLpa,
        designation,
      })

  useEffect(() => {
    if (!incomeDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [incomeDirty])

  const flash = (msg: string) => {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2500)
  }

  const checklist = useMemo(() => {
    const items = [
      {
        id: 'salary',
        done: Boolean(employer.trim() || salaryKeywords.trim()),
        label: 'Salary / employer set',
        tip: 'So we know which credits are your paycheck',
      },
      {
        id: 'people',
        done: people.length > 0,
        label: 'At least one family / friend',
        tip: 'Stops mom/dad UPI from looking like income',
      },
    ]
    const done = items.filter((i) => i.done).length
    return { items, done, total: items.length }
  }, [employer, salaryKeywords, people.length])

  const upsertIncome = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const jobs: Array<Promise<unknown>> = []
      const pairs: Array<[string, string | number]> = []
      if (employer.trim()) pairs.push(['employer', employer.trim()])
      if (salaryKeywords.trim()) pairs.push(['salary_keywords', salaryKeywords.trim()])
      if (expectedNet.trim()) {
        pairs.push(['expected_net_monthly', Number(expectedNet.replace(/,/g, '')) || expectedNet.trim()])
      }
      if (ctcLpa.trim()) pairs.push(['ctc_lpa', Number(ctcLpa.replace(/,/g, '')) || ctcLpa.trim()])
      if (designation.trim()) pairs.push(['designation', designation.trim()])
      for (const [key, value] of pairs) {
        jobs.push(createLearnedFact({ fact_type: 'income_profile', key, value, source: 'profile' }))
      }
      if (!jobs.length) {
        setError('Add employer or salary SMS words first')
        return
      }
      await Promise.all(jobs)
      flash('Salary settings saved')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save salary settings')
    } finally {
      setBusy(false)
    }
  }

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault()
    if (deleting) return
    if (deleteConfirm.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE to confirm account removal')
      return
    }
    if (!deletePassword) {
      setError('Enter your password to delete the account')
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await deleteAccountRequest(deletePassword)
      logout()
      window.location.assign('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account')
    } finally {
      setDeleting(false)
    }
  }

  const addPerson = async (e: FormEvent) => {
    e.preventDefault()
    if (!personName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createLearnedFact({
        fact_type: 'people_relation',
        key: personName.trim(),
        value: personRelation,
        source: 'profile',
        meta: personAliases.trim()
          ? { aliases: personAliases.trim(), match_words: personAliases.trim() }
          : undefined,
      })
      setPersonName('')
      setPersonAliases('')
      flash('Person added — their UPI won’t count as income')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add person')
    } finally {
      setBusy(false)
    }
  }

  const addBudget = async (e: FormEvent) => {
    e.preventDefault()
    const amt = Number(budgetAmt.replace(/,/g, ''))
    if (!budgetCat.trim() || !(amt > 0)) {
      setError('Pick a category and a monthly ₹ amount')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createLearnedFact({
        fact_type: 'budget_target',
        key: budgetCat.trim(),
        value: amt,
        source: 'profile',
      })
      setBudgetAmt('')
      flash('Budget saved')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save budget')
    } finally {
      setBusy(false)
    }
  }

  const removeFact = async (fact: LearnedFact) => {
    setBusy(true)
    setError(null)
    try {
      await deleteLearnedFact(fact.id)
      flash('Removed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingBlock />

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        title="Your profile"
        description="Salary keywords and people labels so your ledger stays clean."
      />

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]"
        >
          {error}
        </div>
      ) : null}
      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-sm text-[var(--credit)]"
        >
          {saved}
        </div>
      ) : null}

      <ChartCard
        title={`Setup progress · ${checklist.done}/${checklist.total}`}
        subtitle="Optional labels that keep Spending honest"
      >
        <ul className="space-y-2">
          {checklist.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 text-sm">
              {item.done ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--credit)]" />
              ) : (
                <Circle size={18} className="mt-0.5 shrink-0 text-[var(--muted)]" />
              )}
              <div>
                <p className="font-medium text-[var(--text)]">{item.label}</p>
                <p className="text-xs text-[var(--muted)]">{item.tip}</p>
              </div>
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard
        title="1. Money coming in"
        subtitle="Open one salary SMS/email and copy the company words you always see"
      >
        <form className="grid max-w-xl gap-3" onSubmit={(e) => void upsertIncome(e)}>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Employer name (how we show it)</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={employer}
              onChange={(e) => setEmployer(e.target.value)}
              placeholder="e.g. Acme Corp"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Words from salary SMS / email</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={salaryKeywords}
              onChange={(e) => setSalaryKeywords(e.target.value)}
              placeholder="e.g. acme, acme india"
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Separate with commas. Generic words like “salary” already count for everyone.
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Take-home ₹ / month</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                value={expectedNet}
                onChange={(e) => setExpectedNet(e.target.value)}
                inputMode="decimal"
                placeholder="45000"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">CTC LPA (optional)</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                value={ctcLpa}
                onChange={(e) => setCtcLpa(e.target.value)}
                inputMode="decimal"
                placeholder="5"
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Role / designation (optional)</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Software engineer"
            />
          </label>
          <button type="submit" className="btn self-start" disabled={busy}>
            Save salary settings
          </button>
        </form>
      </ChartCard>

      <ChartCard
        title="2. People (family & friends)"
        subtitle="Money to/from these people is a transfer — not shopping or salary"
      >
        {people.length ? (
          <ul className="mb-4 divide-y divide-[var(--border)]">
            {people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium">{p.key}</span>
                  <span className="text-[var(--muted)]"> · {String(p.value)}</span>
                </span>
                <button type="button" className="btn text-xs" disabled={busy} onClick={() => void removeFact(p)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-[var(--muted)]">
            Example: add “Mom” with match words from her UPI name so family support isn’t treated as income.
          </p>
        )}
        <form className="grid max-w-xl gap-3" onSubmit={(e) => void addPerson(e)}>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Name as it appears in SMS/UPI</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="e.g. Geetha"
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Who are they?</span>
            <select
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={personRelation}
              onChange={(e) => setPersonRelation(e.target.value)}
            >
              {RELATION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Extra match words (optional)</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={personAliases}
              onChange={(e) => setPersonAliases(e.target.value)}
              placeholder="Other spellings, comma-separated"
            />
          </label>
          <button type="submit" className="btn self-start" disabled={busy}>
            Add person
          </button>
        </form>
      </ChartCard>

      <ChartCard title="3. Monthly budget caps" subtitle="Soft limits shown on Spending — change anytime">
        {budgets.length ? (
          <ul className="mb-4 divide-y divide-[var(--border)]">
            {budgets.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {b.key} · ₹{Number(b.value).toLocaleString('en-IN')}/mo
                </span>
                <button type="button" className="btn text-xs" disabled={busy} onClick={() => void removeFact(b)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form className="flex max-w-xl flex-wrap items-end gap-2" onSubmit={(e) => void addBudget(e)}>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Category</span>
            <input
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={budgetCat}
              onChange={(e) => setBudgetCat(e.target.value)}
              list="budget-cats"
            />
            <datalist id="budget-cats">
              {['Shopping', 'Food & Dining', 'Entertainment', 'Travel', 'Subscriptions'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">₹ / month</span>
            <input
              className="w-32 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              value={budgetAmt}
              onChange={(e) => setBudgetAmt(e.target.value)}
              inputMode="decimal"
              placeholder="3000"
            />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            Add budget
          </button>
        </form>
      </ChartCard>

      <ChartCard
        title="Change password"
        subtitle={user?.email ? `Signed in as ${user.email}` : 'Update your login password'}
      >
        <form
          className="max-w-xl space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              setError(null)
              if (newPassword.length < 8) {
                setError('New password must be at least 8 characters')
                return
              }
              if (newPassword !== confirmPassword) {
                setError('New passwords do not match')
                return
              }
              setChangingPassword(true)
              try {
                const res = await changePasswordRequest(currentPassword, newPassword)
                setStoredToken(res.access_token)
                setUser(res.user)
                setCurrentPassword('')
                setNewPassword('')
                setConfirmPassword('')
                flash('Password updated')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not change password')
              } finally {
                setChangingPassword(false)
              }
            })()
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Current password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">New password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Confirm new password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={changingPassword || busy}>
            {changingPassword ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </ChartCard>

      <ChartCard
        title="Delete account"
        subtitle="Permanently removes transactions, phones & SMS links, and settings"
      >
        <form className="max-w-xl space-y-3" onSubmit={(e) => void deleteAccount(e)}>
          <p className="text-sm text-[var(--muted)]">
            This cannot be undone. Type <span className="font-semibold text-[var(--text)]">DELETE</span>{' '}
            and enter your password.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Confirmation</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Password</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn text-[var(--debit)]" disabled={deleting || busy}>
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </form>
      </ChartCard>

      <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <UserRound size={14} />
        Tip: use the avatar (top right) for Dark mode and Sign out.
      </p>
    </div>
  )
}
