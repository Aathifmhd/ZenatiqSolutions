// The API over HTTP, the way the portal and the widget use it: password sign-in and sessions, the
// emails with temporary passwords, request checks, the widget API, setup problems, the local demo
// and the pages. It all runs on sample data in memory, and emails are kept in a list.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { createDemo } from '../demo.js';
import { HttpError } from '../http.js';
import { MemoryStore } from '../core/memory.js';
import { createPortal, SYSTEM } from '../core/ops.js';

delete process.env.MONGODB_URI;
delete process.env.VERCEL;

// Emails land here instead of being sent. With mailDown set, sending fails the way Resend would.
const outbox = [];
let mailDown = false;
const mailer = async (email) => {
  if (mailDown) throw new HttpError("The email couldn't be sent: Resend is down.", 'email_failed', 502);
  outbox.push(email);
  return { sent: true };
};
const passwordFor = (to) => outbox.findLast((m) => m.to === to)?.text.match(/Temporary password: (\S+)/)?.[1];

// Starts an app on a free port. Returns a helper that calls it like a browser on that site would.
const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));
async function serve(app) {
  const server = app.listen(0);
  servers.push(server);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  return async (path, { body, cookie, origin = base, type = 'application/json', method = body ? 'POST' : 'GET', raw } = {}) => {
    const headers = {};
    if (body || raw) headers['Content-Type'] = type;
    if (cookie) headers.Cookie = cookie;
    if (origin && method === 'POST') headers.Origin = origin;
    const res = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, text };
  };
}
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

// Runs fn with some settings changed (undefined removes one), then puts them back.
async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (vals) => Object.entries(vals).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  apply(values);
  try { return await fn(); } finally { apply(saved); }
}

const store = new MemoryStore({});
const api = await serve(createApp({ store, mailer }));
const signIn = (email, password, newPassword) => api('/api/auth', { body: { op: 'signin', email, password, newPassword } });
const run = (cookie, op, args = {}) => api('/api/portal', { body: { op, args }, cookie });
const changePassword = (cookie, password, newPassword) => api('/api/auth', { body: { op: 'password', password, newPassword }, cookie });

