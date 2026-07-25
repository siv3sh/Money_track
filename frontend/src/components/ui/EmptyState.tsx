export function EmptyState({ message = 'No data for this period' }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-[var(--muted)]">
      {message}
    </div>
  )
}

export function LoadingBlock() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="panel h-28 p-4">
          <div className="skeleton mb-3 h-3 w-24" />
          <div className="skeleton h-8 w-36" />
        </div>
      ))}
    </div>
  )
}
