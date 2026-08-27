/** Resolve a display label for the user's salary / primary income source. */

export type SalarySourceInput = {
  overview?: { employer?: string | null } | null
  income_profile?: { employer?: string | number | null } | Record<string, string | number | null> | null
  income_sources?: Array<{ name: string; is_salary?: boolean }> | null
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t || undefined
}

/**
 * employer → income_profile.employer → first salary income source → first income source.
 * No hardcoded employer fallback.
 */
export function resolveSalarySourceLabel(
  data: SalarySourceInput | null | undefined,
): string | undefined {
  if (!data) return undefined
  return (
    trimmedString(data.overview?.employer) ||
    trimmedString(data.income_profile?.employer) ||
    trimmedString(data.income_sources?.find((r) => r.is_salary)?.name) ||
    trimmedString(data.income_sources?.[0]?.name) ||
    undefined
  )
}
