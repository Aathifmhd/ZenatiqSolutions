// The prompt for an AI coding assistant (such as Claude Code) working in a client system's code. It adds
// the Zenatiq licence check, the renewal banner and a "Contact Zenatiq" section, with the project's own
// details filled in. GMS Hardware's system is built this way.
import { money, fmtDate, LABELS } from '../lib.js';

const SITE = 'https://www.zenatiqsolutions.com';
const PUBLIC_KEY = 'MCowBQYDK2VwAyEA54ujyCWNnSk8RaY3slPCYb3FxdmiIO8gpYa0wcw7DdM=';
const WHATSAPP = 'https://wa.me/94758112170';
const FENCE = '```';

// sub: the project's yearly subscription, for owners and admins (members can't see subscriptions).
export function setupPrompt({ project, client, sub, isAdmin }) {
  const now = !isAdmin ? null : sub
    ? `${sub.package}, ${money(sub.price, sub.currency)} a year, paid until ${fmtDate(sub.ends_on)} (${LABELS.sub[sub.status] || sub.status})`
    : 'no yearly subscription yet (a one-time purchase): the licence says status "none", so the system never goes read-only';
  return [
    `You're working on the code of ${project.name}, a system Zenatiq Solutions (${SITE}) built${client ? ` for ${client.name}` : ''}. Add three things:`,
    '1. the Zenatiq licence check, which verifies the yearly subscription on the server and makes the system read-only once it has run out;',
    '2. a renewal banner, and a clear message when a change is refused because the system is read-only;',
    "3. a \"Contact Zenatiq\" section, last in the app's menu, with the subscription details and the messages with Zenatiq.",
    '',
    "Read the codebase first: find the server framework, how sign-in works, where the menu and pages are defined and how errors are shown. Follow the project's structure, style and naming, and keep the changes focused. If something below doesn't fit the project, adapt it and say why.",
    '',
    '## This project',
    `- Project key (ZENATIQ_KEY): ${project.connect_key}`,
    ...(now ? [`- Subscription now: ${now}`] : []),
    `- Licence check module (Node.js 18 or newer, no packages): ${SITE}/license/zenatiq-license.mjs`,
    `- Licence API: POST ${SITE}/api/license with JSON {"key": "<ZENATIQ_KEY>"}`,
    `- Zenatiq's public key (Ed25519, SPKI DER, base64): ${PUBLIC_KEY} (also at ${SITE}/api/license/key)`,
    `- Message portal: ${SITE}/connect/?key=<ZENATIQ_KEY>`,
    '',
    "The key belongs to this project only. Keep it in the server's environment: a git-ignored .env file and the host's settings (on Vercel: Settings → Environment Variables, for Production). Never commit it, and never put it in frontend code or the built site.",
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
    '- license.state() returns { status, readOnly, verified, stale, package, price, currency, paidUntil, graceUntil, renewUrl, checkedAt, message }. status is active (paid more than 30 days ahead), ending (30 days or fewer), grace (ended, within the grace days), expired (read-only), cancelled, none (a one-time purchase: never read-only) or unknown (not checked yet: the system keeps working). message is the sentence for the banner, or null.',
    "- If the server isn't Node.js: POST the key to the licence API and verify the \"license\" token yourself. It's base64url(JSON payload) + \".\" + base64url(Ed25519 signature), and the signature covers the first part's text exactly as sent. Check it with the public key above, and only use the payload's fields (status, paid_until, grace_until, read_only, renew_url, check_by) when the signature is valid.",
    '',
    '## 2. Banner and read-only messages (frontend)',
    "- After sign-in, fetch /api/license. When message isn't empty, show it in a red bar across the top of the app with a \"Renew now\" link to renewUrl (in a new tab). Remove the bar when message is empty.",
    '- When a save fails with 402 and error.code "read_only", show error.message and the Renew link instead of a generic error.',
    '- Never hide or block pages for reading: read-only only stops changes.',
    '',
    '## 3. "Contact Zenatiq" section',
    '- Add a menu item "Contact Zenatiq", last in the main navigation (in its own "Support" group if the menu has groups), for everyone who can sign in.',
    "- Add a route that gives the key to signed-in users only, behind the app's normal authentication: GET /api/zenatiq/widget returns { \"key\": process.env.ZENATIQ_KEY || null }. The page gets the key from it, so the key is never in the frontend code.",
    '- The page has two cards, styled like the rest of the app:',
    "  - \"Subscription\", from /api/license: the package; the yearly price (currency and price); the status (Active, Ending soon, Renewal due, Expired: read-only, Cancelled, One-time purchase, Not checked yet); paid until, with the days left or how long ago it ended; the last day to renew (graceUntil: read-only after that day); when Zenatiq last confirmed it (checkedAt); the banner message, if any; and a \"Renew now\" button to renewUrl (in a new tab). For status none, say it's a one-time purchase with nothing to renew.",
    `  - "Messages with Zenatiq": an iframe of ${SITE}/connect/?key=<the key from the route>, full width, about 680px high, no border, rounded corners, titled "Messages with Zenatiq". It's Zenatiq's message portal, where the client reports problems, asks for changes and reads Zenatiq's replies. Add a "WhatsApp" button linking to ${WHATSAPP}.`,
    `- Optional: on the menu item, show how many of Zenatiq's replies haven't been read. POST ${SITE}/api/connect with {"op": "threads", "key": "<the key>"} returns {"data": [{"unread": true, …}]}; count the threads with unread true. Refresh it every few minutes and when leaving the page.`,
    "- Don't also add Zenatiq's floating \"Contact with Zenatiq\" button: this page replaces it.",
    '',
    '## Check your work',
    '- Run the app with ZENATIQ_KEY set: /api/license should return verified: true and the subscription above.',
    '- Try the banner, the 402 message and each status on the Subscription card by stubbing what /api/license returns for a moment. Remove the stub afterwards.',
    "- Contact Zenatiq is last in the menu, shows the subscription and the message portal, and the key isn't in any frontend file or any committed file.",
    "- Then tell me what you changed, and what I need to set on the host (ZENATIQ_KEY for Production).",
  ].join('\n');
}
