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
  title: 'Set up Money Track',
  subtitle:
    'About 10 minutes once. You will connect the phone that gets bank SMS, optionally forward bank emails, then confirm your first transaction appears.',
}

export const IPHONE_SMS_STEPS: GuideStep[] = [
  {
    title: 'Open the Shortcuts app',
    body: 'It is pre-installed on every iPhone. Look for the blue-and-pink icon.',
  },
  {
    title: 'Create an automation for incoming SMS',
    bullets: [
      'Tap Automation at the bottom → tap + (top right).',
      'Choose Message (or “SMS received”).',
      'You can start with “Any Sender” and narrow to bank senders later.',
      'Tap Next.',
    ],
  },
  {
    title: 'Add “Get Contents of URL”',
    bullets: [
      'Tap Add Action → search “Get Contents of URL”.',
      'Tap the URL field → paste your Money Track SMS link (copied in the previous step).',
      'Set Method to POST (not GET — this is important).',
      'Tap Show More → Request Body → JSON.',
      'Add two fields: sender = Sender, body = Message Contents (use the blue variable chips).',
    ],
  },
  {
    title: 'Make it run automatically',
    bullets: [
      'Turn off “Ask Before Running” when prompted (or in automation settings).',
      'Save the automation.',
    ],
    tip: 'If iOS asks for permission, allow Shortcuts to send data when receiving messages.',
  },
  {
    title: 'Test it',
    bullets: [
      'Wait for a real bank debit/credit SMS, or ask someone to text you a sample.',
      'Open Money Track → Transactions. The alert should appear within a few seconds.',
    ],
  },
]

export const ANDROID_SMS_STEPS: GuideStep[] = [
  {
    title: 'Install MacroDroid',
    body: 'Free on the Play Store. Tasker also works if you already use it — the idea is the same.',
  },
  {
    title: 'Allow SMS permission',
    body: 'When MacroDroid asks, allow SMS read access so it can see bank alerts.',
  },
  {
    title: 'Create a new macro',
    bullets: [
      'Tap + to add a macro.',
      'Trigger → Phone/SMS → SMS Received (you can filter by sender later).',
    ],
  },
  {
    title: 'Add HTTP Request action',
    bullets: [
      'Action → Connectivity → HTTP Request.',
      'Method: POST.',
      'URL: paste your Money Track SMS link.',
      'Content type: application/json.',
      'Body: { "sender": "[sms_from]", "body": "[sms_body]" } — use MacroDroid’s magic text for sender and body.',
    ],
  },
  {
    title: 'Keep it running in the background',
    bullets: [
      'Phone Settings → Apps → MacroDroid → Battery → Unrestricted (or “Don’t optimize”).',
      'Disable battery saver for MacroDroid if transactions stop arriving.',
    ],
    warning: 'Some Android brands (Xiaomi, Oppo, Vivo) aggressively kill background apps — whitelist MacroDroid.',
  },
  {
    title: 'Test it',
    bullets: [
      'Trigger a bank SMS or wait for the next real alert.',
      'Check Money Track → Transactions.',
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
      'Tick Forward it to → choose or add your Money Track address.',
      'Gmail may email you once to verify forwarding — click the link in that email.',
      'Save the filter.',
    ],
    tip: 'Only bank alerts you forward are parsed. Newsletters and OTPs in your inbox are untouched.',
  },
  {
    title: 'Confirm in Money Track',
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
      'Most Indian banks still text you for every debit and credit. We read those messages automatically once your phone forwards them.',
    steps: [
      {
        title: 'Run the phone setup wizard',
        body: 'If you have not finished it yet, open Setup from the menu or use the button below.',
        tip: 'You need the phone that actually receives HDFC/ICICI/SBI etc. SMS — usually your daily driver.',
      },
      {
        title: 'Copy your private SMS link',
        body: 'Each phone gets one secret link. Treat it like a password — do not post it online.',
      },
      {
        title: 'Paste the link into Shortcuts (iPhone) or MacroDroid (Android)',
        body: 'See the detailed steps in Setup or Accounts → SMS setup help.',
      },
      {
        title: 'Wait for one real bank SMS',
        body: 'Open Transactions. You should see amount, merchant, and category.',
      },
    ],
    cta: { label: 'Open setup wizard', to: '/setup' },
  },
  {
    id: 'email',
    part: 3,
    title: 'Bank emails (optional)',
    summary:
      'Some banks email alerts instead of (or as well as) SMS. Forward only those emails — we ignore OTPs and promos.',
    optional: true,
    steps: GMAIL_FORWARD_STEPS,
    cta: { label: 'Set up email forwarding', to: '/accounts' },
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
        body: 'On Transactions, change any wrong category — Money Track learns from your corrections.',
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
        title: 'Hide sections you do not need',
        body: 'Turn off Wealth or Advisor in Profile if you want a simpler menu.',
      },
    ],
    cta: { label: 'Open Profile', to: '/profile' },
  },
  {
    id: 'import',
    part: 6,
    title: 'Statements & portfolio (optional)',
    summary: 'Bulk history and investments — not required for day-to-day spend tracking.',
    optional: true,
    steps: [
      {
        title: 'Import bank CSV/PDF',
        body: 'Import page → upload a statement for backfill or cards that do not SMS.',
      },
      {
        title: 'INDmoney / holdings',
        body: 'Wealth → import if you want net worth alongside spend.',
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
      'Only forward real debit/credit alerts — OTP and marketing emails are skipped on purpose.',
      'Try paste mode on Accounts to test one email manually.',
      'If auto-forward is unavailable, ask your admin to enable inbound email on the server.',
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
  'Copy link',
  'Phone steps',
] as const
