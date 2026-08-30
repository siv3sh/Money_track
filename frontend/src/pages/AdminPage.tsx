import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  deleteAdminUser,
  fetchAdminUsers,
  patchAdminUser,
  type AdminUserRow,
} from '../api'
import { ChartCard, LoadingBlock, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'

export function AdminPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [signupCodeRequired, setSignupCodeRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAdminUsers()
      setRows(res.items)
      setSignupCodeRequired(res.signup_code_required)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!user?.is_admin) {
    return <Navigate to="/profile" replace />
  }

  const toggleDisabled = async (row: AdminUserRow) => {
    setBusyId(row.id)
    setError(null)
    try {
      await patchAdminUser(row.id, { disabled: !row.disabled })
      setFlash(row.disabled ? `Enabled ${row.email}` : `Disabled ${row.email}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
      setTimeout(() => setFlash(null), 2500)
    }
  }

  const removeUser = async (row: AdminUserRow) => {
    if (
      !window.confirm(
        `Delete ${row.email} and all their data (transactions, portfolio, facts)? This cannot be undone.`,
      )
    ) {
      return
    }
    setBusyId(row.id)
    setError(null)
    try {
      await deleteAdminUser(row.id)
      setFlash(`Deleted ${row.email}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
      setTimeout(() => setFlash(null), 2500)
    }
  }

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        title="Database & users"
        description="Manage accounts created via signup. Each user keeps separate transactions, wealth, and settings."
      />

      <ChartCard
        title="Tenancy"
        subtitle="How data is isolated after open signup"
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
          <li>Writes stamp <code className="text-[var(--text)]">user_id</code> on transactions, portfolio, liabilities, facts, and more.</li>
          <li>Unique indexes are per-user so two people can share the same merchant or card last4.</li>
          <li>
            Signup invite code is{' '}
            {signupCodeRequired ? (
              <span className="text-[var(--text)]">required</span>
            ) : (
              <span className="text-[var(--text)]">optional (open signup)</span>
            )}
            . Set <code className="text-[var(--text)]">SIGNUP_CODE</code> on the API to lock it down.
          </li>
        </ul>
      </ChartCard>

      {error ? (
        <div className="rounded-xl border border-[var(--debit)]/30 bg-[var(--debit-soft)] px-4 py-3 text-sm text-[var(--debit)]">
          {error}
        </div>
      ) : null}
      {flash ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
          {flash}
        </div>
      ) : null}

      <ChartCard title="Accounts" subtitle={`${rows.length} user(s)`}>
        {loading ? (
          <LoadingBlock />
        ) : !rows.length ? (
          <p className="text-sm text-[var(--muted)]">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Txns</th>
                  <th className="py-2 pr-3 font-medium">Phones</th>
                  <th className="py-2 pr-3 font-medium">Holdings</th>
                  <th className="py-2 pr-3 font-medium">Facts</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] align-middle">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-[var(--text)]">{row.email}</p>
                      <p className="text-[10px] text-[var(--muted)]">
                        {row.setup_completed ? 'Setup done' : 'Setup pending'}
                        {row.is_admin ? ' · Admin' : ''}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      {row.disabled ? (
                        <span className="text-[var(--debit)]">Disabled</span>
                      ) : (
                        <span className="text-[var(--credit)]">Active</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.counts.transactions}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.counts.linked_accounts}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.counts.portfolio}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.counts.learned_facts}</td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={busyId === row.id || row.id === user.id}
                          onClick={() => void toggleDisabled(row)}
                        >
                          {row.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          type="button"
                          className="btn text-xs text-[var(--debit)]"
                          disabled={busyId === row.id || row.id === user.id}
                          onClick={() => void removeUser(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  )
}