// --- The first owner, and choosing a password ---------------------------------------------------
let owner, ownerCookie;
let ownerPassword = 'owner-password-1';
test('status before anyone signs in', async () => {
  const r = await api('/api/auth');
  assert.deepEqual(r.json, { configured: true, me: null });
  assert.equal(r.headers.get('cache-control'), 'no-store', 'API answers must not be cached');
});
test('the first owner is added from the command line and emailed a temporary password', async () => {
  // What `npm run member -- add` does.
  const added = await createPortal(store, { mailer }).run(SYSTEM, 'team.add', {
    row: { email: 'Owner@Test.lk', full_name: 'Owner Person', role: 'owner', job_title: 'Founder' },
  });
  assert.ok(added.role === 'owner' && added.job_title === 'Founder' && added.invite.emailed === true, JSON.stringify(added));
  const email = outbox.at(-1);
  assert.equal(email.to, 'owner@test.lk');
  assert.match(email.text, /^Hi Owner Person,/);
  assert.match(email.text, /Username: owner@test\.lk/);
  assert.match(passwordFor('owner@test.lk'), /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  assert.match(email.html, /Sign in to the portal/);
  const [log] = await store.col('activity').find({}, { sort: { id: -1 }, limit: 1 });
  assert.equal(log.actor_label, 'System');
});
test('a temporary password asks for their own password before signing in', async () => {
  const r = await signIn('owner@test.lk', passwordFor('owner@test.lk'));
  assert.deepEqual(r.json, { mustChange: true });
  assert.equal(r.headers.get('set-cookie'), null, 'no session yet');
});
test('the new password must be long enough and different', async () => {
  const temp = passwordFor('owner@test.lk');
  for (const weak of ['short', temp, 'owner@test.lk']) {
    const r = await signIn('owner@test.lk', temp, weak);
    assert.ok(r.status === 400 && r.json.error.code === 'weak_password', `${weak}: ${JSON.stringify(r.json)}`);
  }
});
test('choosing a password signs them in', async () => {
  const r = await signIn('OWNER@test.lk', passwordFor('owner@test.lk'), ownerPassword);
  assert.ok(r.status === 200 && r.json.me.role === 'owner', JSON.stringify(r.json));
  const set = r.headers.get('set-cookie');
  assert.ok(/zq_session=[A-Za-z0-9_-]{40,}/.test(set) && /HttpOnly/.test(set) && /SameSite=Lax/.test(set) && /Path=\/api/.test(set), set);
  assert.ok(!/Secure/.test(set), 'no Secure flag on http://localhost');
  ownerCookie = cookieOf(r);
  owner = r.json.me;
});
test('the temporary password stops working and their own one works', async () => {
  assert.equal((await signIn('owner@test.lk', passwordFor('owner@test.lk'))).status, 401);
  const r = await signIn('owner@test.lk', ownerPassword);
  assert.equal(r.json.me?.id, owner.id);
});
test('passwords are kept only as scrypt hashes, away from the team list', async () => {
  const [saved] = store.data.credentials;
  assert.match(saved.password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!saved.password_hash.includes(ownerPassword) && saved.temporary === false && saved.expires_at === null);
  const load = await run(ownerCookie, 'load');
  assert.ok(load.status === 200 && !/password|scrypt/i.test(load.text), 'password data must never reach the portal');
});
test('wrong passwords and unknown emails get the same answer', async () => {
  const wrong = await signIn('owner@test.lk', 'not-the-password');
  const unknown = await signIn('nobody@test.lk', 'not-the-password');
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json);
  assert.equal(wrong.json.error.message, "That email and password don't match.");
});
test('sign-in needs an email and a password as text', async () => {
  assert.equal((await signIn('owner@test.lk', '')).status, 400);
  assert.equal((await signIn('owner@test.lk', { $ne: null })).status, 400);
  assert.equal((await signIn({ $ne: null }, ownerPassword)).status, 400);
  assert.equal((await signIn(`${'a'.repeat(300)}@test.lk`, ownerPassword)).status, 400, 'over-long emails');
  assert.equal((await signIn('owner@test.lk', 'x'.repeat(5000))).status, 400, 'over-long passwords');
});

// --- Sessions ----------------------------------------------------------------------------------
test('the session is recognised', async () => {
  assert.equal((await api('/api/auth', { cookie: ownerCookie })).json.me?.id, owner.id);
});
test('only a hash of the session token is stored', () => {
  const token = ownerCookie.split('=')[1];
  assert.ok(store.data.sessions.every((s) => s.id !== token && /^[0-9a-f]{64}$/.test(s.id) && s.expires_at instanceof Date));
});
test('no session: 401', async () => {
  const r = await run(null, 'load');
  assert.ok(r.status === 401 && r.json.error.code === 'signed_out', JSON.stringify(r.json));
});
test('a made-up session: 401', async () => {
  assert.equal((await run('zq_session=abc', 'load')).status, 401);
});
test('another website cannot use the session', async () => {
  const r = await api('/api/portal', { body: { op: 'load' }, cookie: ownerCookie, origin: 'https://evil.example' });
  assert.ok(r.status === 403 && r.json.error.code === 'forbidden', JSON.stringify(r.json));
  const s = await api('/api/auth', { body: { op: 'signin', email: 'owner@test.lk', password: ownerPassword }, origin: 'https://evil.example' });
  assert.equal(s.status, 403, 'nor sign in from there');
});
test('portal requests must be JSON', async () => {
  const r = await api('/api/portal', { raw: JSON.stringify({ op: 'load' }), type: 'text/plain', cookie: ownerCookie, method: 'POST' });
  assert.equal(r.status, 415);
});

