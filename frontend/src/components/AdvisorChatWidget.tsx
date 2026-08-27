import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import {
  answerAdvisorNudge,
  answerLearnQuestion,
  fetchAdvisorPresence,
  sendAdvisorChat,
  skipLearnQuestion,
  type AdvisorChatMessage,
  type AdvisorNudge,
  type AdvisorPresence,
} from '../api'

export function AdvisorChatWidget() {
  const [open, setOpen] = useState(false)
  const [presence, setPresence] = useState<AdvisorPresence | null>(null)
  const [messages, setMessages] = useState<AdvisorChatMessage[]>([])
  const [nudges, setNudges] = useState<AdvisorNudge[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const p = await fetchAdvisorPresence()
      setPresence(p)
      setMessages(p.session?.messages || [])
      setNudges(p.nudges || [])
      if (!open) {
          const n = (p.nudges || []).filter((x) =>
          [
            'sip_lapse',
            'briefing',
            'goal_milestone',
            'learn_question',
            'salary_happy',
            'month_start',
            'spend_probe',
            'credit_source',
          ].includes(x.kind),
        ).length
        setUnread(n)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load advisor')
    }
  }, [open])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 120_000)
    return () => window.clearInterval(t)
  }, [load])

  useEffect(() => {
    if (open) {
      setUnread(0)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [open, messages])

  const send = async (text?: string) => {
    const msg = (text || draft).trim()
    if (!msg || busy) return
    setBusy(true)
    setError(null)
    setDraft('')
    setMessages((m) => [...m, { role: 'user', content: msg, at: new Date().toISOString() }])
    try {
      const res = await sendAdvisorChat(msg)
      setMessages(res.session?.messages || [])
      if (res.briefing) {
        setPresence((p) => (p ? { ...p, briefing: res.briefing, advisor_severity: res.advisor_severity } : p))
      }
      // Drop open asks if chat just remembered an answer
      if (res.remembered) {
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed')
    } finally {
      setBusy(false)
    }
  }

  const onNudgeAnswer = async (nudge: AdvisorNudge, answer: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await answerAdvisorNudge({
        kind: nudge.kind,
        nudge_id: nudge.id,
        answer,
        free_text: answer,
      })
      setNudges((list) => list.filter((n) => n.id !== nudge.id))
      if (res.session?.messages) {
        setMessages(res.session.messages)
      } else if (res.ack) {
        setMessages((m) => [
          ...m,
          { role: 'user', content: answer, at: new Date().toISOString() },
          { role: 'advisor', content: res.ack || '', at: new Date().toISOString() },
        ])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save — try typing it in chat')
    } finally {
      setBusy(false)
    }
  }

  const onLearnAnswer = async (nudge: AdvisorNudge, choiceId: string) => {
    const q = nudge.question as {
      id?: string
      fact_type?: string
      key?: string
      choices?: Array<{ id: string }>
    } | undefined
    if (!q?.id) return
    setBusy(true)
    try {
      await answerLearnQuestion({
        question_id: q.id,
        fact_type: String(q.fact_type || ''),
        key: String(q.key || ''),
        choice_id: choiceId,
        choices: (q.choices as Array<{ id: string; label: string }> | undefined) || undefined,
        meta: (q.meta as Record<string, unknown> | undefined) || undefined,
      })
      setNudges((list) => list.filter((n) => n.id !== nudge.id))
      await send(`I answered your question about ${q.key || 'my preferences'}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save answer')
    } finally {
      setBusy(false)
    }
  }

  const name = presence?.profile?.preferred_name || presence?.briefing?.preferred_name || 'you'
  const level = presence?.advisor_severity?.level || presence?.briefing?.level || 'informational'

  const alive = !open && unread > 0

  return (
    <>
      <button
        type="button"
        className={`advisor-fab fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg hover:opacity-95 sm:bottom-6 sm:right-6 ${
          alive ? 'advisor-fab--alive' : ''
        }`}
        aria-label="Open Money Advisor chat"
        onClick={() => setOpen((v) => !v)}
      >
        {alive ? <span className="advisor-fab__ring" aria-hidden /> : null}
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unread > 0 ? (
          <span className="advisor-fab__badge absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--debit)] px-1 text-[10px] font-bold shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="advisor-panel fixed bottom-[5.5rem] right-5 z-[60] flex h-[min(560px,70vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl sm:right-6">
          <div className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              <span className="advisor-spark">
                <Sparkles size={13} />
              </span>
              Advisor · {name}
              <span
                className={
                  level === 'strict' || level === 'concerned'
                    ? 'text-[var(--debit)]'
                    : 'text-[var(--credit)]'
                }
              >
                · {level}
              </span>
            </p>
            {presence?.briefing?.headline ? (
              <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{presence.briefing.headline}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">Ask about spend, SIPs, goals — grounded in your data.</p>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {nudges.slice(0, 4).map((n) => (
              <div
                key={n.id}
                className="advisor-nudge rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {n.kind.replace(/_/g, ' ')}
                  {n.severity ? ` · ${n.severity}` : ''}
                </p>
                <p className="mt-1 text-xs font-medium">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--text)]">{n.message}</p>
                {n.kind === 'learn_question' && Array.isArray((n.question as { choices?: unknown })?.choices) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {((n.question as { choices: Array<{ id: string; label?: string }> }).choices || []).map(
                      (c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="btn text-[11px]"
                          disabled={busy}
                          onClick={() => void onLearnAnswer(n, c.id)}
                        >
                          {c.label || c.id}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      className="btn text-[11px]"
                      disabled={busy}
                      onClick={async () => {
                        const q = n.question as { id?: string; fact_type?: string; key?: string }
                        if (!q?.id) return
                        await skipLearnQuestion({
                          question_id: q.id,
                          fact_type: q.fact_type,
                          key: q.key,
                        })
                        setNudges((list) => list.filter((x) => x.id !== n.id))
                      }}
                    >
                      Skip
                    </button>
                  </div>
                ) : n.kind === 'spend_probe' ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['Planned treat', 'Impulse — my bad', 'Necessary'].map((label) => (
                      <button
                        key={label}
                        type="button"
                        className="btn text-[11px]"
                        disabled={busy}
                        onClick={() => void onNudgeAnswer(n, label)}
                      >
                        {label}
                      </button>
                    ))}
                    <p className="mt-1 w-full text-[10px] text-[var(--muted)]">
                      Or type your own reason below — I&apos;ll remember it.
                    </p>
                  </div>
                ) : n.kind === 'credit_source' ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['Salary / payroll', 'Refund', 'Family', 'Other'].map((label) => (
                      <button
                        key={label}
                        type="button"
                        className="btn text-[11px]"
                        disabled={busy}
                        onClick={() => void onNudgeAnswer(n, label)}
                      >
                        {label}
                      </button>
                    ))}
                    <p className="mt-1 w-full text-[10px] text-[var(--muted)]">
                      Or type it (e.g. &quot;refund from Amazon&quot;) — I&apos;ll remember for next time.
                    </p>
                  </div>
                ) : n.kind === 'salary_happy' || n.kind === 'month_start' ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn text-[11px]"
                      disabled={busy}
                      onClick={() =>
                        void send(
                          n.kind === 'salary_happy'
                            ? "Salary's in — walk me through today's Invest → Buffer → Goals split."
                            : "New month — help me set this month's plan for my goal.",
                        )
                      }
                    >
                      {n.kind === 'salary_happy' ? 'Plan the split' : 'Plan this month'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn mt-2 text-[11px]"
                    onClick={() => void send(`Tell me more about: ${n.title || n.message}`)}
                  >
                    Talk about this
                  </button>
                )}
              </div>
            ))}

            {messages.length === 0 && nudges.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted)]">
                No messages yet this week. Ask anything about your money.
              </p>
            ) : null}

            {messages.map((m, i) => (
              <div
                key={`${m.at}-${i}`}
                className={`advisor-msg max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'ml-auto bg-[var(--accent)] text-white'
                    : 'mr-auto border border-[var(--border)] bg-[var(--bg)]'
                }`}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                {m.content}
              </div>
            ))}
            {busy ? (
              <div className="advisor-msg mr-auto rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                <div className="advisor-typing" aria-label="Advisor is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <p className="px-3 pb-1 text-xs text-[var(--debit)]">{error}</p>
          ) : null}

          <form
            className="flex gap-2 border-t border-[var(--border)] p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input
              className="field flex-1 text-sm"
              placeholder={`Tell me anything — credits, spends, plans… I'll remember, ${name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      ) : null}
    </>
  )
}
