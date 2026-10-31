/*!
 * Zenatiq licence check, for the systems Zenatiq builds (POS systems, online shops, admin panels).
 *
 * It asks Zenatiq whether the system's yearly subscription is paid, checks Zenatiq's signature on
 * the answer, and keeps the last licence in a file, so the system keeps working for days without
 * internet. After the subscription's grace days run out, it says the system is read-only: people
 * can still sign in, look things up and export their data, but can't make changes.
 *
 * Node 18 or newer, no other packages. In the system's server:
 *
 *   import { createLicense } from './zenatiq-license.mjs';
 *   const license = createLicense({ key: process.env.ZENATIQ_KEY, file: '.zenatiq-license.json' });
 *   await license.start();                    // checks now, then once a day
 *   app.use(license.readOnlyGuard({ allow: ['/login', '/logout'] }));  // Express: no changes when read-only
 *   license.state();                          // { status, readOnly, message, renewUrl, ... } for banners
 *   await license.refresh();                  // checks again now, for example when someone signs in
 *
 * ZENATIQ_KEY is the project's key from its Widget tab in the Zenatiq admin portal.
 */
import { createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Zenatiq's public key. Only Zenatiq's private key can sign a licence that matches it.
export const ZENATIQ_PUBLIC_KEY = 'MCowBQYDK2VwAyEA54ujyCWNnSk8RaY3slPCYb3FxdmiIO8gpYa0wcw7DdM=';
const LICENSE_URL = 'https://www.zenatiqsolutions.com/api/license';
const DAY = 864e5;
const RECHECK = 10 * 60e3; // while read-only, ask again before refusing a change, at most this often

// The licence inside a signed licence, or null if Zenatiq's signature doesn't match.
export function readLicense(token, publicKey = ZENATIQ_PUBLIC_KEY) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(body), key, Buffer.from(signature, 'base64url'))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Dates are days in Sri Lanka time, as Zenatiq's portal counts them.
const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const longDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function createLicense({
  key, file = null, url = LICENSE_URL, publicKey = ZENATIQ_PUBLIC_KEY, every = DAY,
  fetch: fetchFn = globalThis.fetch, now = () => Date.now(),
} = {}) {
  let saved = null; // { token, licence, checkedAt, lastSeen }
  let problem = null;
  let timer = null;
  let pending = null;
  let lastTry = 0;

  async function load() {
    if (saved || !file) return;
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      const licence = readLicense(data.token, publicKey);
      if (licence) saved = { token: data.token, licence, checkedAt: data.checkedAt || 0, lastSeen: data.lastSeen || 0 };
    } catch { /* no saved licence yet */ }
  }
  async function save() {
    if (!file || !saved) return;
    await writeFile(file, JSON.stringify({ token: saved.token, checkedAt: saved.checkedAt, lastSeen: saved.lastSeen })).catch(() => {});
  }

  // Asks Zenatiq for the current licence. Never throws: without internet, the saved one still counts.
  // Checks that overlap share one request.
  function refresh() {
    pending ||= check().finally(() => { pending = null; });
    return pending;
  }
  async function check() {
    lastTry = now();
    await load();
    try {
      const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const json = await res.json().catch(() => null);
      const licence = res.ok && json?.license ? readLicense(json.license, publicKey) : null;
      if (licence) {
        saved = { token: json.license, licence, checkedAt: now(), lastSeen: Math.max(now(), saved?.lastSeen || 0) };
        problem = null;
      } else {
        problem = json?.error?.message || (res.ok ? "Zenatiq's signature didn't match" : `Zenatiq answered ${res.status}`);
      }
    } catch {
      problem = "Couldn't reach Zenatiq to check the licence";
    }
    // Saved after every check, even one that failed, so the latest time seen survives a restart.
    const current = state();
    await save();
    return current;
  }

  // Where the subscription stands now, worked out from the saved licence's dates, so a system
  // that's offline still goes read-only on time. Turning the computer's clock back doesn't help.
  function state() {
    const at = Math.max(now(), saved?.lastSeen || 0);
    if (saved && at > saved.lastSeen) saved.lastSeen = at;
    const l = saved?.licence;
    if (!l) {
      return { status: 'unknown', readOnly: false, verified: false, stale: true, package: null, paidUntil: null, graceUntil: null, renewUrl: null,
        message: problem ? `${problem}. The system keeps working until it can check.` : null };
    }
    const today = dayOf(at);
    let status = l.status;
    if (l.paid_until && status !== 'cancelled') {
      const left = daysBetween(today, l.paid_until);
      status = left > 30 ? 'active' : left >= 0 ? 'ending' : today <= l.grace_until ? 'grace' : 'expired';
    }
    const readOnly = Boolean(l.grace_until) && today > l.grace_until;
    const stale = at > Date.parse(l.check_by);
    return {
      status, readOnly, verified: true, stale, package: l.package, paidUntil: l.paid_until, graceUntil: l.grace_until, renewUrl: l.renew_url,
      message: messageFor(status, l, today, readOnly, stale),
    };
  }

  // Express (or Connect) middleware: while read-only, anything but reading is refused with 402.
  // Before refusing, it asks Zenatiq again (at most every 10 minutes), so a renewal switches the
  // system back on straight away. allow: paths that must keep working, such as signing in and out.
  function readOnlyGuard({ allow = [] } = {}) {
    return async (req, res, next) => {
      const path = req.path || String(req.url || '').split('?')[0];
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || allow.some((p) => path.startsWith(p))) return next();
      let s = state();
      if (s.readOnly && now() - lastTry >= RECHECK) s = await refresh();
      if (!s.readOnly) return next();
      res.statusCode = 402;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { code: 'read_only', message: s.message, renew_url: s.renewUrl } }));
    };
  }

  // Checks now, then every `every` milliseconds (a day), without keeping the process alive.
  function start() {
    if (!timer) {
      timer = setInterval(refresh, every);
      timer.unref?.();
    }
    return refresh();
  }
  const stop = () => { clearInterval(timer); timer = null; };

  return { refresh, start, stop, state, readOnlyGuard };
}

// The sentence for a banner, or null when nothing needs saying.
function messageFor(status, l, today, readOnly, stale) {
  const offline = stale ? ' (Not checked online for a while: please connect to the internet.)' : '';
  if (readOnly) return `Your ${l.package} subscription ended on ${longDate(l.paid_until)}. The system is read-only until it's renewed.${offline}`;
  if (status === 'grace') {
    const left = daysBetween(today, l.grace_until) + 1;
    return `Your ${l.package} subscription ended on ${longDate(l.paid_until)}. Renew within ${left} day${left === 1 ? '' : 's'} to keep using everything.${offline}`;
  }
  if (status === 'ending') {
    const left = daysBetween(today, l.paid_until);
    return `Your ${l.package} subscription ends ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}. Renew to keep it running without a break.${offline}`;
  }
  return stale ? `The licence hasn't been checked online for a while: please connect to the internet.` : null;
}