// --- Adding people and sending passwords -------------------------------------------------------
let member, memberCookie, admin, adminCookie;
let memberPassword = 'member-password-1';
test('adding someone emails them their username and a temporary password', async () => {
  const r = await run(ownerCookie, 'team.add', { row: { email: 'Member@Test.lk', full_name: 'Mo Member' } });
  assert.ok(r.status === 200 && r.json.data.invite.emailed === true, JSON.stringify(r.json));
  member = r.json.data;
  const email = outbox.at(-1);
  assert.ok(email.to === 'member@test.lk' && /account/.test(email.subject) && /Owner Person added you/.test(email.text), JSON.stringify(email));
  const temp = passwordFor('member@test.lk');
  assert.deepEqual((await signIn('member@test.lk', temp)).json, { mustChange: true });
  const s = await signIn('member@test.lk', temp, memberPassword);
  assert.equal(s.json.me?.role, 'member');
  memberCookie = cookieOf(s);
});
test('if the email fails, they are still added and the problem is shown', async () => {
  mailDown = true;
  try {
    const r = await run(ownerCookie, 'team.add', { row: { email: 'later@test.lk', full_name: 'Lee Later' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.invite, { emailed: false, problem: "The email couldn't be sent: Resend is down." });
    assert.equal((await signIn('later@test.lk', 'any-password-at-all')).status, 401, 'no password until an email goes out');
    const again = await run(ownerCookie, 'team.sendPassword', { id: member.id });
    assert.ok(again.status === 502 && again.json.error.code === 'email_failed', JSON.stringify(again.json));
    assert.equal((await signIn('member@test.lk', memberPassword)).status, 200, 'a failed email leaves the old password working');
  } finally {
    mailDown = false;
  }
});
test('an owner or admin can send someone a new temporary password', async () => {
  const r = await run(ownerCookie, 'team.sendPassword', { id: member.id });
  assert.deepEqual(r.json.data, { emailed: true });
  assert.ok(outbox.at(-1).to === 'member@test.lk' && /new/i.test(outbox.at(-1).subject));
  assert.equal((await run(memberCookie, 'load')).status, 401, 'they are signed out everywhere');
  assert.equal((await signIn('member@test.lk', memberPassword)).status, 401, 'the old password stops working');
  memberPassword = 'member-password-2';
  const s = await signIn('member@test.lk', passwordFor('member@test.lk'), memberPassword);
  assert.equal(s.status, 200);
  memberCookie = cookieOf(s);
  const log = await run(ownerCookie, 'activity.list', { limit: 5 });
  assert.ok(log.json.data.some((a) => a.summary === 'Sent Mo Member a new temporary password'), 'logged');
});
test('only owners and admins send passwords, and only owners to owners', async () => {
  assert.equal((await run(memberCookie, 'team.sendPassword', { id: owner.id })).status, 403);
  admin = (await run(ownerCookie, 'team.add', { row: { email: 'admin@test.lk', full_name: 'Ada Admin', role: 'admin' } })).json.data;
  adminCookie = cookieOf(await signIn('admin@test.lk', passwordFor('admin@test.lk'), 'admin-password-1'));
  const r = await run(adminCookie, 'team.sendPassword', { id: owner.id });
  assert.ok(r.status === 403 && /Only an owner/.test(r.json.error.message), JSON.stringify(r.json));
  assert.equal((await run(adminCookie, 'team.sendPassword', { id: member.id })).status, 200, 'admins can for members');
  memberPassword = 'member-password-3';
  memberCookie = cookieOf(await signIn('member@test.lk', passwordFor('member@test.lk'), memberPassword));
  const self = await run(ownerCookie, 'team.sendPassword', { id: owner.id });
  assert.ok(self.status === 400 && /Change my password/.test(self.json.error.message), JSON.stringify(self.json));
});
test('temporary passwords stop working after 7 days', async () => {
  await run(ownerCookie, 'team.sendPassword', { id: admin.id });
  const saved = store.data.credentials.find((c) => c.member_id === admin.id);
  const days = (saved.expires_at - Date.now()) / 864e5;
  assert.ok(saved.temporary && days > 6.9 && days <= 7, `expires in ${days} days`);
  saved.expires_at = new Date(Date.now() - 1000);
  const r = await signIn('admin@test.lk', passwordFor('admin@test.lk'));
  assert.ok(r.status === 401 && r.json.error.code === 'expired', JSON.stringify(r.json));
});
test('after 10 wrong passwords, that email waits 15 minutes', async () => {
  assert.equal((await signIn('member@test.lk', memberPassword)).status, 200, 'a success starts the count again');
  for (let i = 1; i <= 10; i++) assert.equal((await signIn('member@test.lk', `wrong-${i}`)).status, 401);
  const blocked = await signIn('member@test.lk', memberPassword);
  assert.ok(blocked.status === 429 && blocked.json.error.code === 'rate_limited', JSON.stringify(blocked.json));
  assert.equal((await signIn('owner@test.lk', ownerPassword)).status, 200, 'other emails are not affected');
  for (const attempt of store.data.login_attempts) attempt.at = new Date(Date.now() - 16 * 60e3);
  const later = await signIn('member@test.lk', memberPassword);
  assert.equal(later.status, 200, '15 minutes later it works again');
  memberCookie = cookieOf(later);
});
test('changing your own password needs the current one and signs out your other devices', async () => {
  const otherDevice = cookieOf(await signIn('owner@test.lk', ownerPassword));
  const wrong = await changePassword(ownerCookie, 'not-it', 'owner-password-2');
  assert.ok(wrong.status === 400 && wrong.json.error.code === 'bad_password', JSON.stringify(wrong.json));
  assert.equal((await changePassword(ownerCookie, ownerPassword, 'short')).json.error.code, 'weak_password');
  assert.equal((await changePassword(ownerCookie, ownerPassword, 'owner-password-2')).status, 200);
  ownerPassword = 'owner-password-2';
  assert.equal((await run(otherDevice, 'load')).status, 401, 'the other device is signed out');
  assert.equal((await run(ownerCookie, 'load')).status, 200, 'this one stays signed in');
  assert.equal((await signIn('owner@test.lk', ownerPassword)).status, 200);
  assert.equal((await changePassword(null, ownerPassword, 'owner-password-3')).status, 401, 'needs a session');
});

// --- The portal's other checks ---------------------------------------------------------------
test('members cannot see money over the API', async () => {
  const r = await run(memberCookie, 'money.allFinances');
  assert.ok(r.status === 403 && r.json.error.message === "You don't have permission to do that.", JSON.stringify(r.json));
});
test('validation errors come back as 400 with a message', async () => {
  const r = await run(memberCookie, 'projects.add', { row: { name: '' } });
  assert.ok(r.status === 400 && r.json.error.message === 'Project name is required.', JSON.stringify(r.json));
});
test('unknown operations: 404', async () => {
  const r = await run(memberCookie, 'constructor');
  assert.ok(r.status === 404 && r.json.error.code === 'unknown_op', JSON.stringify(r.json));
  assert.equal((await api('/api/auth', { body: { op: 'google' } })).json.error.code, 'unknown_op', 'Google sign-in is gone');
});
test('GitHub commits are asked for through the portal API', async () => {
  const p = (await run(ownerCookie, 'projects.add', { row: { name: 'No repository yet' } })).json.data;
  const r = await run(memberCookie, 'github.commits', { projectId: p.id });
  assert.ok(r.status === 400 && r.json.error.code === 'no_repo', JSON.stringify(r.json));
});
test('the demo operations do nothing on the real portal', async () => {
  assert.equal((await run(ownerCookie, 'demo.reset')).json.error.code, 'unknown_op');
  assert.equal((await run(ownerCookie, 'demo.clientMessage', { projectId: 'x' })).json.error.code, 'unknown_op');
});
test('invalid JSON: 400', async () => {
  assert.equal((await api('/api/portal', { raw: '{oops', cookie: memberCookie, method: 'POST' })).status, 400);
});
test('removing access ends their session and their sign-in at once', async () => {
  const off = await run(ownerCookie, 'team.update', { id: member.id, patch: { active: false } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal((await run(memberCookie, 'load')).status, 401);
  assert.equal((await signIn('member@test.lk', memberPassword)).status, 401);
  assert.equal((await run(ownerCookie, 'team.sendPassword', { id: member.id })).status, 400, 'no password for someone without access');
});
test('deleting someone deletes their password too', async () => {
  assert.ok(store.data.credentials.some((c) => c.member_id === member.id));
  assert.equal((await run(ownerCookie, 'team.remove', { id: member.id })).status, 200);
  assert.ok(!store.data.credentials.some((c) => c.member_id === member.id));
});

// --- The widget API -------------------------------------------------------------------------
let key;
test('widget API: CORS preflight', async () => {
  const r = await api('/api/connect', { method: 'OPTIONS' });
  assert.ok(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', String(r.status));
});
test('widget API: a client message reaches the portal', async () => {
  key = (await run(ownerCookie, 'projects.add', { row: { name: 'Veloura store' } })).json.data.connect_key;
  // The widget sends text/plain from the client's own website, so browsers skip the preflight.
  const send = (body) => api('/api/connect', { raw: JSON.stringify(body), type: 'text/plain;charset=UTF-8', origin: 'https://client.example', method: 'POST' });
  const r = await send({ op: 'start', key, subject: 'Checkout broken', body: 'Nothing happens', category: 'bug', name: 'Owner' });
  assert.ok(r.status === 200 && r.headers.get('access-control-allow-origin') === '*' && typeof r.json.data === 'string', JSON.stringify(r.json));
  const inbox = await run(ownerCookie, 'threads.list');
  assert.ok(inbox.json.data.some((t) => t.subject === 'Checkout broken' && t.unread_by_team), 'not in the inbox');
  const bad = await send({ op: 'threads', key: 'f'.repeat(64) });
  assert.ok(bad.status === 403 && bad.headers.get('access-control-allow-origin') === '*' && bad.json.error.code === 'bad_key', 'bad key answer');
  assert.equal((await send({ op: 'threads', key: { $ne: null } })).status, 403, 'operator key accepted');
});
test('widget API: only POST', async () => {
  assert.equal((await api('/api/connect')).status, 405);
});
test('very large requests are refused', async () => {
  const r = await api('/api/connect', { raw: JSON.stringify({ op: 'info', key, pad: 'x'.repeat(70000) }), type: 'text/plain', method: 'POST' });
  assert.equal(r.status, 413);
});
test('signing out ends the session', async () => {
  const r = await api('/api/auth', { body: { op: 'signout' }, cookie: ownerCookie });
  assert.ok(r.status === 200 && /Max-Age=0/.test(r.headers.get('set-cookie')), r.headers.get('set-cookie'));
  assert.equal((await run(ownerCookie, 'load')).status, 401);
});

// --- Addresses and methods -------------------------------------------------------------------
test('answers say which deployment sent them, so open portals notice updates', async () => {
  assert.equal((await api('/api/auth')).headers.get('x-portal-build'), null, 'nothing to say on your own computer');
  await withEnv({ VERCEL_DEPLOYMENT_ID: 'dpl_test123' }, async () => {
    const deployed = await serve(createApp({ store: new MemoryStore({}), mailer }));
    assert.equal((await deployed('/api/auth')).headers.get('x-portal-build'), 'dpl_test123');
    assert.equal((await deployed('/api/nothing')).headers.get('x-portal-build'), 'dpl_test123');
  });
});
test('unknown API addresses: 404', async () => {
  const r = await api('/api/nothing');
  assert.ok(r.status === 404 && r.json.error.code === 'not_found', JSON.stringify(r.json));
});
test('wrong methods: 405 with the allowed ones', async () => {
  const a = await api('/api/auth', { method: 'DELETE' });
  assert.ok(a.status === 405 && a.headers.get('allow') === 'GET, POST', `${a.status} ${a.headers.get('allow')}`);
  const p = await api('/api/portal');
  assert.ok(p.status === 405 && p.headers.get('allow') === 'POST', `${p.status} ${p.headers.get('allow')}`);
});

// --- Setup problems give clear answers --------------------------------------------------------
test('not set up yet: says MONGODB_URI is missing', async () => {
  const live = await serve(createApp({ mailer }));
  assert.deepEqual((await live('/api/auth')).json, { configured: false, missing: ['MONGODB_URI'] });
  assert.equal((await live('/api/auth', { body: { op: 'signin', email: 'a@b.lk', password: 'x' } })).status, 503);
  assert.equal((await live('/api/portal', { body: { op: 'load' } })).status, 503);
  assert.equal((await live('/api/connect', { body: { op: 'info' } })).json.error.code, 'not_configured');
});
test('a wrong connection string is explained', () => withEnv({ MONGODB_URI: 'not-a-mongodb-uri' }, async () => {
  const r = await (await serve(createApp({ mailer })))('/api/auth');
  assert.ok(r.status === 503 && r.json.error.code === 'db_settings', JSON.stringify(r.json));
}));
test('an unreachable database is explained', () => withEnv({ MONGODB_URI: 'mongodb://127.0.0.1:1/' }, async () => {
  const r = await (await serve(createApp({ mailer })))('/api/auth');
  assert.ok(r.status === 503 && r.json.error.code === 'db_unreachable' && /Network Access/.test(r.json.error.message), JSON.stringify(r.json));
}));

// --- The local demo ---------------------------------------------------------------------------
test('demo: the sample accounts sign in, a pretend client message arrives, reset keeps the sign-in', async () => {
  const demo = await serve(createApp({ demo: await createDemo() }));
  const status = (await demo('/api/auth')).json;
  assert.deepEqual(status, { configured: true, demo: { email: 'demo@zenatiqsolutions.com', password: 'zenatiq-demo' }, me: null });
  const r = await demo('/api/auth', { body: { op: 'signin', ...status.demo } });
  assert.equal(r.json.me?.role, 'owner', JSON.stringify(r.json));
  const developer = await demo('/api/auth', { body: { op: 'signin', email: 'developer@example.com', password: status.demo.password } });
  assert.equal(developer.json.me?.role, 'admin', 'the other sample people use the same password');
  const cookie = cookieOf(r);
  const call = async (op, args) => (await demo('/api/portal', { body: { op, args }, cookie })).json;

  const { data } = await call('load');
  assert.ok(data.team.length === 3 && data.projects.length === 7, 'sample data');
  const unread = (await call('threads.unreadCount')).data;
  const sent = await call('demo.clientMessage', { projectId: data.projects[0].id, name: 'Test client', category: 'bug', subject: 'Help', body: 'It broke' });
  assert.equal(typeof sent.data, 'string', JSON.stringify(sent));
  assert.equal((await call('threads.unreadCount')).data, unread + 1);
  await call('demo.reset');
  assert.equal((await call('threads.unreadCount')).data, unread, 'the sample data is back and the sign-in still works');
});
test('the demo never sends real email, even with a Resend key in .env', () => withEnv({ RESEND_API_KEY: 're_real_key_in_env' }, async () => {
  const demo = await serve(createApp({ demo: await createDemo() }));
  const sample = (await demo('/api/auth')).json.demo;
  const cookie = cookieOf(await demo('/api/auth', { body: { op: 'signin', ...sample } }));
  const realFetch = globalThis.fetch;
  const printed = [];
  const log = console.log;
  let resendCalled = false;
  globalThis.fetch = (url, init) => {
    if (String(url).includes('resend.com')) resendCalled = true;
    return realFetch(url, init);
  };
  console.log = (line) => printed.push(line);
  try {
    const r = await demo('/api/portal', { body: { op: 'team.add', args: { row: { email: 'someone@example.com', full_name: 'Some One' } } }, cookie });
    assert.deepEqual(r.json.data.invite, { emailed: false });
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
  }
  assert.equal(resendCalled, false, 'Resend must not be called from the demo');
  assert.match(printed.join('\n'), /Email, not sent \(demo\)[\s\S]*To: someone@example\.com/);
}));
test('the demo refuses to run on Vercel', async () => {
  const demo = await createDemo();
  await withEnv({ VERCEL: '1' }, () => assert.throws(() => createApp({ demo }), /own computer/));
});

// --- Pages -------------------------------------------------------------------------------------
test('pages are served the way Vercel serves them', async () => {
  const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
  const site = await serve(createApp({ store: new MemoryStore({}), mailer, pages: frontend }));
  const file = (name) => readFileSync(frontend + name, 'utf8');
  for (const [path, name] of [['/', 'index.html'], ['/about', 'about.html'], ['/admin', 'admin/index.html'], ['/connect', 'connect/index.html']]) {
    const r = await site(path);
    assert.ok(r.status === 200 && r.text === file(name), `${path} should show ${name}`);
  }
  assert.match((await site('/admin/js/app.js')).headers.get('content-type'), /javascript/);
  const missing = await site('/no-such-page');
  assert.ok(missing.status === 404 && missing.text === file('404.html'), 'the 404 page');
  assert.equal((await site('/api/nothing')).json.error.code, 'not_found', 'API addresses are never pages');
});
