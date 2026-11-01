// The prompt for an AI coding assistant (such as Claude Code) working in a client system's code, with the
// project's own details filled in. Every system gets a "Contact Zenatiq" page, last in its menu, with its
// package, the package's services and the messages with Zenatiq. A yearly subscription also gets the
// licence check and the renewal banner (as in GMS Hardware's system); a one-time purchase doesn't.
import { money, fmtDate, LABELS } from '../lib.js';

const SITE = 'https://www.zenatiqsolutions.com';
const PUBLIC_KEY = 'MCowBQYDK2VwAyEA54ujyCWNnSk8RaY3slPCYb3FxdmiIO8gpYa0wcw7DdM=';
const WHATSAPP = 'https://wa.me/94758112170';
const FENCE = '```';

// project.billing: "yearly" or "one_time". sub: the yearly subscription, for owners and admins only.
export function setupPrompt({ project, client, sub, isAdmin }) {
  return (project.billing === 'yearly' ? yearlyPrompt : oneTimePrompt)({ project, client, sub, isAdmin }).join('\n');
}

const intro = (project, client) =>
  `You're working on the code of ${project.name}, a system Zenatiq Solutions (${SITE}) built${client ? ` for ${client.name}` : ''}.`;

const readFirst = [
  "Read the codebase first: find the server framework, how sign-in works, where the menu and pages are defined and how errors are shown. Follow the project's structure, style and naming, and keep the changes focused. If something below doesn't fit the project, adapt it and say why.",
];

const keyRules = [
  "The key belongs to this project only. Keep it in the server's environment: a git-ignored .env file and the host's settings (on Vercel: Settings → Environment Variables, for Production). Never commit it, and never put it in frontend code or the built site.",
];

const packageApi = (type) =>
  `- Package API (any website may call it): POST ${SITE}/api/connect with {"op": "package", "key": "<ZENATIQ_KEY>"} returns {"data": {"type": "${type}", "name", "services": [what the package includes], ${type === 'yearly'
    ? '"subscription": {"package", "price", "currency", "paid_until", "status", "days_left", "renew_url"}'
    : '"free_months": 2, "support_until": "YYYY-MM-DD" or null, "support_days_left": days or null'}}}`;

const keyRoute = [
  "- Add a route that gives the key to signed-in users only, behind the app's normal authentication: GET /api/zenatiq/widget returns { \"key\": process.env.ZENATIQ_KEY || null }. The page gets the key from it, so the key is never in the frontend code.",
];

const messagesCard = [
  `  - "Messages with Zenatiq": an iframe of ${SITE}/connect/?key=<the key from the route>, full width, about 680px high, no border, rounded corners, titled "Messages with Zenatiq". It's Zenatiq's message portal, where the client reports problems, asks for changes and reads Zenatiq's replies. Add a "WhatsApp" button linking to ${WHATSAPP}.`,
];

const menuExtras = [
  `- Optional: on the menu item, show how many of Zenatiq's replies haven't been read. POST ${SITE}/api/connect with {"op": "threads", "key": "<the key>"} returns {"data": [{"unread": true, …}]}; count the threads with unread true. Refresh it every few minutes and when leaving the page.`,
  "- Don't also add Zenatiq's floating \"Contact with Zenatiq\" button: this page replaces it.",
];

const menuItem = [
  '- Add a menu item "Contact Zenatiq", last in the main navigation (in its own "Support" group if the menu has groups), for everyone who can sign in.',
];

const servicesList = "the package's services: data.services from the package API, as a \"What's included\" checklist (read them each time, so changes from Zenatiq show up by themselves)";

