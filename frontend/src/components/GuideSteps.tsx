import type { GuideStep } from '../lib/setupGuide'

export function GuideSteps({ steps, startAt = 1 }: { steps: GuideStep[]; startAt?: number }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--sapphire)]"
            aria-hidden
          >
            {startAt + i}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text)]">{step.title}</p>
            {step.body ? (
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{step.body}</p>
            ) : null}
            {step.bullets?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-[var(--muted)]">
                {step.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {step.tip ? (
              <p className="mt-2 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs text-[var(--sapphire)]">
                Tip: {step.tip}
              </p>
            ) : null}
            {step.warning ? (
              <p className="mt-2 rounded-lg bg-[var(--warning-soft)] px-2.5 py-1.5 text-xs text-[var(--warning)]">
                Note: {step.warning}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function SetupProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100)
  return (
    <div className="mb-6">
      <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
        <span>
          Step {step} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full bg-[var(--sapphire)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={total}
        />
      </div>
    </div>
  )
}
