// ZenPOS licences: the Key Maker (core/ops.js), ZenPOS's licence and package requests
// (core/zenpos.js through /api/license and /api/connect), the renewal page and Buy page API
// (/api/zenpos), online payments, bank slips and reminders. ZenPOS itself is finished, so these
// follow its contract: the ZenPOS project's docs/zenatiq-website-zenpos-key-maker-prompt.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../app.js';
import { MemoryStore } from '../core/memory.js';
import { createPortal, SYSTEM } from '../core/ops.js';
import { today, addDays, addYears, periodEnd } from '../core/renewals.js';
import { newKeyPair, readLicense } from '../license.js';
import { SERVICES } from '../core/zenpos.js';

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

const outbox = [];
const mailer = async (email) => { outbox.push(email); return { sent: true }; };
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
let ipCount = 0;
async function call(path, body, { ip = `10.0.0.${++ipCount % 250}`, origin = base, type = 'application/json', raw } = {}) {
  const headers = { 'Content-Type': type, 'X-Forwarded-For': ip };
  if (origin) headers.Origin = origin;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const check = (key, device, extra = {}) => call('/api/license', { key, product: 'zenpos', device, version: '1.0.0', ...extra });
const licenceOf = (r) => readLicense(r.json.license, keys.publicKey);
const PC1 = 'ZP-AWGK-4Y7X-JMH0';
const PC2 = 'ZP-9QRT-2XYZ-8KMN';

let owner, member, lic, key;
test('only owners and admins can use the Key Maker', async () => {
  owner = await run(SYSTEM, 'team.add', { row: { email: 'owner@test.lk', full_name: 'Owner Person', role: 'owner' } });
  member = await run(owner, 'team.add', { row: { email: 'member@test.lk', full_name: 'Mo Member' } });
  for (const op of ['zenpos.list', 'zenpos.get', 'zenpos.create', 'zenpos.key', 'zenpos.renew', 'zenpos.move', 'zenpos.offlineCode', 'zenpos.cancel']) {
    await assert.rejects(run(member, op, { id: 'x', row: { shop: 'x' } }), { code: 'forbidden' }, op);
  }
});
test('a new licence: a ZPOS key, a year from the start date, 14 days to renew, and the first payment', async () => {
  outbox.length = 0;
  await assert.rejects(run(owner, 'zenpos.create', { row: { shop: 'Master Mobile' } }), { message: /Owner's name is required/ });
  const made = await run(owner, 'zenpos.create', {
    row: { shop: 'Master Mobile', owner: 'Rizwan', phone: '077 123 4567', email: 'Rizwan@Master.lk', starts_on: '2026-11-01' },
    paid: { method: 'cash', reference: 'Receipt 7' },
  });
  ({ licence: lic, key } = made);
  assert.match(key, /^ZPOS-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.ok(lic.licence_id === 'ZL-000001' && lic.package === 'ZenPOS Yearly' && lic.price === 15000 && lic.currency === 'LKR', JSON.stringify(lic));
  assert.ok(lic.paid_until === '2027-10-31' && lic.grace_until === '2027-11-14', 'start 1 Nov 2026: paid until 31 Oct 2027, renew by 14 Nov');
  assert.ok(lic.key === `ZPOS-…${key.slice(-4)}` && lic.email === 'rizwan@master.lk' && lic.device === null);
  assert.ok(!JSON.stringify(store.data.zenpos_licences).includes(key.slice(5)), 'the key is not stored as it is');
  assert.deepEqual(await run(owner, 'zenpos.key', { id: lic.id }), { key }, 'but staff can show it again');
  assert.equal(await run(owner, 'zenpos.findKey', { key: key.toLowerCase().replace(/-/g, ' ') }), lic.id, 'search by the whole key');
  const { payments, events } = await run(owner, 'zenpos.get', { id: lic.id });
  assert.ok(payments.length === 1 && payments[0].amount === 15000 && payments[0].reference === 'Receipt 7', JSON.stringify(payments));
  assert.match(events[0].summary, /Created for Master Mobile/);
  assert.equal((await run(owner, 'zenpos.create', { row: { shop: 'Second Shop', owner: 'A', phone: '1' } })).licence.licence_id, 'ZL-000002');
});

// --- ZenPOS's requests ------------------------------------------------------------------------------
test("activating: the first computer gets the licence, signed with Zenatiq's key, in ZenPOS's format", async () => {
  const r = await check(key.toLowerCase().replace(/-/g, ' '), PC1.toLowerCase());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json), ['license']);
  const l = licenceOf(r);
  assert.deepEqual(Object.keys(l), ['product', 'licence_id', 'key', 'shop', 'device', 'status', 'package', 'price', 'currency', 'paid_until', 'grace_until', 'renew_url', 'check_by', 'issued_at']);
  assert.ok(l.product === 'zenpos' && l.licence_id === 'ZL-000001' && l.key === key && l.shop === 'Master Mobile' && l.device === PC1, JSON.stringify(l));
  assert.ok(l.status === 'active' && l.package === 'ZenPOS Yearly' && l.price === 15000 && l.currency === 'LKR' && l.paid_until === '2027-10-31' && l.grace_until === '2027-11-14');
  assert.match(l.renew_url, /^https:\/\/www\.zenatiqsolutions\.com\/renew\/zenpos\?t=[0-9a-f]{48}$/);
  assert.match(l.issued_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
  assert.equal(Date.parse(l.check_by) - Date.parse(l.issued_at), 7 * 864e5, 'check again within 7 days');
  const saved = store.data.zenpos_licences.find((x) => x.id === lic.id);
  assert.ok(saved.device === PC1 && saved.bound_at && saved.version === '1.0.0' && saved.last_check_at, 'bound, with the last check');
});
test('another computer, an unknown key and a missing Computer ID get messages for the shop owner', async () => {
  const other = await check(key, PC2);
  assert.deepEqual(other, { status: 409, json: { error: { code: 'device_mismatch', message: 'This licence key is already used on another computer. Contact Zenatiq to move it.' } } });
  const unknown = await check('ZPOS-AAAA-BBBB-CCCC-DDDD', PC1);
  assert.deepEqual(unknown, { status: 404, json: { error: { code: 'invalid_key', message: "That licence key isn't known to Zenatiq. Check the key, or WhatsApp Zenatiq on 075 811 2170." } } });
  assert.equal((await check('ZPOS-nonsense', PC1)).json.error.code, 'invalid_key');
  assert.equal((await check(key, 'not a computer')).json.error.code, 'bad_device');
});
test('"What\'s included" for a ZenPOS key, from /api/connect', async () => {
  const r = await call('/api/connect', { op: 'package', key, product: 'zenpos' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.services, [
    'Service and help on WhatsApp and by phone, all year',
    'Small updates and changes during the subscription',
    'Fixes and new versions of ZenPOS',
    'Help with setup, the receipt printer and backups',
  ]);
  assert.equal((await call('/api/connect', { op: 'package', key: 'ZPOS-AAAA-BBBB-CCCC-DDDD', product: 'zenpos' })).json.error.code, 'invalid_key');
  assert.equal((await call('/api/connect', { op: 'threads', key, product: 'zenpos' })).status, 404);
});
test('project keys still get the same licences and widget answers', async () => {
  const project = await run(owner, 'projects.add', { row: { name: 'GMS Hardware' } });
  const r = await call('/api/license', { key: project.connect_key });
  assert.ok(r.status === 200 && r.json.license && r.json.status === 'none' && r.json.project === project.id, JSON.stringify(r.json));
  assert.equal((await call('/api/connect', { op: 'package', key: project.connect_key })).json.data.type, 'one_time');
});
test('at most 30 licence checks a minute from one internet address', async () => {
  const ip = '10.9.9.9';
  for (let i = 0; i < 30; i++) assert.equal((await call('/api/license', { key, product: 'zenpos', device: PC1 }, { ip })).status, 200);
  const r = await call('/api/license', { key, product: 'zenpos', device: PC1 }, { ip });
  assert.ok(r.status === 429 && r.json.error.code === 'rate_limited', JSON.stringify(r.json));
});

// --- The Key Maker ------------------------------------------------------------------------------------
test('moving to another computer: the new one activates, the old one is cancelled at its next check', async () => {
  await assert.rejects(run(owner, 'zenpos.move', { id: lic.id, device: 'ZP-123' }), { message: /doesn't look like a Computer ID/ });
  const moved = await run(owner, 'zenpos.move', { id: lic.id, device: PC2 });
  assert.equal(moved.device, PC2);
  assert.equal(licenceOf(await check(key, PC2)).status, 'active', 'the new computer');
  const old = licenceOf(await check(key, PC1));
  assert.ok(old.device === PC1 && old.status === 'cancelled' && old.grace_until === addDays(day, -1), JSON.stringify(old));
  assert.equal((await check(key, 'ZP-0000-1111-2222')).status, 409, 'a third computer is still turned away');
  const { events } = await run(owner, 'zenpos.get', { id: lic.id });
  assert.match(events[0].summary, new RegExp(`Moved from ${PC1} to ${PC2}`));
});
test('recording a payment: renewing early adds the new year after the current one; ZenPOS sees it at its next check', async () => {
  outbox.length = 0;
  const { licence, emailed } = await run(owner, 'zenpos.renew', { id: lic.id, method: 'bank_transfer', reference: 'BOC 123', paid_on: '2027-10-20' });
  assert.ok(licence.paid_until === '2028-10-31' && licence.grace_until === '2028-11-14' && emailed, JSON.stringify(licence));
  assert.ok(outbox[0].to === 'rizwan@master.lk' && /paid until 31 October 2028/.test(outbox[0].text), 'a receipt');
  assert.equal(licenceOf(await check(key, PC2)).paid_until, '2028-10-31');
  const late = await run(owner, 'zenpos.renew', { id: lic.id, amount: '15,000', method: 'cash', paid_on: '2028-11-10' });
  assert.equal(late.licence.paid_until, periodEnd('2028-11-10'), 'paid after the paid-until date: a year from the payment day');
  assert.equal((await run(owner, 'zenpos.get', { id: lic.id })).payments.length, 3);
});
test('an offline licence code: signed, with the key, only for the computer the licence is on', async () => {
  const { code, device } = await run(owner, 'zenpos.offlineCode', { id: lic.id, device: PC2.toLowerCase() });
  const l = readLicense(code, keys.publicKey);
  assert.ok(device === PC2 && l.device === PC2 && l.key === key && l.status === 'active', JSON.stringify(l));
  await assert.rejects(run(owner, 'zenpos.offlineCode', { id: lic.id, device: PC1 }), { message: /Move it to ZP-AWGK-4Y7X-JMH0 first/ });
  const fresh = (await run(owner, 'zenpos.create', { row: { shop: 'No Internet Shop', owner: 'B', phone: '2' } })).licence;
  const offline = await run(owner, 'zenpos.offlineCode', { id: fresh.id, device: PC1 });
  assert.ok(readLicense(offline.code, keys.publicKey).device === PC1 && (await run(owner, 'zenpos.get', { id: fresh.id })).licence.device === PC1, 'binds an unused licence');
});
test('cancelling: ZenPOS goes read-only at its next check; restoring switches it back on', async () => {
  await run(owner, 'zenpos.cancel', { id: lic.id });
  const l = licenceOf(await check(key, PC2));
  assert.ok(l.status === 'cancelled' && l.grace_until === addDays(day, -1), JSON.stringify(l));
  assert.equal((await run(owner, 'zenpos.list')).licences.find((x) => x.id === lic.id).state, 'cancelled');
  await run(owner, 'zenpos.cancel', { id: lic.id, cancelled: false });
  assert.equal(licenceOf(await check(key, PC2)).status, 'active');
});

// --- The renewal page, online payments, bank slips and the Buy page ---------------------------------
const PAYHERE = { PAYHERE_MERCHANT_ID: '1211149', PAYHERE_MERCHANT_SECRET: 'test-merchant-secret', PAYHERE_SANDBOX: '1' };
const md5 = (text) => createHash('md5').update(text).digest('hex').toUpperCase();
const token = () => store.data.zenpos_licences.find((x) => x.id === lic.id).renew_token;
const page = (op, body = {}) => call('/api/zenpos', { op, token: token(), ...body });
const notice = (order, amount, code = 2) => {
  const a = Number(amount).toFixed(2);
  return new URLSearchParams({
    merchant_id: '1211149', order_id: order, payment_id: '320000000009', payhere_amount: a, payhere_currency: 'LKR', status_code: String(code),
    md5sig: md5(`1211149${order}${a}LKR${code}${md5('test-merchant-secret')}`),
  }).toString();
};

test('the renewal page: the shop, the dates, what is included and the terms', async () => {
  const r = await page('info');
  const i = r.json;
  assert.ok(r.status === 200 && i.shop === 'Master Mobile' && i.licence_id === 'ZL-000001' && i.package === 'ZenPOS Yearly' && i.price === 15000, JSON.stringify(i));
  assert.deepEqual(i.services, SERVICES);
  assert.ok(i.terms.some((t) => /not refundable/.test(t)) && i.terms.some((t) => /14 days to renew/.test(t)) && i.terms[0].startsWith('Yearly subscription: LKR 15,000 a year for one computer'));
  assert.ok(i.online === false && i.renews_to === addYears(i.paid_until, 1));
  assert.equal((await call('/api/zenpos', { op: 'info', token: 'f'.repeat(48) })).json.error.code, 'bad_link');
  assert.equal((await call('/api/zenpos', { op: 'info', token: token() }, { origin: 'https://evil.example' })).status, 403);
});
test('paying online: a PayHere form for a year, then PayHere confirms it once', () => withEnv(PAYHERE, async () => {
  outbox.length = 0;
  const before = (await page('info')).json.paid_until;
  const r = await page('checkout', { name: 'Rizwan Ahamed', email: 'pay@master.lk', phone: '0771234567' });
  const { fields } = r.json;
  assert.ok(r.status === 200 && fields.amount === '15000.00' && fields.items.startsWith('ZenPOS Yearly for Master Mobile (ZL-000001)'), JSON.stringify(r.json));
  assert.equal(fields.return_url, `${base}/renew/zenpos?t=${token()}&order=${fields.order_id}`);
  const raw = notice(fields.order_id, 15000);
  const paid = await call('/api/payhere/notify', null, { raw, type: 'application/x-www-form-urlencoded', origin: null });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  const after = (await page('info')).json.paid_until;
  assert.equal(after, addYears(before, 1));
  await call('/api/payhere/notify', null, { raw, type: 'application/x-www-form-urlencoded', origin: null });
  assert.equal((await page('info')).json.paid_until, after, 'PayHere sent it twice, but it renewed once');
  assert.deepEqual((await page('order', { order: fields.order_id })).json, { status: 'paid', amount: 15000, currency: 'LKR', paid_until: after });
  assert.ok(outbox.some((e) => e.to === 'pay@master.lk' && /PayHere 320000000009/.test(e.text)), 'the receipt goes to the payer');
}));
test('a bank slip: the shop sends a photo, staff approve it in the Key Maker', async () => {
  const photo = `data:image/jpeg;base64,${Buffer.from('a small picture').toString('base64')}`;
  assert.equal((await page('slip', { image: 'data:text/html;base64,PGI+' })).status, 400);
  assert.deepEqual((await page('slip', { image: photo, reference: 'BOC 998', payer: 'Rizwan' })).json, { received: true });
  const { slips } = await run(owner, 'zenpos.list');
  assert.ok(slips.length === 1 && slips[0].licence_id === 'ZL-000001' && !('image' in slips[0]), JSON.stringify(slips));
  assert.equal(await run(owner, 'zenpos.slip', { id: slips[0].id }), photo);
  const before = (await run(owner, 'zenpos.get', { id: lic.id })).licence.paid_until;
  const { licence } = await run(owner, 'zenpos.approveSlip', { id: slips[0].id });
  assert.equal(licence.paid_until, addYears(before, 1));
  await assert.rejects(run(owner, 'zenpos.approveSlip', { id: slips[0].id }), { message: /already been checked/ });
  assert.equal((await run(owner, 'zenpos.get', { id: lic.id })).payments[0].reference, 'BOC 998');
});
test('the Buy ZenPOS page: a request, which becomes a licence in the Key Maker', async () => {
  const ip = '10.7.7.7';
  const ask = (body) => call('/api/zenpos', { op: 'request', ...body }, { ip });
  assert.equal((await ask({ shop: 'City Phones', name: 'Nimal' })).status, 400, 'a phone number is needed');
  assert.equal((await ask({ shop: 'City Phones', name: 'Nimal', phone: '0712345678', device: 'ZP-12' })).status, 400, 'a Computer ID that looks wrong');
  assert.deepEqual((await ask({ shop: 'City Phones', name: 'Nimal', phone: '0712345678', device: 'zp-awgk-4y7x-jmh1' })).json, { received: true });
  const [request] = (await run(owner, 'zenpos.list')).requests;
  assert.ok(request.shop === 'City Phones' && request.device === 'ZP-AWGK-4Y7X-JMH1', JSON.stringify(request));
  const made = await run(owner, 'zenpos.create', { row: { shop: request.shop, owner: request.name, phone: request.phone }, requestId: request.id });
  assert.equal(made.licence.request, request.id);
  assert.equal((await run(owner, 'zenpos.list')).requests.length, 0, 'done');
  for (let i = 0; i < 4; i++) await ask({ shop: `Shop ${i}`, name: 'N', phone: '1' });
  assert.equal((await ask({ shop: 'One more', name: 'N', phone: '1' })).status, 429);
});

// --- Reminders ----------------------------------------------------------------------------------------
test('reminders: 30, 7 and 1 days before and the day after, each once, and a daily list for the team', async () => {
  const soon = await run(owner, 'zenpos.create', {
    row: { shop: 'Soon Mobile', owner: 'Kamal', phone: '3', email: 'kamal@soon.lk', starts_on: addDays(addYears(day, -1), 8) },
  });
  assert.equal(soon.licence.days_left, 7);
  outbox.length = 0;
  const first = await portal.sendDueReminders();
  assert.deepEqual(first.zenpos.sent, [{ licence: soon.licence.licence_id, shop: 'Soon Mobile', to: 'kamal@soon.lk', stage: 'before' }]);
  assert.ok(outbox.some((e) => e.to === 'kamal@soon.lk' && /in 7 days/.test(e.text) && e.text.includes('/renew/zenpos?t=')), 'with the renewal link');
  assert.ok(outbox.some((e) => e.to === 'owner@test.lk' && /Soon Mobile/.test(e.text) && /ends in 7 days/.test(e.text)), 'the list for owners and admins');
  assert.ok(!outbox.some((e) => e.to === 'member@test.lk'), 'not for members');
  assert.deepEqual((await portal.sendDueReminders()).zenpos.sent, [], 'the same reminder never goes twice');
  const manual = await run(owner, 'subscriptions.runReminders');
  assert.equal(manual.zenpos, undefined, '"Send today\'s reminders now" leaves ZenPOS to the daily run');
});