function oneTimePrompt({ project, client }) {
  const until = project.support_until
    ? `free updates and services until ${fmtDate(project.support_until)}`
    : 'free updates and services for 2 months from the day it goes live (Zenatiq sets the date then)';
  return [
    `${intro(project, client)} It's a one-time purchase: Zenatiq gives free updates and services for 2 months after it goes live, and after that, updates and services are charged separately. Add a "Contact Zenatiq" section, last in the app's menu, with the package details, what the package includes and the messages with Zenatiq.`,
    '',
    "Don't add Zenatiq's licence check, a renewal banner or any renewal buttons: a one-time purchase has nothing to renew and never goes read-only.",
    '',
    ...readFirst,
    '',
    '## This project',
    `- Package: one-time purchase, with ${until}`,
    `- Project key (ZENATIQ_KEY): ${project.connect_key}`,
    packageApi('one_time'),
    `- Message portal: ${SITE}/connect/?key=<ZENATIQ_KEY>`,
    '',
    ...keyRules,
    '',
    '## 1. The key (server)',
    "- Add ZENATIQ_KEY to the server's settings, and to .env.example with an empty value.",
    ...keyRoute,
    "- If the system has no server of its own (for example a site that talks straight to Firebase), read the key from the app's configuration instead, and load it only for signed-in users. Say that you did.",
    '',
    '## 2. "Contact Zenatiq" section',
    ...menuItem,
    '- The page has two cards, styled like the rest of the app:',
    `  - "Your package", from the package API: the name (One-time purchase); the free period: "Free updates and services until <support_until>" with the days left, or, once support_days_left is below 0, "Free updates and services ended on <support_until>. Updates, changes and help are now charged separately: message Zenatiq for a quote." (When support_until is null, say "Free updates and services for 2 months after it goes live".) Then ${servicesList}. No renewal button.`,
    ...messagesCard,
    ...menuExtras,
    '',
    '## Check your work',
    '- Run the app with ZENATIQ_KEY set: the package API should return type "one_time" and the free period above.',
    '- Try the free-period wording for days left, the last day and ended by stubbing what the package API returns for a moment. Remove the stub afterwards.',
    "- Contact Zenatiq is last in the menu and shows the package, its services and the message portal. No licence check, banner or renewal button was added, and the key isn't in any frontend file or any committed file.",
    '- Then tell me what you changed, and what I need to set on the host (ZENATIQ_KEY for Production).',
  ];
}

