// Licences, the renewal page and online payments: signed licences (license.js, /api/license), the
// licence check that goes into client systems (frontend/license/zenatiq-license.mjs), the renewal
// page's API (/api/renew), PayHere's payment notifications (/api/payhere/notify) and the widget's
// Subscription tab. It all runs on sample data in memory, and emails are kept in a list.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { MemoryStore } from '../core/memory.js';
import { createPortal, SYSTEM } from '../core/ops.js';
import { today, addDays, addYears, periodEnd } from '../core/renewals.js';
import { newKeyPair, licenseFor, signLicense, readLicense } from '../license.js';
import { createLicense, readLicense as readInSystem } from '../../frontend/license/zenatiq-license.mjs';

delete process.env.MONGODB_URI;
delete process.env.VERCEL;
for (const name of ['PAYHERE_MERCHANT_ID', 'PAYHERE_MERCHANT_SECRET', 'PAYHERE_SANDBOX']) delete process.env[name];
const keys = newKeyPair();
process.env.LICENSE_PRIVATE_KEY = keys.privateKey;

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (vals) => Object.entries(vals).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  apply(values);
  try { return await fn(); } finally { apply(saved); }
}
// Runs fn without the server's expected error messages in the test output.
async function quietly(fn) {
  const { error } = console;
  console.error = () => {};
  try { return await fn(); } finally { console.error = error; }
}

const outbox = [];
const mailer = async (email) => {
  outbox.push(email);
  return { sent: true };
};
const store = new MemoryStore({});
const portal = createPortal(store, { mailer });
const run = (me, op, args) => portal.run(me, op, args);
const day = today();

const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));
const server = createApp({ store, mailer }).listen(0);
servers.push(server);
await once(server, 'listening');
const base = `http://localhost:${server.address().port}`;
async function call(path, { body, raw, type = 'application/json', method = body || raw ? 'POST' : 'GET', origin = base } = {}) {
  const headers = {};
  if (body || raw) headers['Content-Type'] = type;
  if (origin && method === 'POST') headers.Origin = origin;
  const res = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}
const folders = [];
after(() => Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true }))));
async function tempFile(name) {
  const dir = await mkdtemp(join(tmpdir(), 'zq-license-'));
  folders.push(dir);
  return join(dir, name);
}

let owner, member, client, pos, site, token;
test('setting up: a POS on a yearly package, and a website bought once', async () => {
  owner = await run(SYSTEM, 'team.add', { row: { email: 'owner@test.lk', full_name: 'Owner Person', role: 'owner' } });
  member = await run(owner, 'team.add', { row: { email: 'member@test.lk', full_name: 'Mo Member' } });
  client = await run(owner, 'clients.add', { row: { name: 'Cargo Traders', contact_name: 'Kamal Perera', email: 'accounts@cargo.example', phone: '+94 77 123 4567' } });
  pos = await run(owner, 'projects.add', { row: { name: 'Cargo POS', client_id: client.id, type: 'pos' } });
  site = await run(owner, 'projects.add', { row: { name: 'Cargo website', client_id: client.id } });
  const sub = await run(owner, 'subscriptions.set', { projectId: pos.id, row: { package: 'POS Business', price: 25000 } });
  token = sub.renew_token;
  assert.match(token, /^[0-9a-f]{48}$/, 'each subscription has a secret renewal link');
  assert.equal(sub.renew_url, `https://www.zenatiqsolutions.com/renew?t=${token}`);
  assert.match(pos.connect_key, /^[0-9a-f]{32,}$/);
  const { setup } = await run(owner, 'subscriptions.list');
  assert.deepEqual(setup, { online: false, sandbox: false, licenses: true }, 'the Renewals page says what is switched on');
});

