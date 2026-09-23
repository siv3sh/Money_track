import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

function BrandMark() {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-[var(--elev-2)] ring-1 ring-white/20"
      style={{
        background:
          'linear-gradient(145deg, color-mix(in srgb, var(--sapphire) 88%, white) 0%, var(--sapphire) 48%, color-mix(in srgb, var(--sapphire) 65%, #061028) 100%)',
      }}
      aria-hidden
    >
      ₹
    </div>
  )
}

function LegalShell({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--sheet)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold">
              Tally
            </span>
          </Link>
          <Link to="/" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Home
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last updated: {updated}</p>
        <div className="legal-prose mt-8 space-y-6 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          {children}
        </div>
      </article>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="23 September 2026">
      <p>
        Tally (“we”, “the Service”) is a personal SMS/UPI ledger: it helps you capture and organize
        transaction data from bank SMS, optional bank-alert emails, and files you upload. This policy
        explains what we collect and how we use it.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        What we collect
      </h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong className="text-[var(--text)]">Account:</strong> email and password hash (argon2). We do
          not store plaintext passwords.
        </li>
        <li>
          <strong className="text-[var(--text)]">Transaction data:</strong> amounts, merchants, dates,
          categories, and related metadata parsed from SMS/email/imports you send to the Service.
        </li>
        <li>
          <strong className="text-[var(--text)]">Device linkage:</strong> per-device webhook tokens so your
          phone can POST SMS securely.
        </li>
        <li>
          <strong className="text-[var(--text)]">Optional wealth data:</strong> portfolio and liability
          entries you add or import (e.g. INDmoney exports).
        </li>
        <li>
          <strong className="text-[var(--text)]">Usage:</strong> basic operational logs needed to run and
          secure the Service (never full SMS bodies or full account numbers in persistent logs).
        </li>
      </ul>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        What we do not collect
      </h2>
      <p>
        We never ask for your net-banking or UPI PIN, bank password, or full card number. You control what
        SMS and emails are forwarded.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        How we use data
      </h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>To show your ledger: dashboard, spending, transactions, and optional extras you enable.</li>
        <li>To power optional AI insights grounded in your own ledger.</li>
        <li>To secure accounts, prevent abuse, and improve parsing accuracy.</li>
      </ul>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Sharing
      </h2>
      <p>
        We do not sell your personal or financial data. Infrastructure providers (hosting, database, email
        delivery) process data only to operate the Service under their terms. AI providers may receive
        prompts derived from your ledger when you use advisor features — treat that as sensitive and
        disable advisor features in Profile if you prefer not to use them.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Retention and deletion
      </h2>
      <p>
        Data remains while your account is active. You may delete your account and associated data from
        Profile (or contact the operator). Backups may retain residual copies for a limited period.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Security
      </h2>
      <p>
        We use JWT sessions, hashed passwords, per-user data isolation, and rate limits on auth endpoints.
        No method of transmission over the Internet is perfectly secure; use a strong unique password.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Contact
      </h2>
      <p>
        Questions about privacy: reach the operator via the email associated with your account signup or
        the project repository maintainer.
      </p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="23 September 2026">
      <p>
        By creating an account or using Tally, you agree to these terms. If you do not agree, do not
        use the Service.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        The Service
      </h2>
      <p>
        Tally is a personal ledger tool that parses bank SMS and related imports you provide. It is
        not a bank, payment provider, or licensed financial advisor. Nothing in the app is investment,
        tax, or legal advice.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Your responsibilities
      </h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Provide accurate account credentials and keep your password confidential.</li>
        <li>Only forward SMS/email you are authorized to access.</li>
        <li>Review parsed amounts — parsers can err on unusual message formats.</li>
        <li>Do not abuse the API, attempt unauthorized access, or disrupt the Service.</li>
      </ul>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Accounts
      </h2>
      <p>
        Signup may be open or invite-gated at the operator’s discretion. We may suspend or delete accounts
        that violate these terms or pose a security risk.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Availability
      </h2>
      <p>
        The Service may run on free-tier hosting that cold-starts after idle periods. We aim for
        reliability but do not guarantee uninterrupted uptime or perfect parsing for every bank message
        format.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Intellectual property
      </h2>
      <p>
        The product name, UI, and software remain with the operator. Your transaction and account data
        remain yours.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Limitation of liability
      </h2>
      <p>
        The Service is provided “as is.” To the fullest extent permitted by law, the operator is not
        liable for indirect, incidental, or consequential damages, including losses from mis-parsed
        amounts, downtime, or decisions you make based on the dashboard.
      </p>

      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        Changes
      </h2>
      <p>
        We may update these terms. Continued use after changes means you accept the revised terms. Material
        changes will be reflected by updating the date above.
      </p>

      <p className="pt-2">
        See also our <Link to="/privacy" className="font-medium text-[var(--sapphire)] hover:underline">Privacy Policy</Link>.
      </p>
    </LegalShell>
  )
}
