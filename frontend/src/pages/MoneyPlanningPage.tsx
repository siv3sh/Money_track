import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react'
import {
  completePlanningGoal,
  contributePlanningGoal,
  createPlanningGoal,
  deletePlanningGoal,
  fetchAdvisorPersona,
  fetchAdvisorTraining,
  fetchPlanningSummary,
  lookupPlanningGoalPrice,
  reorderPlanningGoals,
  saveAdvisorPersona,
  saveAdvisorTraining,
  savePlanningSettings,
  updatePlanningGoal,
  type AdvisorPersonaSettings,
  type AdvisorTrainingQuestion,
  type PlanningBucket,
  type PlanningGoal,
  type PlanningSummary,
} from '../api'
import { GroupedComparisonBars } from '../components/charts'
import { ChartCard, KpiCard, LoadingBlock, PageHeader } from '../components/ui'
import { LedgerAmount } from '../components/LedgerAmount'
import { AdvisorCommentBubble } from '../components/AdvisorCommentBubble'
import { formatINR } from '../lib/format'

const BUCKETS: PlanningBucket[] = ['Needs', 'Investments', 'Discretionary', 'Buffer']

function BucketBand({
  label,
  wealthClass,
  actual,
  template,
}: {
  label: string
  wealthClass?: string
  actual: number
  template: number
}) {
  const pct = template > 0 ? Math.min(140, Math.round((actual / template) * 100)) : 0
  const over = actual > template && template > 0
  return (
    <div className="elev-sheet px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{label}</p>
          {wealthClass ? (
            <p className="text-[11px] capitalize text-[var(--muted)]">{wealthClass}</p>
          ) : null}
        </div>
        <div className="text-right text-xs tabular-nums text-[var(--muted)]">
          <span className={over ? 'font-semibold text-[var(--debit)]' : 'text-[var(--text)]'}>
            {formatINR(actual)}
          </span>
          {' / '}
          {formatINR(template)}
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-[var(--surface-3)]">
        <div
          className={`h-full rounded-sm transition-[width] duration-300 ${
            over ? 'bg-[var(--debit)]' : 'bg-[var(--sapphire)]'
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}

function GoalProgressBar({ pct, milestones = [25, 50, 75, 100] }: { pct: number; milestones?: number[] }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="relative mt-3 h-2.5 w-full rounded-sm bg-[var(--surface-3)]">
      <div
        className="absolute inset-y-0 left-0 rounded-sm bg-[var(--sapphire)] transition-[width] duration-300"
        style={{ width: `${clamped}%` }}
      />
      {milestones.map((m) => (
        <span
          key={m}
          title={`${m}%`}
          className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--border-strong)]"
          style={{ left: `${m}%` }}
        />
      ))}
    </div>
  )
}

export function MoneyPlanningPage() {
  const [data, setData] = useState<PlanningSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showFramework, setShowFramework] = useState(false)
  const [pctDraft, setPctDraft] = useState<Record<PlanningBucket, number> | null>(null)

  const [goalName, setGoalName] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [goalPrice, setGoalPrice] = useState('')
  const [lookupOnCreate, setLookupOnCreate] = useState(true)
  const [pendingConfirm, setPendingConfirm] = useState<PlanningGoal | null>(null)
  const [confirmPrice, setConfirmPrice] = useState('')
  const [contribDrafts, setContribDrafts] = useState<Record<string, string>>({})
  const [showTrain, setShowTrain] = useState(false)
  const [trainQs, setTrainQs] = useState<AdvisorTrainingQuestion[]>([])
  const [trainDrafts, setTrainDrafts] = useState<Record<string, string>>({})
  const [trainCompleteness, setTrainCompleteness] = useState(0)
  const [showStyle, setShowStyle] = useState(false)
  const [persona, setPersona] = useState<AdvisorPersonaSettings | null>(null)
  const [sensDraft, setSensDraft] = useState(50)
  const [personaDraft, setPersonaDraft] = useState('')
  const [showAdvancedPersona, setShowAdvancedPersona] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const summary = await fetchPlanningSummary()
      setData(summary)
      setPctDraft(summary.settings.bucket_pcts)

      const [trainingRes, personaRes] = await Promise.allSettled([
        fetchAdvisorTraining(),
        fetchAdvisorPersona(),
      ])

      if (trainingRes.status === 'fulfilled') {
        const training = trainingRes.value
        setTrainQs(training.questions)
        setTrainCompleteness(training.completeness)
        const drafts: Record<string, string> = {}
        for (const q of training.questions) {
          drafts[q.key] = q.value ? String(q.value) : ''
        }
        setTrainDrafts(drafts)
        if (training.completeness < 50) setShowTrain(true)
      }

      if (personaRes.status === 'fulfilled') {
        const personaCfg = personaRes.value
        setPersona(personaCfg)
        setSensDraft(personaCfg.strictness_sensitivity)
        setPersonaDraft(personaCfg.persona_text)
      }

      const softFails = [trainingRes, personaRes]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
      if (softFails.length) {
        setError(`Advisor extras partially unavailable: ${softFails[0]}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load planning')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chartData = useMemo(
    () =>
      (data?.framework.comparison || []).map((c) => ({
        name: c.bucket,
        template: c.template_inr,
        actual: c.actual_inr,
      })),
    [data],
  )

  const activeGoals = useMemo(
    () => (data?.goals || []).filter((g) => g.status === 'active' || g.status === 'paused'),
    [data],
  )

  const advisor = data?.advisor
  const focus = advisor?.focus_goal

  async function saveTraining() {
    const answers = Object.entries(trainDrafts)
      .map(([key, value]) => ({ key, value: value.trim() }))
      .filter((a) => a.value.length > 0)
    if (!answers.length) return
    setBusy('train')
    try {
      const res = await saveAdvisorTraining(answers)
      setTrainQs(res.training.questions)
      setTrainCompleteness(res.training.completeness)
      await load()
      setShowTrain(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save training')
    } finally {
      setBusy(null)
    }
  }

  async function savePcts() {
    if (!pctDraft) return
    setBusy('settings')
    try {
      await savePlanningSettings({ bucket_pcts: pctDraft })
      await load()
      setShowSettings(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings')
    } finally {
      setBusy(null)
    }
  }

  async function saveStyle(opts?: { reset?: boolean }) {
    setBusy('style')
    try {
      await saveAdvisorPersona({
        strictness_sensitivity: sensDraft,
        persona_text: showAdvancedPersona ? personaDraft : undefined,
        reset_persona_to_default: Boolean(opts?.reset),
      })
      const full = await fetchAdvisorPersona()
      setPersona(full)
      setSensDraft(full.strictness_sensitivity)
      setPersonaDraft(full.persona_text)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save advisor style')
    } finally {
      setBusy(null)
    }
  }

  async function onCreateGoal(e: FormEvent) {
    e.preventDefault()
    if (!goalName.trim()) return
    setBusy('create')
    setError(null)
    try {
      const manual = goalPrice.trim() ? Number(goalPrice) : undefined
      const res = await createPlanningGoal({
        name: goalName.trim(),
        target_date: goalDate || undefined,
        manual_price: manual != null && !Number.isNaN(manual) ? manual : undefined,
        lookup_price: lookupOnCreate && manual == null,
      })
      setGoalName('')
      setGoalDate('')
      setGoalPrice('')
      if (res.needs_price_confirm && res.goal.price_lookup) {
        setPendingConfirm(res.goal)
        setConfirmPrice(String(res.goal.price_lookup.approx_price_inr || res.goal.target_price || ''))
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create goal')
    } finally {
      setBusy(null)
    }
  }

  async function confirmPendingPrice() {
    if (!pendingConfirm) return
    setBusy('confirm')
    try {
      const price = Number(confirmPrice)
      await updatePlanningGoal(pendingConfirm.id, {
        manual_price: Number.isFinite(price) ? price : undefined,
        confirm_price: true,
      })
      setPendingConfirm(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm price')
    } finally {
      setBusy(null)
    }
  }

  async function moveGoal(id: string, dir: -1 | 1) {
    const ids = activeGoals.map((g) => g.id)
    const idx = ids.indexOf(id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= ids.length) return
    ;[ids[idx], ids[swap]] = [ids[swap], ids[idx]]
    setBusy(`reorder-${id}`)
    try {
      const summary = await reorderPlanningGoals(ids)
      setData(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorder failed')
    } finally {
      setBusy(null)
    }
  }

  async function onLookup(id: string) {
    setBusy(`lookup-${id}`)
    try {
      const res = await lookupPlanningGoalPrice(id)
      setPendingConfirm(res.goal)
      setConfirmPrice(String(res.lookup?.approx_price_inr || res.goal.target_price || ''))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Price lookup failed')
    } finally {
      setBusy(null)
    }
  }

  const [actionComment, setActionComment] = useState<string | null>(null)

  async function onContribute(id: string, amount?: number) {
    const raw = amount != null ? String(amount) : contribDrafts[id]
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a contribution amount')
      return
    }
    setBusy(`contrib-${id}`)
    try {
      const res = await contributePlanningGoal(id, value)
      setContribDrafts((d) => ({ ...d, [id]: '' }))
      setActionComment(res.advisor_comment?.comment || null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contribution failed')
    } finally {
      setBusy(null)
    }
  }

  async function onComplete(id: string) {
    if (!window.confirm('Mark complete? Logs as liability-class Shopping spend in your ledger.')) return
    setBusy(`complete-${id}`)
    try {
      const res = await completePlanningGoal(id)
      setActionComment(res.advisor_comment?.comment || res.note || null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed')
    } finally {
      setBusy(null)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this goal?')) return
    setBusy(`del-${id}`)
    try {
      await deletePlanningGoal(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  const fw = data?.framework

  return (
    <div className="fade-in">
      <PageHeader
        title="Money Advisor"
        description="Your planning coach — pay yourself first, cut what blocks goals, auto-split on salary day. Investments stay protected."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => setShowTrain((s) => !s)}>
              <Sparkles size={16} />
              Train me ({Math.round(trainCompleteness)}%)
            </button>
            <button type="button" className="btn" onClick={() => setShowStyle((s) => !s)}>
              <Settings2 size={16} />
              Advisor Style
            </button>
            <button type="button" className="btn" onClick={() => setShowFramework((s) => !s)}>
              <Wallet size={16} />
              Framework
            </button>
            <button type="button" className="btn" onClick={() => setShowSettings((s) => !s)}>
              <Settings2 size={16} />
              Percents
            </button>
          </div>
        }
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}
      {actionComment ? (
        <div className="mb-4">
          <AdvisorCommentBubble comment={actionComment} />
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingBlock />
      ) : data && fw ? (
        <>
          {showSettings && pctDraft ? (
            <section className="elev-sheet mb-5 px-4 py-4">
              <h2 className="text-sm font-semibold">Budget template %</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Default 45 / 27 / 17 / 7 · Goals only use Discretionary + Buffer
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {BUCKETS.map((b) => (
                  <label key={b} className="text-xs text-[var(--muted)]">
                    {b}
                    <input
                      className="field mt-1"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={pctDraft[b]}
                      onChange={(e) =>
                        setPctDraft((prev) => (prev ? { ...prev, [b]: Number(e.target.value) } : prev))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-primary" disabled={busy === 'settings'} onClick={() => void savePcts()}>
                  {busy === 'settings' ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setShowSettings(false)}>
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {showStyle ? (
            <section className="elev-sheet mb-5 px-4 py-4">
              <h2 className="text-sm font-semibold">Advisor Style</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Controls how quickly firm/strict tone kicks in across reports, alerts, Q&A, and this page.
                Severity is computed from your real rule history — the model only matches tone.
              </p>
              <label className="mt-4 block text-xs text-[var(--muted)]">
                Strictness sensitivity · {sensDraft}
                <span className="mt-1 block text-[11px]">
                  Lower = more patience before firmness · Higher = firm sooner
                </span>
                <input
                  className="mt-2 w-full"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={sensDraft}
                  onChange={(e) => setSensDraft(Number(e.target.value))}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPreviewOpen((v) => !v)}
                >
                  {previewOpen ? 'Hide' : 'Preview'} sample tones
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAdvancedPersona((v) => !v)}
                >
                  {showAdvancedPersona ? 'Hide' : 'Edit'} persona prompt
                </button>
              </div>
              {previewOpen && persona?.preview?.samples ? (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {(
                    [
                      ['informational', 'Informational'],
                      ['concerned', 'Concerned'],
                      ['strict', 'Strict'],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {label}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--text)]">
                        {persona.preview?.samples[key]}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {showAdvancedPersona ? (
                <label className="mt-4 block text-xs text-[var(--muted)]">
                  Persona system prompt (advanced)
                  <textarea
                    className="field mt-1 min-h-[160px] font-mono text-[11px]"
                    value={personaDraft}
                    onChange={(e) => setPersonaDraft(e.target.value)}
                  />
                  <span className="mt-1 block text-[11px]">
                    Version {persona?.version ?? 1}
                    {persona?.using_file_default ? ' · using file default' : ''}
                  </span>
                </label>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === 'style'}
                  onClick={() => void saveStyle()}
                >
                  {busy === 'style' ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                  Save style
                </button>
                {showAdvancedPersona ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === 'style'}
                    onClick={() => void saveStyle({ reset: true })}
                  >
                    Reset persona to default
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => setShowStyle(false)}>
                  Close
                </button>
              </div>
            </section>
          ) : null}

          {showTrain ? (
            <section className="elev-sheet mb-5 px-4 py-4">
              <h2 className="text-sm font-semibold">Train your advisor</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                The more honest you are, the more I sound like someone who knows you — soft when you’ve earned it, strict when you slip.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {trainQs.map((q) => (
                  <label key={q.key} className="text-xs text-[var(--muted)]">
                    {q.prompt}
                    {q.options?.length ? (
                      <select
                        className="field mt-1"
                        value={trainDrafts[q.key] || ''}
                        onChange={(e) => setTrainDrafts((d) => ({ ...d, [q.key]: e.target.value }))}
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
                        className="field mt-1"
                        placeholder={q.placeholder}
                        value={trainDrafts[q.key] || ''}
                        onChange={(e) => setTrainDrafts((d) => ({ ...d, [q.key]: e.target.value }))}
                      />
                    )}
                    {q.hint ? <span className="mt-1 block text-[11px] text-[var(--muted)]">{q.hint}</span> : null}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" className="btn btn-primary" disabled={busy === 'train'} onClick={() => void saveTraining()}>
                  {busy === 'train' ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                  Save & know me
                </button>
                <button type="button" className="btn" onClick={() => setShowTrain(false)}>
                  Close
                </button>
              </div>
            </section>
          ) : null}

          {/* Quiet advisor ribbon — not a hero card */}
          {advisor ? (
            <div
              className={`mb-5 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-[var(--sapphire)] bg-[var(--sheet)] px-4 py-2.5 shadow-[var(--elev-1)] ${
                advisor.advisor_severity?.level === 'strict' ||
                advisor.voice?.mood === 'strict' ||
                advisor.voice?.mood === 'firm'
                  ? 'border-l-[var(--debit)]'
                  : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sapphire)]">
                  Advisor · {data.label}
                  {advisor.advisor_severity?.level || advisor.voice?.mood
                    ? ` · ${advisor.advisor_severity?.level || advisor.voice?.mood}`
                    : ''}
                </p>
                <p className="mt-0.5 truncate text-sm text-[var(--text)]">
                  {advisor.voice?.opener || advisor.headline}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Discipline</p>
                  <p className="font-mono text-lg font-semibold tabular-nums text-[var(--text)]">
                    {advisor.score}
                  </p>
                </div>
                <p className="text-[10px] text-[var(--muted)]">
                  Knows you {Math.round(advisor.profile?.completeness || trainCompleteness)}%
                </p>
              </div>
            </div>
          ) : null}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Income base"
              value={formatINR(fw.income_base)}
              amount={fw.income_base}
              tone="credit"
              animate
              hint="Take-home used for plan"
            />
            <KpiCard
              label="Surplus now"
              value={formatINR(fw.available_surplus)}
              amount={fw.available_surplus}
              animate
              hint={
                (fw.disc_overshoot || 0) > 0
                  ? `Blocked — Disc ₹${Math.round(fw.disc_overshoot || 0).toLocaleString('en-IN')} over`
                  : 'Ready for goals'
              }
              tone={fw.available_surplus > 0 ? 'credit' : 'debit'}
            />
            <KpiCard
              label="Unlock if on plan"
              value={formatINR(fw.surplus_if_on_plan || 0)}
              amount={fw.surplus_if_on_plan || 0}
              tone="credit"
              animate
              hint="After cutting Discretionary overshoot"
            />
            <KpiCard
              label="Buffer leftover"
              value={formatINR(data.liquid_buffer_estimate)}
              amount={data.liquid_buffer_estimate}
              rail="wealth"
              animate
              hint="Lump-sum candidate"
            />
          </div>

          {/* Bucket bands */}
          <div className="mb-5 space-y-2">
            <div className="flex items-end justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text)]">Buckets</h3>
              <button type="button" className="btn text-xs" onClick={() => setShowFramework((s) => !s)}>
                {showFramework ? 'Hide chart' : 'Show chart'}
              </button>
            </div>
            {fw.comparison.map((row) => (
              <BucketBand
                key={row.bucket}
                label={row.bucket}
                wealthClass={row.wealth_class}
                actual={row.actual_inr}
                template={row.template_inr}
              />
            ))}
          </div>

          {focus ? (
            <section className="elev-sheet mb-5 px-4 py-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Primary goal</p>
                  <h3 className="display text-xl font-semibold">{focus.name}</h3>
                </div>
                <LedgerAmount
                  amount={focus.saved}
                  rail="sapphire"
                  size="md"
                  className="py-1"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                of {formatINR(focus.target)} · {focus.status_line}
              </p>
              <GoalProgressBar pct={focus.progress_pct} />
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="text-[10px] uppercase text-[var(--muted)]">Unlock /mo</p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--credit)]">
                    {formatINR(focus.unlocked_monthly || 0)}
                  </p>
                </div>
                <div className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="text-[10px] uppercase text-[var(--muted)]">Lump sum</p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {formatINR(focus.funding?.lump_sum_available || 0)}
                  </p>
                </div>
                <div className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="text-[10px] uppercase text-[var(--muted)]">Pace</p>
                  <p className="mt-1 text-sm font-medium leading-snug">
                    {focus.months_at_unlocked_pace != null
                      ? `~${focus.months_at_unlocked_pace} mo`
                      : 'Set a cut plan'}
                  </p>
                </div>
              </div>
              {focus.goal_id ? (
                <div className="mt-4 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-[var(--muted)]">
                    Contribute ₹
                    <input
                      className="field mt-1 w-36"
                      type="number"
                      min={1}
                      placeholder={String(Math.round(focus.unlocked_monthly || 0) || '')}
                      value={contribDrafts[focus.goal_id] || ''}
                      onChange={(e) =>
                        setContribDrafts((d) => ({ ...d, [focus.goal_id!]: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy === `contrib-${focus.goal_id}`}
                    onClick={() => void onContribute(focus.goal_id!)}
                  >
                    {busy === `contrib-${focus.goal_id}` ? <Loader2 className="animate-spin" size={16} /> : null}
                    Log contribution
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <section className="elev-sheet px-4 py-4">
              <h3 className="text-sm font-semibold">Exact cut plan</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Do these and goal funding unlocks — Investments untouched.
              </p>
              {advisor?.next_actions?.length ? (
                <ol className="mt-4 space-y-3">
                  {advisor.next_actions.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--sapphire)]">
                        {i + 1}
                      </span>
                      <span className="leading-snug">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">No cut steps yet.</p>
              )}
              {(advisor?.cut_to_unlock?.cuts || []).length > 0 ? (
                <ul className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)] text-sm">
                  {advisor!.cut_to_unlock.cuts.map((c) => (
                    <li key={`${c.merchant || c.category}-${c.cut_by}`} className="flex justify-between gap-3 py-2">
                      <span>
                        {c.merchant || c.category}
                        <span className="block text-xs text-[var(--muted)]">
                          {c.merchant ? c.category : 'category'} · now {formatINR(c.current_spend)}
                        </span>
                      </span>
                      <span className="font-medium text-[var(--debit)]">−{formatINR(c.cut_by)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {advisor?.cut_to_unlock?.keep_note ? (
                <p className="mt-3 text-xs text-[var(--credit)]">{advisor.cut_to_unlock.keep_note}</p>
              ) : null}
            </section>

            <section className="elev-sheet px-4 py-4">
              <h3 className="text-sm font-semibold">{advisor?.salary_day?.title || 'Salary day'}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">{advisor?.salary_day?.subtitle}</p>
              <div className="mt-4 space-y-3">
                {(advisor?.salary_day?.steps || []).map((step) => (
                  <div
                    key={step.order}
                    className="flex items-start justify-between gap-3 border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {step.order}. {step.label}
                        {step.protected ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--credit)]">
                            protected
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{step.note}</p>
                      {step.splits?.length ? (
                        <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                          {step.splits.map((sp) => (
                            <li key={sp.goal_id || sp.name}>
                              → {sp.name}: {formatINR(sp.monthly)}/mo
                              {sp.lump_from_buffer > 0
                                ? ` + ${formatINR(sp.lump_from_buffer)} lump`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-mono text-sm font-semibold tabular-nums">{formatINR(step.amount)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

            {(advisor?.your_spend?.discretionary_merchants || []).length > 0 ? (
              <section className="elev-sheet mb-5 px-4 py-4">
                <h3 className="text-sm font-semibold">Your Discretionary this month</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Advisor cuts target the top of this list — protected tools stay.
                </p>
                <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
                  {advisor!.your_spend!.discretionary_merchants.map((m) => (
                    <li key={m.name} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {m.name}
                        <span className="ml-2 text-[10px] uppercase text-[var(--muted)]">
                          {m.protected ? 'keep' : m.category}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">{formatINR(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

          {(advisor?.methods || []).length > 0 ? (
          <section className="elev-sheet mb-5 px-4 py-4">
            <h3 className="text-sm font-semibold">What wealthy savers actually do</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Checked against your month — not theory for its own sake.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {advisor!.methods.map((m) => (
                <article
                  key={m.id}
                  className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
                >
                  <div className="flex items-start gap-2">
                    {m.on_track ? (
                      <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--credit)]" size={16} />
                    ) : (
                      <Circle className="mt-0.5 shrink-0 text-[var(--warning)]" size={16} />
                    )}
                    <div>
                      <p className="text-sm font-semibold">{m.name}</p>
                      <p className="text-[10px] text-[var(--muted)]">{m.origin}</p>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--text)]">{m.verdict}</p>
                      <p className="mt-2 text-[11px] text-[var(--muted)]">{m.rule}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <ul className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
              {(advisor?.rules || []).map((r) => (
                <li key={r} className="rounded-full border border-[var(--border)] px-2.5 py-1">
                  {r}
                </li>
              ))}
            </ul>
          </section>
          ) : null}

          {showFramework ? (
            <div className="mb-5 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Actual vs template" subtitle="Secondary view — coach first, bars second">
                <GroupedComparisonBars data={chartData} />
              </ChartCard>
              <section className="elev-sheet overflow-hidden">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-semibold">Bucket map</h3>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {fw.comparison.map((row) => (
                    <div key={row.bucket} className="flex justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">{row.bucket}</p>
                        <p className="text-xs capitalize text-[var(--muted)]">{row.wealth_class}</p>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <p>{formatINR(row.actual_inr)}</p>
                        <p className="text-xs text-[var(--muted)]">of {formatINR(row.template_inr)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          <section className="elev-sheet mb-5 px-4 py-4">
            <h2 className="text-sm font-semibold">Add a goal</h2>
            <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => void onCreateGoal(e)}>
              <label className="text-xs text-[var(--muted)] sm:col-span-2">
                What are you saving for?
                <input
                  className="field mt-1"
                  placeholder="e.g. PS5, Goa trip, iPhone"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  required
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Target date
                <input className="field mt-1" type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Price ₹ (optional)
                <input
                  className="field mt-1"
                  type="number"
                  min={0}
                  placeholder="AI lookup if empty"
                  value={goalPrice}
                  onChange={(e) => setGoalPrice(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)] sm:col-span-2">
                <input type="checkbox" checked={lookupOnCreate} onChange={(e) => setLookupOnCreate(e.target.checked)} />
                Look up market price with AI (confirm before locking)
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <button type="submit" className="btn btn-primary" disabled={busy === 'create'}>
                  {busy === 'create' ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  Add goal
                </button>
              </div>
            </form>
          </section>

          {pendingConfirm ? (
            <section className="elev-sheet mb-5 border-[var(--sapphire)]/30 px-4 py-4">
              <h3 className="text-sm font-semibold">Confirm price — {pendingConfirm.name}</h3>
              {pendingConfirm.price_lookup?.sources?.length ? (
                <ul className="mt-2 list-inside list-disc text-xs text-[var(--muted)]">
                  {pendingConfirm.price_lookup.sources.map((s, i) => (
                    <li key={`${s.retailer}-${i}`}>
                      {s.retailer}
                      {s.note ? ` — ${s.note}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {pendingConfirm.timing_note ? (
                <p className="mt-2 text-xs text-[var(--muted)]">Timing: {pendingConfirm.timing_note}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-[var(--muted)]">
                  Price ₹
                  <input
                    className="field mt-1"
                    type="number"
                    value={confirmPrice}
                    onChange={(e) => setConfirmPrice(e.target.value)}
                  />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => void confirmPendingPrice()}>
                  Confirm
                </button>
                <button type="button" className="btn" onClick={() => setPendingConfirm(null)}>
                  Dismiss
                </button>
              </div>
            </section>
          ) : null}

          {data.priority_conflict && data.priority_note ? (
            <div className="mb-4 rounded-xl border border-[var(--warning)]/30 px-4 py-3 text-sm text-[var(--warning)]">
              {data.priority_note}
            </div>
          ) : null}

          {/* Goals as passbook lines */}
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-[var(--muted)]">All goals · priority order</h3>
          </div>
          {activeGoals.length === 0 ? (
            <div className="elev-sheet px-4 py-8 text-center text-sm text-[var(--muted)]">
              <Target className="mx-auto mb-2 text-[var(--muted)]" size={22} />
              No goals yet — add one above.
            </div>
          ) : (
            <div className="passbook-list elev-sheet overflow-hidden">
              {activeGoals.map((g, index) => (
                <article key={g.id} className="passbook-row px-3 py-3 sm:px-4">
                  <div className="flex gap-3">
                    <span
                      className={`ledger-rail__bar mt-1 self-stretch ${
                        index === 0 ? 'ledger-rail__bar--wealth' : 'ledger-rail__bar--credit'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                            #{index + 1}
                            {index === 0 ? ' · primary' : ''}
                          </span>
                          <h4 className="text-base font-semibold">{g.name}</h4>
                          <p className="font-mono text-sm tabular-nums text-[var(--muted)]">
                            <span className="text-[var(--sapphire)]">{formatINR(g.saved_amount || 0)}</span>
                            {' / '}
                            {formatINR(g.target_price || 0)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className="btn" disabled={index === 0} onClick={() => void moveGoal(g.id, -1)} aria-label="Move up">
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={index === activeGoals.length - 1}
                            onClick={() => void moveGoal(g.id, 1)}
                            aria-label="Move down"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button type="button" className="btn" onClick={() => void onLookup(g.id)} aria-label="Lookup price">
                            <RefreshCw size={14} />
                          </button>
                          <button type="button" className="btn btn-primary" onClick={() => void onComplete(g.id)}>
                            Complete
                          </button>
                          <button type="button" className="btn" onClick={() => void onDelete(g.id)} aria-label="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <GoalProgressBar pct={g.progress_pct || 0} />
                      <p className="mt-2 text-xs text-[var(--muted)]">{g.status_line}</p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="text-xs text-[var(--muted)]">
                          Contribute ₹
                          <input
                            className="field mt-1 w-32"
                            type="number"
                            min={1}
                            value={contribDrafts[g.id] || ''}
                            onChange={(e) => setContribDrafts((d) => ({ ...d, [g.id]: e.target.value }))}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy === `contrib-${g.id}`}
                          onClick={() => void onContribute(g.id)}
                        >
                          Log
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