// --- Licences ------------------------------------------------------------------------------------
test("a licence says what the subscription allows, and is signed so it can't be changed", () => {
  const sub = { package: 'POS Business', ends_on: '2026-12-31', grace_days: 14, renew_token: 'ab'.repeat(24) };
  const project = { id: 'p1', name: 'Cargo POS' };
  const l = licenseFor(project, sub, { day: '2026-12-20', now: new Date('2026-12-20T04:00:00Z') });
  assert.deepEqual(l, {
    v: 1, project: 'p1', name: 'Cargo POS', package: 'POS Business', status: 'ending', paid_until: '2026-12-31',
    grace_until: '2027-01-14', read_only: false, renew_url: `https://www.zenatiqsolutions.com/renew?t=${'ab'.repeat(24)}`,
    issued_at: '2026-12-20T04:00:00.000Z', check_by: '2026-12-27T04:00:00.000Z',
  });
  assert.equal(licenseFor(project, sub, { day: '2027-01-14' }).read_only, false, 'the last grace day');
  assert.equal(licenseFor(project, sub, { day: '2027-01-15' }).read_only, true, 'read-only after the grace days');
  const none = licenseFor(project, null);
  assert.ok(none.status === 'none' && none.read_only === false && none.paid_until === null && none.renew_url === null, 'a one-time purchase');

  const signed = signLicense(l);
  assert.deepEqual(readLicense(signed, keys.publicKey), l);
  assert.deepEqual(readInSystem(signed, keys.publicKey), l, 'client systems read it the same way');
  const signature = signed.split('.')[1];
  const edited = Buffer.from(JSON.stringify({ ...l, paid_until: '2099-12-31' })).toString('base64url');
  assert.equal(readLicense(`${edited}.${signature}`, keys.publicKey), null, 'an edited licence fails');
  assert.equal(readInSystem(`${edited}.${signature}`, keys.publicKey), null);
  assert.equal(readInSystem(signed, newKeyPair().publicKey), null, 'so does one signed with another key');
  assert.equal(readInSystem('nonsense', keys.publicKey), null);
});
test('/api/license gives any website a signed licence for its project key', async () => {
  const r = await call('/api/license', { body: { key: pos.connect_key }, origin: 'https://pos.cargo.example' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const l = readLicense(r.json.license, keys.publicKey);
  assert.ok(l.project === pos.id && l.status === 'active' && l.paid_until === periodEnd(day) && l.read_only === false, JSON.stringify(l));
  assert.equal(l.renew_url, `https://www.zenatiqsolutions.com/renew?t=${token}`);
  assert.equal(r.json.status, 'active', 'and unsigned too, for reading');
  const bought = await call('/api/license', { body: { key: site.connect_key } });
  assert.ok(bought.json.status === 'none' && bought.json.read_only === false, 'a one-time purchase never goes read-only');
  for (const key of [undefined, 'short', 'g'.repeat(40), 'ab'.repeat(20), { $ne: null }]) {
    const bad = await call('/api/license', { body: { key } });
    assert.ok(bad.status === 403 && bad.json.error.code === 'bad_key', JSON.stringify(key));
  }
  assert.deepEqual((await call('/api/license/key')).json, { alg: 'Ed25519', format: 'spki-der-base64', public_key: keys.publicKey });
  assert.equal((await call('/api/license')).status, 405);
  const preflight = await fetch(`${base}/api/license`, { method: 'OPTIONS' });
  assert.ok(preflight.status === 204 && preflight.headers.get('access-control-allow-methods').includes('POST'));
  for (const value of [undefined, 'not-a-key']) {
    await withEnv({ LICENSE_PRIVATE_KEY: value }, async () => {
      const off = await call('/api/license', { body: { key: pos.connect_key } });
      assert.ok(off.status === 503 && off.json.error.code === 'license_not_configured', JSON.stringify(off.json));
    });
  }
});

// --- The licence check inside client systems ------------------------------------------------------
test('the licence check: asks Zenatiq, then keeps working from its saved licence without internet', async () => {
  const file = await tempFile('licence.json');
  let clock = Date.now();
  const options = { key: pos.connect_key, file, url: `${base}/api/license`, publicKey: keys.publicKey, now: () => clock };
  const online = await createLicense(options).refresh();
  assert.ok(online.verified && online.status === 'active' && !online.readOnly && !online.stale && online.message === null, JSON.stringify(online));
  assert.ok(JSON.parse(await readFile(file, 'utf8')).token, 'saved for when the internet drops');

  const offline = createLicense({ ...options, fetch: async () => { throw new Error('no internet'); } });
  const s = await offline.refresh();
  assert.ok(s.verified && s.status === 'active' && !s.readOnly, JSON.stringify(s));
  clock += 8 * 864e5;
  const week = offline.state();
  assert.ok(week.stale && !week.readOnly && /connect to the internet/.test(week.message), 'a week without checking still works, but asks to connect');

  await writeFile(file, JSON.stringify({ token: 'edited.licence', checkedAt: clock, lastSeen: clock }));
  const edited = await createLicense({ ...options, fetch: async () => { throw new Error('no internet'); } }).refresh();
  assert.ok(!edited.verified && edited.status === 'unknown' && !edited.readOnly && /Couldn't reach Zenatiq/.test(edited.message), JSON.stringify(edited));
});
test("offline, it still goes read-only when the grace days run out, and turning the clock back doesn't help", async () => {
  const file = await tempFile('gloss.json');
  const issued = Date.now();
  const sub = { package: 'POS Basic', ends_on: addDays(day, 2), grace_days: 14, renew_token: 'cd'.repeat(24) };
  await writeFile(file, JSON.stringify({ token: signLicense(licenseFor({ id: 'p9', name: 'Gloss POS' }, sub, { now: new Date(issued) })), checkedAt: issued, lastSeen: issued }));
  let clock = issued;
  const options = { key: 'ef'.repeat(16), file, publicKey: keys.publicKey, now: () => clock, fetch: async () => { throw new Error('no internet'); } };
  const license = createLicense(options);
  let s = await license.refresh();
  assert.ok(s.status === 'ending' && !s.readOnly && /ends in 2 days/.test(s.message), JSON.stringify(s));
  clock += 5 * 864e5;
  s = license.state();
  assert.ok(s.status === 'grace' && !s.readOnly && /Renew within 12 days/.test(s.message), JSON.stringify(s));
  clock += 12 * 864e5;
  s = await license.refresh();
  assert.ok(s.status === 'expired' && s.readOnly && /read-only until it's renewed/.test(s.message), JSON.stringify(s));
  clock -= 30 * 864e5;
  assert.equal(license.state().readOnly, true, 'the clock turned back');
  assert.equal((await createLicense(options).refresh()).readOnly, true, 'the clock turned back and the system restarted');
});
test('the read-only guard refuses changes, lets reading and signing in through, and notices a renewal', async () => {
  await run(owner, 'subscriptions.set', { projectId: pos.id, row: { package: 'POS Business', price: 25000, starts_on: addYears(addDays(day, -19), -1), ends_on: addDays(day, -20) } });
  let clock = Date.now();
  const license = createLicense({ key: pos.connect_key, url: `${base}/api/license`, publicKey: keys.publicKey, now: () => clock });
  assert.equal((await license.refresh()).readOnly, true);
  const guard = license.readOnlyGuard({ allow: ['/login'] });
  const through = (method, path) => new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { resolve({ status: this.statusCode, type: this.headers['content-type'], body: JSON.parse(body) }); },
    };
    guard({ method, path }, res, () => resolve('next'));
  });
  assert.equal(await through('GET', '/sales'), 'next');
  assert.equal(await through('POST', '/login'), 'next');
  const refused = await through('POST', '/sales');
  assert.ok(refused.status === 402 && refused.body.error.code === 'read_only' && /read-only/.test(refused.body.error.message), JSON.stringify(refused));
  assert.equal(refused.body.error.renew_url, `https://www.zenatiqsolutions.com/renew?t=${token}`);

  await run(owner, 'subscriptions.renew', { projectId: pos.id, method: 'bank_transfer' });
  assert.equal((await through('POST', '/sales')).status, 402, 'it checked a moment ago, so it waits before asking again');
  clock += 11 * 60e3;
  assert.equal(await through('POST', '/sales'), 'next', 'it asked Zenatiq again, and the renewal counts');
  assert.equal(license.state().status, 'active');
});

// --- The renewal page --------------------------------------------------------------------------------
test('the renewal page shows what is due, the bank details, and the years to choose from', async () => {
  await run(owner, 'renewals.saveSettings', { bank_details: 'Bank: Test Bank\nAccount: 123' });
  assert.equal((await run(owner, 'renewals.settings')).bank_details, 'Bank: Test Bank\nAccount: 123');
  const { subscription } = await run(owner, 'subscriptions.get', { projectId: pos.id });
  const r = await call('/api/renew', { body: { op: 'info', token } });
  const info = r.json;
  assert.ok(r.status === 200 && info.project === 'Cargo POS' && info.client === 'Cargo Traders' && info.package === 'POS Business', JSON.stringify(info));
  assert.ok(info.price === 25000 && info.currency === 'LKR' && info.status === 'active' && info.paid_until === subscription.ends_on);
  assert.deepEqual(info.options, [1, 2, 3].map((years) => ({ years, amount: 25000 * years, paid_until: addYears(subscription.ends_on, years) })));
  assert.ok(info.bank_details === 'Bank: Test Bank\nAccount: 123' && info.online === false && info.whatsapp, JSON.stringify(info));
  assert.deepEqual(info.customer, { name: 'Kamal Perera', email: 'accounts@cargo.example', phone: '+94 77 123 4567', address: '' });
});
test('renewal links: wrong tokens, other websites, and settings for owners and admins only', async () => {
  for (const t of [undefined, 'abc', 'f'.repeat(48), { $ne: null }]) {
    const r = await call('/api/renew', { body: { op: 'info', token: t } });
    assert.ok(r.status === 404 && r.json.error.code === 'bad_link', JSON.stringify(t));
  }
  assert.equal((await call('/api/renew', { body: { op: 'info', token }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/renew', { raw: JSON.stringify({ op: 'info', token }), type: 'text/plain' })).status, 415);
  assert.equal((await call('/api/renew')).status, 405);
  assert.equal((await call('/api/renew', { body: { op: 'nope', token } })).status, 404);
  await assert.rejects(run(member, 'renewals.settings'), { code: 'forbidden' });
  await assert.rejects(run(member, 'renewals.saveSettings', { bank_details: 'x' }), { code: 'forbidden' });
  await assert.rejects(run(owner, 'renewals.saveSettings', { bank_details: 'x'.repeat(2001) }), { message: /too long/ });
});
test('older subscriptions get their renewal link the first time one is needed', async () => {
  const old = await run(owner, 'projects.add', { row: { name: 'Old POS', client_id: client.id } });
  await run(owner, 'subscriptions.set', { projectId: old.id, row: { package: 'POS Basic', price: 15000 } });
  delete store.data.subscriptions.find((s) => s.project_id === old.id).renew_token;
  const { subscription } = await run(owner, 'subscriptions.get', { projectId: old.id });
  assert.match(subscription.renew_token, /^[0-9a-f]{48}$/);
  assert.equal((await store.col('subscriptions').findOne({ project_id: old.id })).renew_token, subscription.renew_token, 'and keeps it');
});
test('reminder emails link to the renewal page', async () => {
  outbox.length = 0;
  await run(owner, 'subscriptions.remind', { projectId: pos.id });
  const [email] = outbox;
  assert.ok(email.text.includes(`https://www.zenatiqsolutions.com/renew?t=${token}`) && email.html.includes('Renew now'), email.text);
});

// --- Paying online with PayHere -------------------------------------------------------------------------
const PAYHERE = { PAYHERE_MERCHANT_ID: '1211149', PAYHERE_MERCHANT_SECRET: 'test-merchant-secret', PAYHERE_SANDBOX: '1' };
const md5 = (text) => createHash('md5').update(text).digest('hex').toUpperCase();
const buyer = { name: 'Kamal Perera', email: 'Kamal@Cargo.example', phone: '0771234567', address: '12 Main Street', city: 'Kandy' };
const checkout = (years = 1, extra = {}, t = token) => call('/api/renew', { body: { op: 'checkout', token: t, years, ...buyer, ...extra } });
const orderOf = (id) => store.col('orders').findOne({ id });
const paidUntil = async () => (await run(owner, 'subscriptions.get', { projectId: pos.id })).subscription.ends_on;
// A notification the way PayHere sends one: a form, signed with the merchant secret.
const notice = ({ order, amount, code = 2, currency = 'LKR', paymentId = '320025071278' }) => {
  const payhereAmount = Number(amount).toFixed(2);
  return {
    merchant_id: '1211149', order_id: order, payment_id: paymentId, payhere_amount: payhereAmount, payhere_currency: currency,
    status_code: String(code), md5sig: md5(`1211149${order}${payhereAmount}${currency}${code}${md5('test-merchant-secret')}`),
  };
};
const notify = (fields) => call('/api/payhere/notify', { raw: new URLSearchParams(fields).toString(), type: 'application/x-www-form-urlencoded', origin: null });

test('paying online is off until PayHere is set up', async () => {
  const r = await checkout();
  assert.ok(r.status === 503 && r.json.error.code === 'online_off', JSON.stringify(r.json));
});
let order;
test('paying online: a PayHere checkout form, signed with the merchant secret', () => withEnv(PAYHERE, async () => {
  const info = (await call('/api/renew', { body: { op: 'info', token } })).json;
  assert.ok(info.online === true && info.sandbox === true);
  assert.equal((await checkout(4)).status, 400, 'only 1, 2 or 3 years');
  assert.equal((await checkout(1, { email: 'not an email' })).status, 400);
  assert.equal((await checkout(1, { phone: '  ' })).status, 400);
  const r = await checkout(2);
  const { action, fields } = r.json;
  assert.ok(r.status === 200 && action === 'https://sandbox.payhere.lk/pay/checkout', JSON.stringify(r.json));
  assert.ok(fields.merchant_id === '1211149' && fields.amount === '50000.00' && fields.currency === 'LKR', JSON.stringify(fields));
  assert.ok(fields.first_name === 'Kamal' && fields.last_name === 'Perera' && fields.email === 'kamal@cargo.example' && fields.city === 'Kandy' && fields.country === 'Sri Lanka');
  assert.equal(fields.hash, md5(`1211149${fields.order_id}50000.00LKR${md5('test-merchant-secret')}`));
  assert.equal(fields.return_url, `${base}/renew?t=${token}&order=${fields.order_id}`);
  assert.equal(fields.cancel_url, `${base}/renew?t=${token}`);
  assert.equal(fields.notify_url, `${base}/api/payhere/notify`);
  order = await orderOf(fields.order_id);
  assert.ok(order.status === 'pending' && order.years === 2 && order.amount === 50000 && order.project_id === pos.id, JSON.stringify(order));
  assert.deepEqual((await call('/api/renew', { body: { op: 'order', token, order: order.id } })).json, { status: 'pending', years: 2, amount: 50000, currency: 'LKR', paid_until: null });
  assert.equal((await call('/api/renew', { body: { op: 'order', token, order: 'ZQNOTANORDER' } })).status, 404);
  await withEnv({ PAYHERE_SANDBOX: undefined }, async () => assert.equal((await checkout()).json.action, 'https://www.payhere.lk/pay/checkout', 'real payments'));
}));
test('a genuine PayHere payment renews the subscription once, and thanks the client', () => withEnv(PAYHERE, async () => {
  const before = await paidUntil();
  outbox.length = 0;
  assert.equal((await notify({ ...notice({ order: order.id, amount: 50000 }), md5sig: 'A'.repeat(32) })).status, 403, 'a forged signature');
  assert.equal((await notify({ ...notice({ order: order.id, amount: 50000 }), merchant_id: '999' })).status, 403, 'another merchant');
  assert.equal((await notify(notice({ order: 'ZQUNKNOWN', amount: 50000 }))).status, 404);
  assert.equal(await paidUntil(), before, 'none of those renewed anything');

  assert.deepEqual((await notify(notice({ order: order.id, amount: 50000 }))).json, { ok: true });
  const renewed = await paidUntil();
  assert.equal(renewed, addYears(before, 2));
  const payment = (await run(owner, 'money.payments', { projectId: pos.id })).find((p) => p.reference === 'PayHere 320025071278');
  assert.ok(payment.kind === 'renewal' && payment.amount === 50000 && payment.method === 'online', JSON.stringify(payment));
  assert.equal((await orderOf(order.id)).status, 'paid');
  assert.equal(outbox.length, 1);
  assert.ok(outbox[0].to === 'kamal@cargo.example' && outbox[0].subject.startsWith('Renewed: Cargo POS is paid until'), JSON.stringify(outbox[0]));
  assert.match(outbox[0].text, /received your payment of LKR 50,000[\s\S]*Payment reference: PayHere 320025071278/);
  assert.deepEqual((await call('/api/renew', { body: { op: 'order', token, order: order.id } })).json, { status: 'paid', years: 2, amount: 50000, currency: 'LKR', paid_until: renewed });

  await notify(notice({ order: order.id, amount: 50000 }));
  assert.equal(await paidUntil(), renewed, 'PayHere sent it twice, but it renewed once');
  assert.equal(outbox.length, 1);
  await quietly(() => notify(notice({ order: order.id, amount: 50000, code: -3 })));
  const reversed = await orderOf(order.id);
  assert.ok(reversed.status === 'paid' && reversed.charged_back_at, 'a payment reversed later is noted on the order');
}));
test('failed, cancelled and wrong-amount payments renew nothing', () => withEnv(PAYHERE, async () => {
  const before = await paidUntil();
  const start = async () => (await checkout()).json.fields.order_id;
  const failed = await start();
  await notify(notice({ order: failed, amount: 25000, code: -2 }));
  assert.equal((await call('/api/renew', { body: { op: 'order', token, order: failed } })).json.status, 'failed');
  const cancelled = await start();
  await notify(notice({ order: cancelled, amount: 25000, code: -1 }));
  assert.equal((await orderOf(cancelled)).status, 'cancelled');
  const short = await start();
  const r = await notify(notice({ order: short, amount: 2500 }));
  assert.ok(r.status === 400 && r.json.error.code === 'mismatch' && (await orderOf(short)).status === 'amount_mismatch', JSON.stringify(r.json));
  assert.equal((await notify(notice({ order: await start(), amount: 25000, currency: 'USD' }))).status, 400);
  assert.equal(await paidUntil(), before);
}));
test("if the renewal can't be recorded, the order isn't marked paid, so PayHere's next notification can try again", () => withEnv(PAYHERE, async () => {
  const id = (await checkout()).json.fields.order_id;
  const sub = await store.col('subscriptions').findOne({ project_id: pos.id });
  await store.col('subscriptions').deleteOne({ id: sub.id });
  const r = await quietly(() => notify(notice({ order: id, amount: 25000, paymentId: '777' })));
  assert.notEqual(r.status, 200);
  assert.equal((await orderOf(id)).status, 'pending');
  await store.col('subscriptions').insertOne(sub);
  assert.equal((await notify(notice({ order: id, amount: 25000, paymentId: '777' }))).status, 200);
  assert.ok((await orderOf(id)).status === 'paid' && (await paidUntil()) === addYears(sub.ends_on, 1));
}));
test('at most 10 payment attempts an hour for each subscription', () => withEnv(PAYHERE, async () => {
  const gloss = await run(owner, 'projects.add', { row: { name: 'Gloss POS', client_id: client.id } });
  const sub = await run(owner, 'subscriptions.set', { projectId: gloss.id, row: { package: 'POS Basic', price: 15000 } });
  for (let i = 0; i < 10; i++) assert.equal((await checkout(1, {}, sub.renew_token)).status, 200);
  const r = await checkout(1, {}, sub.renew_token);
  assert.ok(r.status === 429 && r.json.error.code === 'rate_limited', JSON.stringify(r.json));
}));

// --- The widget's Subscription tab ------------------------------------------------------------------------
test("the widget's Subscription tab shows the package, the date and the renewal link", async () => {
  const widget = (key) => call('/api/connect', { body: { op: 'subscription', key }, origin: 'https://pos.cargo.example' });
  const s = (await widget(pos.connect_key)).json.data;
  assert.deepEqual(Object.keys(s).sort(), ['days_left', 'grace_days', 'package', 'paid_until', 'price', 'currency', 'renew_url', 'status'].sort());
  assert.ok(s.package === 'POS Business' && s.price === 25000 && s.status === 'active' && s.paid_until === (await paidUntil()), JSON.stringify(s));
  assert.equal(s.renew_url, `https://www.zenatiqsolutions.com/renew?t=${token}`);
  assert.equal((await widget(site.connect_key)).json.data, null, 'nothing for a one-time purchase');

  const ending = { package: 'POS Business', price: 25000, starts_on: addYears(addDays(day, 6), -1), ends_on: addDays(day, 5) };
  await run(owner, 'subscriptions.set', { projectId: pos.id, row: ending });
  await run(owner, 'subscriptions.cancel', { projectId: pos.id });
  assert.equal((await widget(pos.connect_key)).json.data.status, 'cancelled', 'a stopped subscription shows until its paid days run out');
  await run(owner, 'subscriptions.set', { projectId: pos.id, row: { ...ending, starts_on: addYears(addDays(day, -1), -1), ends_on: addDays(day, -2) } });
  assert.equal((await widget(pos.connect_key)).json.data, null, 'and then not at all');
});
