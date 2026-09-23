/** End-to-end setup copy — single source for Setup, Getting Started, and Accounts. */

export const GMAIL_BANK_FILTER =
  'from:(alerts@hdfcbank.net OR alerts@icicibank.com OR notice@axisbank.com OR ebanking@kotak.com OR alerts@sbi.co.in OR notification@yesbank.in)'

export type GuideStep = {
  title: string
  body?: string
  bullets?: string[]
  tip?: string
  warning?: string
}

export type SetupChapter = {
  id: string
  part: number
  title: string
  summary: string
  optional?: boolean
  steps: GuideStep[]
  cta?: { label: string; to: string }
}

export const SETUP_INTRO = {
  title: 'Set up Tally',
  subtitle:
    'About 5–10 minutes once. Connect the phone that gets bank SMS — that is the main feed. Bank email is optional later.',
}

/** MacroDroid HTTP body — copy-paste into Content / Body field. */
export const ANDROID_SMS_JSON_BODY =
  '{"sender":"[sms_from]","body":"[sms_body]"}'

export const IPHONE_SMS_STEPS: GuideStep[] = [
  {
    title: 'Open the Shortcuts app',
    body: 'Pre-installed on iPhone — blue-and-pink icon. Keep this Tally tab open so you can copy the SMS link again.',
  },
  {
    title: 'Create an automation for incoming SMS',
    bullets: [
      'Tap Automation → + (top right).',
      'Choose Message / “Message” received.',
      'Start with Any Sender (narrow to banks later).',
      'Tap Next.',
    ],
  },
  {
    title: 'Add “Get Contents of URL”',
    bullets: [
      'Add Action → search “Get Contents of URL”.',
      'URL field → paste your Tally SMS link (Copy SMS link above).',
      'Method → POST (not GET).',
      'Show More → Request Body → JSON.',
      'Add two fields with blue chips: sender = Sender, body = Message Contents.',
    ],
    tip: 'If the body is empty or GET is selected, nothing will arrive in Tally.',
  },
  {
    title: 'Run without asking',
    bullets: [
      'Turn off “Ask Before Running”.',
      'Save the automation.',
    ],
  },
  {
    title: 'Confirm in Tally',
    bullets: [
      'Wait for one real bank SMS (or have someone text you).',
      'Open Transactions — amount should appear within a few seconds.',
    ],
  },
]

export const ANDROID_SMS_STEPS: GuideStep[] = [
  {
    title: 'Install MacroDroid',
    body: 'Free on the Play Store. Keep this Tally tab open to copy the SMS link and JSON body.',
  },
  {
    title: 'Allow SMS permission',
    body: 'When asked, allow SMS read so MacroDroid can see bank alerts.',
  },
  {
    title: 'Create a macro',
    bullets: [
      'Tap + → Trigger → Phone/SMS → SMS Received.',
      'You can filter by bank sender later.',
    ],
  },
  {
    title: 'Add HTTP Request (POST)',
    bullets: [
      'Action → Connectivity → HTTP Request.',
      'Method: POST · Content type: application/json.',
      'URL: paste your Tally SMS link (Copy SMS link above).',
      'Body: paste the JSON template (Copy JSON body) — MacroDroid fills [sms_from] / [sms_body].',
    ],
    tip: 'Use the Copy JSON body button on Accounts / Setup so the braces and quotes stay exact.',
  },
  {
    title: 'Keep MacroDroid alive',
    bullets: [
      'Phone Settings → Apps → MacroDroid → Battery → Unrestricted.',
    ],
    warning: 'Xiaomi / Oppo / Vivo often kill background apps — whitelist MacroDroid.',
  },
  {
    title: 'Confirm in Tally',
    bullets: [
      'Wait for a bank SMS, then open Transactions.',
    ],
  },
]

export const GMAIL_FORWARD_STEPS: GuideStep[] = [
  {
    title: 'Copy your forwarding address',
    body: 'On Accounts, tap Copy address under Bank alert emails. It looks like name@your-domain — unique to you.',
  },
  {
    title: 'Open Gmail settings on a computer',
    body: 'Gmail app on phone works too, but filters are easier on desktop: Settings → See all settings → Filters and Blocked Addresses.',
  },
  {
    title: 'Create a filter for bank senders',
    bullets: [
      'Click Create a new filter.',
      'In the From field, paste the bank filter text (Accounts has a Copy filter button for HDFC, ICICI, Axis, Kotak, SBI, Yes Bank).',
      'Click Create filter.',
    ],
  },
  {
    title: 'Forward matching emails only',
    bullets: [
      'Tick Forward it to → choose or add your Tally address.',
      'Gmail may email you once to verify forwarding — click the link in that email.',
      'Save the filter.',
    ],
    tip: 'Only bank alerts you forward are parsed. Newsletters and OTPs in your inbox are untouched.',
  },
  {
    title: 'Confirm in Tally',
    body: 'The next debit/credit email should show in Transactions within seconds, same as SMS.',
  },
]

