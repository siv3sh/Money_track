import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  answerLearnQuestion,
  createLearnedFact,
  deleteLearnedFact,
  fetchLearnQuestions,
  fetchLearnedFacts,
  skipLearnQuestion,
  updateLearnedFact,
  type LearnQuestion,
  type LearnedFact,
} from '../api'
import { ChartCard } from './ui'
import { DEFAULT_CATEGORIES } from '../types'

const FACT_TYPE_OPTIONS = [
  { id: 'category_intent', label: 'Merchant → category' },
  { id: 'budget_target', label: 'Budget target' },
  { id: 'risk_tolerance', label: 'Drift threshold' },
  { id: 'one_off_context', label: 'One-off event' },
  { id: 'spending_intent', label: 'Spending intent' },
  { id: 'merchant_correction', label: 'Merchant correction' },
] as const

export function LearnAboutMePanel({
  dateFrom,
  dateTo,
}: {
  dateFrom?: string
  dateTo?: string
}) {
  const [facts, setFacts] = useState<LearnedFact[]>([])
  const [questions, setQuestions] = useState<LearnQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [freeText, setFreeText] = useState<Record<string, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<string>('budget_target')
  const [addKey, setAddKey] = useState('')
  const [addValue, setAddValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [f, q] = await Promise.all([
        fetchLearnedFacts(),
        fetchLearnQuestions({
          date_from: dateFrom,
          date_to: dateTo,
        }),
      ])
      setFacts(f.facts)
      setQuestions(q.questions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load learn panel')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, LearnedFact[]>()
    for (const f of facts) {
      const g = f.group || 'Other'
      const list = map.get(g) || []
      list.push(f)
      map.set(g, list)
    }
    return [...map.entries()]
  }, [facts])

  const onAnswer = async (q: LearnQuestion, choiceId?: string) => {
    setBusyId(q.id)
    setError(null)
    try {
      await answerLearnQuestion({
        question_id: q.id,
        fact_type: q.fact_type,
        key: q.key,
        choice_id: choiceId,
        free_text: freeText[q.id],
        choices: q.choices,
        meta: q.meta,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save answer')
    } finally {
      setBusyId(null)
    }
  }

  const onSkip = async (q: LearnQuestion) => {
    setBusyId(q.id)
    try {
      await skipLearnQuestion({
        question_id: q.id,
        fact_type: q.fact_type,
        key: q.key,
      })
      setQuestions((prev) => prev.filter((x) => x.id !== q.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed')
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this learned fact? The app may ask about it again later.')) return
    setBusyId(id)
    try {
      await deleteLearnedFact(id)
      setFacts((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  const onEdit = async (f: LearnedFact) => {
    const next = window.prompt('Update value', String(f.value))
    if (next == null || next.trim() === String(f.value)) return
    setBusyId(f.id)
    try {
      const res = await updateLearnedFact(f.id, { value: next.trim() })
      setFacts((prev) => prev.map((x) => (x.id === f.id ? res.fact : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const onAdd = async () => {
    if (!addKey.trim() || !addValue.trim()) return
    setBusyId('add')
    try {
      let value: string | number = addValue.trim()
      if (addType === 'budget_target' || addType === 'risk_tolerance') {
        value = Number(String(value).replace(/[₹,]/g, ''))
        if (Number.isNaN(value)) throw new Error('Enter a number')
      }
      await createLearnedFact({
        fact_type: addType,
        key: addKey.trim(),
        value,
      })
      setAddKey('')
      setAddValue('')
      setShowAdd(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add fact')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}

      <ChartCard
        title="Quick questions"
        subtitle="At most 1–2 per week · Skip never stores a fact"
        action={<Brain size={16} className="text-[var(--muted)]" />}
      >
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : questions.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Nothing to ask right now. Questions appear when categorization is unsure, spend
            spikes, budgets need calibrating, allocation drifts, or an unusual charge shows up.
          </p>
        ) : (
          <ul className="space-y-4">
            {questions.map((q) => (
              <li
                key={q.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3"
              >
                <p className="text-sm font-medium leading-snug">{q.prompt}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.choices.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`btn text-xs ${i < 2 ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
                      disabled={busyId === q.id}
                      onClick={() => void onAnswer(q, c.id)}
                    >
                      {busyId === q.id ? <Loader2 size={12} className="animate-spin" /> : null}
                      {c.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn text-xs text-[var(--muted)]"
                    disabled={busyId === q.id}
                    onClick={() => void onSkip(q)}
                  >
                    {q.skip_label || 'Not sure / Skip'}
                  </button>
                </div>
                {q.allow_free_text ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className="field min-w-[10rem] flex-1"
                      placeholder="Or type an amount / answer"
                      value={freeText[q.id] || ''}
                      onChange={(e) =>
                        setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn text-xs"
                      disabled={busyId === q.id || !(freeText[q.id] || '').trim()}
                      onClick={() => void onAnswer(q)}
                    >
                      Save
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ChartCard>

      <ChartCard
        title="Things I've learned about you"
        subtitle="Editable preferences the AI and alerts use before guessing"
        action={
          <button type="button" className="btn text-xs" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={12} />
            Add
          </button>
        }
      >
        {showAdd ? (
          <div className="mb-4 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-3">
            <select className="field" value={addType} onChange={(e) => setAddType(e.target.value)}>
              {FACT_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="field"
              placeholder={
                addType === 'budget_target'
                  ? 'Category (e.g. Food & Dining)'
                  : addType === 'risk_tolerance'
                    ? 'Asset class'
                    : 'Key (merchant / month|category)'
              }
              list={addType === 'budget_target' ? 'learn-cats' : undefined}
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
            />
            <datalist id="learn-cats">
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="flex gap-2 sm:col-span-3">
              <input
                className="field flex-1"
                placeholder={
                  addType === 'budget_target'
                    ? 'Amount e.g. 8000'
                    : addType === 'risk_tolerance'
                      ? 'Threshold pp e.g. 5'
                      : 'Value'
                }
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary btn"
                disabled={busyId === 'add'}
                onClick={() => void onAdd()}
              >
                Save fact
              </button>
            </div>
          </div>
        ) : null}

        {loading && !facts.length ? (
          <p className="text-sm text-[var(--muted)]">Loading facts…</p>
        ) : facts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No learned facts yet. Answer a quick question above, or add one manually.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([group, rows]) => (
              <div key={group}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {group}
                </p>
                <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                  {rows.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm">{f.plain_language}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {f.last_confirmed_at
                            ? `Learned ${new Date(f.last_confirmed_at).toLocaleDateString('en-IN')}`
                            : f.source || 'user'}
                          {' · '}
                          {f.fact_type}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={busyId === f.id}
                          onClick={() => void onEdit(f)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn text-xs text-[var(--debit)]"
                          disabled={busyId === f.id}
                          onClick={() => void onDelete(f.id)}
                          aria-label="Delete fact"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  )
}