function yearlyPrompt({ project, client, sub, isAdmin }) {
  const now = isAdmin && sub
    ? `${sub.package}, ${money(sub.price, sub.currency)} a year, paid until ${fmtDate(sub.ends_on)} (${LABELS.sub[sub.status] || sub.status})`
    : null;
  return [
    `${intro(project, client)} It's on a yearly subscription: while it's paid, Zenatiq gives all services and small updates. Add three things:`,
    '1. the Zenatiq licence check, which verifies the yearly subscription on the server and makes the system read-only once it has run out;',
    '2. a renewal banner, and a clear message when a change is refused because the system is read-only;',
    "3. a \"Contact Zenatiq\" section, last in the app's menu, with the subscription details, what the package includes and the messages with Zenatiq.",
    '',
    ...readFirst,
    '',
    '## This project',
    '- Package: yearly subscription',
    `- Project key (ZENATIQ_KEY): ${project.connect_key}`,
    ...(now ? [`- Subscription now: ${now}`] : []),
    `- Licence check module (Node.js 18 or newer, no packages): ${SITE}/license/zenatiq-license.mjs`,
    `- Licence API: POST ${SITE}/api/license with JSON {"key": "<ZENATIQ_KEY>"}`,
    `- Zenatiq's public key (Ed25519, SPKI DER, base64): ${PUBLIC_KEY} (also at ${SITE}/api/license/key)`,
    packageApi('yearly'),
    `- Message portal: ${SITE}/connect/?key=<ZENATIQ_KEY>`,
    '',
    ...keyRules,
    '',
    '## 1. Licence check (server)',
    "- Download zenatiq-license.mjs into the server code and don't change it: it checks Zenatiq's signature with the public key inside it, so nobody can fake or edit a licence. To update it, download it again.",
    "- Add ZENATIQ_KEY to the server's settings, and to .env.example with an empty value. Add .zenatiq-license.json to .gitignore.",
    "- Wire it in (Express shown; adapt it to the project's framework):",
    `${FENCE}js`,
    "import { createLicense } from './zenatiq-license.mjs'; // CommonJS on Node 20.19+ or 22.12+: const { createLicense } = require('./zenatiq-license.mjs');",
    '',
    'const license = createLicense({',
    '  key: process.env.ZENATIQ_KEY,',
    "  file: '.zenatiq-license.json', // keeps the last licence so it works offline for days; leave it out on Vercel or other serverless hosts",
    '  fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) }), // optional: give Zenatiq 5 seconds to answer',
    '});',
    '// On a long-running server (a VPS or a shop PC), check at startup, then daily: await license.start();',
    "// On Vercel or other serverless hosts, don't call start(): a check started while the server loads can be frozen.",
    '// The guard checks with the first request instead, then again when one is due.',
    "app.use(license.readOnlyGuard({ allow: ['/api/auth/login', '/api/auth/logout'] })); // before the routes; use the real sign-in and sign-out paths",
    "app.get('/api/license', (req, res) => res.json(license.state())); // no sign-in needed: the banner uses it",
    FENCE,
    '- While read-only, the guard refuses POST, PUT, PATCH and DELETE with HTTP 402 and {"error": {"code": "read_only", "message": "…", "renew_url": "…"}}. GET still works, so people can sign in, look things up and export their data.',
    '- Scheduled jobs that change data (interest, reminders, syncing) must skip their work while license.state().readOnly is true.',
    '- license.state() returns { status, readOnly, verified, stale, package, price, currency, paidUntil, graceUntil, renewUrl, checkedAt, message }. status is active (paid more than 30 days ahead), ending (30 days or fewer), grace (ended, within the grace days), expired (read-only), cancelled, none (no subscription: never read-only) or unknown (not checked yet: the system keeps working). message is the sentence for the banner, or null.',
    "- If the server isn't Node.js: POST the key to the licence API and verify the \"license\" token yourself. It's base64url(JSON payload) + \".\" + base64url(Ed25519 signature), and the signature covers the first part's text exactly as sent. Check it with the public key above, and only use the payload's fields (status, paid_until, grace_until, read_only, renew_url, check_by) when the signature is valid.",
    '',
    '## 2. Banner and read-only messages (frontend)',
    "- After sign-in, fetch /api/license. When message isn't empty, show it in a red bar across the top of the app with a \"Renew now\" link to renewUrl (in a new tab). Remove the bar when message is empty.",
    '- When a save fails with 402 and error.code "read_only", show error.message and the Renew link instead of a generic error.',
    '- Never hide or block pages for reading: read-only only stops changes.',
    '',
    '## 3. "Contact Zenatiq" section',
    ...menuItem,
    ...keyRoute,
    '- The page has two cards, styled like the rest of the app:',
    `  - "Subscription", from /api/license: the package; the yearly price (currency and price); the status (Active, Ending soon, Renewal due, Expired: read-only, Cancelled, Not checked yet); paid until, with the days left or how long ago it ended; the last day to renew (graceUntil: read-only after that day); when Zenatiq last confirmed it (checkedAt); the banner message, if any; a "Renew now" button to renewUrl (in a new tab); and ${servicesList}.`,
    ...messagesCard,
    ...menuExtras,
    '',
    '## Check your work',
    '- Run the app with ZENATIQ_KEY set: /api/license should return verified: true and the subscription above, and the package API type "yearly" with its services.',
    '- Try the banner, the 402 message and each status on the Subscription card by stubbing what /api/license returns for a moment. Remove the stub afterwards.',
    "- Contact Zenatiq is last in the menu, shows the subscription, its services and the message portal, and the key isn't in any frontend file or any committed file.",
    '- Then tell me what you changed, and what I need to set on the host (ZENATIQ_KEY for Production).',
  ];
}