export const FULL_SETUP_JOURNEY: SetupChapter[] = [
  {
    id: 'account',
    part: 1,
    title: 'Create your account',
    summary: 'You are signed in. Your data is private to this login — other users never see your transactions.',
    steps: [
      {
        title: 'Use a strong password',
        body: 'You can reset it anytime from the login page if you forget.',
      },
      {
        title: 'Invite code',
        body: 'If signup asked for an invite code, your admin gave you one. Open signup is used when no code is required.',
      },
    ],
  },
  {
    id: 'sms',
    part: 2,
    title: 'Connect bank SMS (main feed)',
    summary:
      'Most Indian banks text every debit and credit. Copy your private link into Shortcuts (iPhone) or MacroDroid (Android).',
    steps: [
      {
        title: 'Open Phones & email',
        body: 'Tap Copy SMS link for your phone. Treat the link like a password.',
        tip: 'Use the phone that actually receives HDFC / ICICI / SBI SMS.',
      },
      {
        title: 'Paste into Shortcuts or MacroDroid',
        body: 'Accounts shows platform steps under each phone. On Android, also copy the JSON body template.',
      },
      {
        title: 'Wait for one real bank SMS',
        body: 'Open Transactions — you should see amount, merchant, and category.',
      },
    ],
    cta: { label: 'Open Phones & email', to: '/accounts' },
  },
  {
    id: 'email',
    part: 3,
    title: 'Bank emails (optional)',
    summary:
      'Paste a bank alert to test anytime. When auto-forward is on, copy your personal address into a Gmail filter. OTPs and promos are ignored.',
    optional: true,
    steps: GMAIL_FORWARD_STEPS,
    cta: { label: 'Set up bank email', to: '/accounts' },
  },
  {
    id: 'verify',
    part: 4,
    title: 'Make sure it is working',
    summary: 'Two quick checks so you trust the dashboard before you rely on it.',
    steps: [
      {
        title: 'Transactions list',
        body: 'You should see at least one debit or credit with the right amount. Tap it to check category.',
      },
      {
        title: 'Spending page',
        body: 'After a few transactions, categories and merchants start to fill in.',
      },
      {
        title: 'Fix categories',
        body: 'On Transactions, change any wrong category — Tally learns from your corrections.',
        tip: 'Do this for 3–5 merchants in the first week for best accuracy.',
      },
    ],
    cta: { label: 'View Transactions', to: '/transactions' },
  },
  {
    id: 'profile',
    part: 5,
    title: 'Personalise (5 minutes)',
    summary: 'Optional but helpful: salary keywords, budgets, and which menu items you want.',
    optional: true,
    steps: [
      {
        title: 'Profile → Salary',
        body: 'Add your employer name or salary SMS keywords so income is tagged correctly.',
      },
      {
        title: 'Profile → Budgets',
        body: 'Set soft caps per category if you want Spending to warn you early.',
      },
      {
        title: 'Customise menu',
        body: 'Avatar → Customise menu to hide Phones & email or Import if you want a shorter sidebar.',
      },
    ],
    cta: { label: 'Open Profile', to: '/profile' },
  },
  {
    id: 'import',
    part: 6,
    title: 'Statement history (optional)',
    summary: 'Bulk history — not required for day-to-day spend tracking.',
    optional: true,
    steps: [
      {
        title: 'Import bank CSV/PDF',
        body: 'Import page → upload a statement for backfill or cards that do not SMS.',
      },
    ],
    cta: { label: 'Go to Import', to: '/import' },
  },
]

export const TROUBLESHOOTING: GuideStep[] = [
  {
    title: 'No SMS showing up',
    bullets: [
      'Confirm the automation uses POST, not GET.',
      'On Android, check MacroDroid battery / background permissions.',
      'Copy the SMS link again from Accounts — if you rotated links, update Shortcuts/MacroDroid.',
      'Render free tier: first open after idle can take up to a minute — retry once.',
    ],
  },
  {
    title: 'Email not parsing',
    bullets: [
      'Gmail forwards to your personal @ address from Accounts — never paste the onrender.com webhook link.',
      'Only forward real debit/credit alerts — OTP and marketing emails are skipped on purpose.',
      'Try paste mode on Accounts to test one email manually.',
      'If you do not see a forwarding address yet, auto-forward is still being enabled — paste works meanwhile.',
    ],
  },
  {
    title: 'Duplicate transactions',
    body: 'The same payment via SMS and email may dedupe automatically. If you see a duplicate, delete one in Transactions.',
  },
  {
    title: 'Wrong category',
    body: 'Change it on Transactions — the app remembers merchant → category for next time.',
  },
]

export const SETUP_PROGRESS_LABELS = [
  'Choose phone',
  'Name phone',
  'Copy link & phone steps',
] as const
