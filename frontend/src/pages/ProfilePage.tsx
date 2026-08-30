import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Circle, Sparkles, UserRound, Wallet } from 'lucide-react'
import {
  createLearnedFact,
  deleteLearnedFact,
  deletePlanningGoal,
  fetchAdvisorTraining,
  fetchLearnedFacts,
  fetchPlanningSummary,
  saveAdvisorTraining,
  type AdvisorTrainingQuestion,
  type LearnedFact,
  type PlanningGoal,
} from '../api'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { useAdvisorSettings } from '../hooks/useAdvisorSettings'
import { useWealthSettings } from '../hooks/useWealthSettings'

const RELATION_OPTIONS = ['Mom', 'Dad', 'Spouse', 'Sibling', 'Family', 'Friend', 'Roommate', 'Other']

export function ProfilePage() {
  const { enabled: advisorEnabled, setEnabled: setAdvisorEnabled } = useAdvisorSettings()
  const { enabled: wealthEnabled, setEnabled: setWealthEnabled } = useWealthSettings()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const [employer, setEmployer] = useState('')
  const [salaryKeywords, setSalaryKeywords] = useState('')
  const [expectedNet, setExpectedNet] = useState('')
  const [ctcLpa, setCtcLpa] = useState('')
  const [designation, setDesignation] = useState('')

  const [trainingQs, setTrainingQs] = useState<AdvisorTrainingQuestion[]>([])
  const [trainAnswers, setTrainAnswers] = useState<Record<string, string>>({})
  const [completeness, setCompleteness] = useState(0)

  const [people, setPeople] = useState<LearnedFact[]>([])
  const [personName, setPersonName] = useState('')
  const [personRelation, setPersonRelation] = useState('Family')
  const [personAliases, setPersonAliases] = useState('')

  const [budgets, setBudgets] = useState<LearnedFact[]>([])
  const [budgetCat, setBudgetCat] = useState('Shopping')
  const [budgetAmt, setBudgetAmt] = useState('')

  const [goals, setGoals] = useState<PlanningGoal[]>([])
  const [motivationFactId, setMotivationFactId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [factsRes, training, planning] = await Promise.all([
        fetchLearnedFacts(),
        fetchAdvisorTraining(),
        fetchPlanningSummary(),
      ])
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

      setTrainingQs(training.questions || [])
      setCompleteness(Number(training.completeness || 0))
      const answers: Record<string, string> = {}
      for (const q of training.questions || []) {
        answers[q.key] = String(q.value || '')
      }
      setTrainAnswers(answers)

      setPeople(factsRes.facts.filter((f) => f.fact_type === 'people_relation'))
      setBudgets(factsRes.facts.filter((f) => f.fact_type === 'budget_target'))

      const motFact = factsRes.facts.find(
        (f) => f.fact_type === 'advisor_profile' && f.key === 'motivation',
      )
      setMotivationFactId(motFact?.id || null)
      setGoals((planning.goals || []).filter((g) => g.status !== 'completed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
      {
        id: 'coach',
        done: completeness >= 50,
        label: 'Coach profile halfway done',
        tip: 'Advisor uses your soft spot & motivation',
      },
      {
        id: 'goal',
        done: goals.length > 0,
        label: 'A savings goal',
        tip: 'Optional — add under Advisor anytime',
      },
    ]
    const done = items.filter((i) => i.done).length
    return { items, done, total: items.length }
  }, [employer, salaryKeywords, people.length, completeness, goals.length])

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

  const saveCoach = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const answers = Object.entries(trainAnswers)
        .map(([key, value]) => ({ key, value: value.trim() }))
        .filter((a) => a.value)
      if (!answers.length) {
        setError('Answer at least one coaching question')
        return
      }
      await saveAdvisorTraining(answers)
      flash('Coach profile saved')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save coach profile')
    } finally {
      setBusy(false)
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

  const removeGoal = async (goal: PlanningGoal) => {
    if (!confirm(`Remove goal “${goal.name}”?`)) return
    setBusy(true)
    setError(null)
    try {
      await deletePlanningGoal(goal.id)
      if (
        motivationFactId &&
        (trainAnswers.motivation || '').trim().toLowerCase() === goal.name.trim().toLowerCase()
      ) {
        await deleteLearnedFact(motivationFactId)
      }
      flash(`Removed “${goal.name}”`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove goal')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingBlock />

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        title="Your profile"
        description="A short checklist so Money Track understands your salary, family, and goals — no tech skills needed."
      />

      <ChartCard
        title="Money Advisor"
        subtitle="Turn the floating chat, banners, comments, and Advisor page on or off."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)]">
              <Sparkles size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">
                {advisorEnabled ? 'Advisor is on' : 'Advisor is off'}
              </p>
              <p className="mt-0.5 max-w-md text-xs text-[var(--muted)]">
                {advisorEnabled
                  ? 'Chat, nudges, voice banners, and the Advisor page are available.'
                  : 'All advisor UI is hidden. Goals and salary settings on this page still work.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={advisorEnabled}
            aria-label={advisorEnabled ? 'Turn advisor off' : 'Turn advisor on'}
            onClick={() => {
              setAdvisorEnabled(!advisorEnabled)
              flash(advisorEnabled ? 'Advisor turned off' : 'Advisor turned on')
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
              advisorEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                advisorEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </ChartCard>

      <ChartCard
        title="Wealth"
        subtitle="Show or hide the Wealth page and INDmoney import."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)]">
              <Wallet size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">
                {wealthEnabled ? 'Wealth is on' : 'Wealth is off'}
              </p>
              <p className="mt-0.5 max-w-md text-xs text-[var(--muted)]">
                {wealthEnabled
                  ? 'Net worth, holdings, and INDmoney import stay in the menu.'
                  : 'Wealth and INDmoney pages are hidden until you turn this back on.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wealthEnabled}
            aria-label={wealthEnabled ? 'Turn wealth off' : 'Turn wealth on'}
            onClick={() => {
              setWealthEnabled(!wealthEnabled)
              flash(wealthEnabled ? 'Wealth turned off' : 'Wealth turned on')
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
              wealthEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                wealthEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </ChartCard>

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-xl border border-[var(--credit)]/30 bg-[var(--credit-soft)] px-4 py-3 text-sm text-[var(--credit)]">
          {saved}
        </div>
      ) : null}

      <ChartCard
        title={`Setup progress · ${checklist.done}/${checklist.total}`}
        subtitle="Tick these once — the app gets smarter for you"
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

      {advisorEnabled ? (
      <ChartCard
        title="3. How the advisor coaches you"
        subtitle={`${Math.round(completeness)}% complete — answer what feels useful`}
      >
        <form className="grid max-w-xl gap-3" onSubmit={(e) => void saveCoach(e)}>
          {trainingQs.map((q) => (
            <label key={q.key} className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">{q.prompt}</span>
              {q.options?.length ? (
                <select
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  value={trainAnswers[q.key] || ''}
                  onChange={(e) => setTrainAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {q.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  value={trainAnswers[q.key] || ''}
                  onChange={(e) => setTrainAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                  placeholder={q.placeholder || ''}
                />
              )}
              {q.hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{q.hint}</span> : null}
            </label>
          ))}
          <button type="submit" className="btn self-start" disabled={busy}>
            Save coach answers
          </button>
        </form>
      </ChartCard>
      ) : null}

      <ChartCard title="4. Monthly budget caps" subtitle="Soft limits the advisor watches — change anytime">
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

      <ChartCard title="5. Savings goals" subtitle="Remove anything you no longer want tracked">
        {goals.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No active goals. Add one under Advisor when ready.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {goals.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-[var(--text)]">{g.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {g.target_date ? `Target ${g.target_date}` : 'No date'}
                    {g.manual_price || g.target_price
                      ? ` · ₹${Number(g.manual_price || g.target_price).toLocaleString('en-IN')}`
                      : ''}
                  </p>
                </div>
                <button type="button" className="btn text-xs" disabled={busy} onClick={() => void removeGoal(g)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>

      <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <UserRound size={14} />
        Tip: use the avatar (top right) for Customize menu, Dark mode, and Sign out.
      </p>
    </div>
  )
}
