// Yearly subscriptions: the date rules (core/renewals.js), the portal's subscription operations,
// the reminder emails, and the daily job behind /api/cron/renewals.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { today, addDays, addYears, periodEnd, daysBetween, statusOf, dueReminder } from '../core/renewals.js';
import { createPortal, SYSTEM } from '../core/ops.js';
import { MemoryStore } from '../core/memory.js';
import { createApp } from '../app.js';

delete process.env.MONGODB_URI;
delete process.env.VERCEL;

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (vals) => Object.entries(vals).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  apply(values);
  try { return await fn(); } finally { apply(saved); }
}

// --- Dates and statuses --------------------------------------------------------------------
test('dates: a year from a day, leap years, and today in Sri Lanka', () => {
  assert.equal(periodEnd('2026-11-01'), '2027-10-31', 'a year paid from 1 Nov runs to 31 Oct');
  assert.equal(periodEnd('2026-11-01', 2), '2028-10-31');
  assert.equal(addYears('2027-10-31', 1), '2028-10-31');
  assert.equal(addYears('2028-02-29', 1), '2029-02-28', '29 February has no match next year');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-01', '2026-12-01'), 30);
  assert.equal(today(new Date('2026-10-31T20:00:00Z')), '2026-11-01', 'Sri Lanka is 5½ hours ahead of UTC');
});
test('statuses around the paid-until date', () => {
  const sub = { ends_on: '2026-12-31', grace_days: 14 };
  assert.equal(statusOf(sub, '2026-11-30'), 'active', '31 days left');
  assert.equal(statusOf(sub, '2026-12-01'), 'ending', '30 days left');
  assert.equal(statusOf(sub, '2026-12-31'), 'ending', 'the last paid day');
  assert.equal(statusOf(sub, '2027-01-01'), 'grace');
  assert.equal(statusOf(sub, '2027-01-14'), 'grace', 'the 14th grace day');
  assert.equal(statusOf(sub, '2027-01-15'), 'expired');
  assert.equal(statusOf({ ...sub, cancelled: true }, '2026-12-20'), 'cancelled');
});
test('reminders: 30, 14, 7 and 1 days before, after it ends, and when it expires, each once', () => {
  const sub = { ends_on: '2026-12-31', grace_days: 14, reminders: [] };
  const on = (day) => dueReminder(sub, day);
  assert.equal(on('2026-11-30'), null, 'nothing more than 30 days ahead');
  assert.deepEqual(on('2026-12-01'), { stage: 'before', key: '2026-12-31:before:30', left: 30 });
  assert.equal(on('2026-12-05').key, '2026-12-31:before:30', "a missed day's reminder still goes");
  sub.reminders.push('2026-12-31:before:30');
  assert.equal(on('2026-12-05'), null, 'but only once');
  assert.equal(on('2026-12-17').key, '2026-12-31:before:14');
  assert.equal(on('2026-12-24').key, '2026-12-31:before:7');
  assert.deepEqual(on('2026-12-31'), { stage: 'before', key: '2026-12-31:before:1', left: 0 });
  assert.deepEqual(on('2027-01-01'), { stage: 'ended', key: '2026-12-31:ended:-1', left: -1 });
  assert.equal(on('2027-01-15').stage, 'expired');
  assert.equal(on('2027-01-22').stage, 'expired', 'up to a week late');
  assert.equal(on('2027-01-23'), null, 'no surprise email about a long-expired subscription');
  assert.equal(dueReminder({ ...sub, cancelled: true }, '2026-12-17'), null, 'none once cancelled');
  assert.equal(dueReminder({ ...sub, ends_on: '2027-12-31' }, '2027-12-01').key, '2027-12-31:before:30', 'a renewal starts them again');
});

// --- The portal's subscription operations ---------------------------------------------------------------
const outbox = [];
let mailDown = false;
const mailer = async (email) => {
  if (mailDown) throw new Error('Resend is down');
  outbox.push(email);
  return { sent: true };
};
const store = new MemoryStore({});
const portal = createPortal(store, { mailer });
const run = (me, op, args) => portal.run(me, op, args);
const day = today();
let owner, member, project, client;

test('setting up: owners and admins only, with sensible defaults', async () => {
  owner = await run(SYSTEM, 'team.add', { row: { email: 'owner@test.lk', full_name: 'Owner Person', role: 'owner' } });
  member = await run(owner, 'team.add', { row: { email: 'member@test.lk', full_name: 'Mo Member' } });
  client = await run(owner, 'clients.add', { row: { name: 'Cargo Traders', email: 'accounts@cargo.example' } });
  project = await run(owner, 'projects.add', { row: { name: 'Cargo POS', client_id: client.id, type: 'pos' } });
  outbox.length = 0;
  for (const op of ['subscriptions.list', 'subscriptions.get', 'subscriptions.set', 'subscriptions.renew', 'subscriptions.remind', 'subscriptions.runReminders']) {
    await assert.rejects(run(member, op, { projectId: project.id, row: { package: 'x', price: 1 } }), { code: 'forbidden' }, op);
  }
  const sub = await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: '25,000' } });
  assert.ok(sub.starts_on === day && sub.ends_on === periodEnd(day) && sub.grace_days === 14 && sub.price === 25000 && sub.currency === 'LKR', JSON.stringify(sub));
  assert.ok(sub.status === 'active' && sub.days_left === daysBetween(day, periodEnd(day)) && !('reminders' in sub), 'shown with its status');
});
test('setting up checks its fields', async () => {
  const set = (row) => run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, ...row } });
  await assert.rejects(set({ package: '  ' }), { message: /Package is required/ });
  await assert.rejects(set({ price: 'abc' }), { message: /Yearly price must be a number/ });
  await assert.rejects(set({ starts_on: '2026-11-01', ends_on: '2026-10-01' }), { message: /on or after the start date/ });
  await assert.rejects(set({ grace_days: 100 }), { message: /0 to 90/ });
  await assert.rejects(set({ email: 'not an email' }), { message: /doesn't look like an email/ });
  await assert.rejects(run(owner, 'subscriptions.set', { projectId: { $ne: null }, row: { package: 'x', price: 1 } }), { code: 'not_found' });
});
test('a renewal within the grace days carries on from the old date, and is recorded as a renewal payment', async () => {
  const endedYesterday = addDays(day, -1);
  await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, starts_on: addYears(day, -1), ends_on: endedYesterday } });
  assert.equal((await run(owner, 'subscriptions.get', { projectId: project.id })).subscription.status, 'grace');
  const renewed = await run(owner, 'subscriptions.renew', { projectId: project.id, method: 'cash', reference: 'R-12' });
  assert.ok(renewed.ends_on === addYears(endedYesterday, 1) && renewed.status === 'active', JSON.stringify(renewed));
  const [payment] = await run(owner, 'money.payments', { projectId: project.id });
  assert.ok(payment.kind === 'renewal' && payment.amount === 25000 && payment.method === 'cash' && payment.reference === 'R-12', JSON.stringify(payment));
  assert.match(payment.note, /Yearly renewal: POS Business, paid until/);
  const { renewals } = await run(owner, 'subscriptions.get', { projectId: project.id });
  assert.ok(renewals.length === 1 && renewals[0].from_ends_on === endedYesterday && renewals[0].payment_id === payment.id, JSON.stringify(renewals));
  const [log] = await run(owner, 'activity.list', { projectId: project.id, limit: 1 });
  assert.ok(log.action === 'subscription.renewed' && log.admin_only, 'logged for owners and admins');
  assert.equal((await run(member, 'activity.list', { projectId: project.id, limit: 50 })).some((a) => a.action.startsWith('subscription.')), false, 'members never see it');
});
test('a renewal after the grace days starts on the payment day; two years cost twice the price', async () => {
  const lapsed = addDays(day, -30);
  await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, starts_on: addYears(lapsed, -1), ends_on: lapsed } });
  const renewed = await run(owner, 'subscriptions.renew', { projectId: project.id, years: 2 });
  assert.ok(renewed.starts_on === day && renewed.ends_on === periodEnd(day, 2), JSON.stringify(renewed));
  assert.equal((await run(owner, 'money.payments', { projectId: project.id }))[0].amount, 50000);
  await assert.rejects(run(owner, 'subscriptions.renew', { projectId: project.id, years: 9 }), { message: /1 to 5 years/ });
  const free = await run(owner, 'subscriptions.renew', { projectId: project.id, amount: 0 });
  assert.equal(free.ends_on, addYears(periodEnd(day, 2), 1));
  assert.equal((await run(owner, 'money.payments', { projectId: project.id })).length, 2, 'a free renewal records no payment');
});
test('cancelling stops reminders; recording a renewal restarts it', async () => {
  await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, ends_on: addDays(day, 7), starts_on: addYears(addDays(day, 8), -1) } });
  assert.equal((await run(owner, 'subscriptions.cancel', { projectId: project.id })).status, 'cancelled');
  outbox.length = 0;
  assert.deepEqual((await run(owner, 'subscriptions.runReminders')).sent, []);
  assert.equal(outbox.length, 0);
  assert.equal((await run(owner, 'subscriptions.renew', { projectId: project.id })).status, 'active');
});
test("'Email a reminder now' goes to the subscription's email, or else the client's", async () => {
  outbox.length = 0;
  await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, ends_on: addDays(day, 10), starts_on: addYears(addDays(day, 11), -1) } });
  assert.deepEqual(await run(owner, 'subscriptions.remind', { projectId: project.id }), { to: 'accounts@cargo.example', emailed: true });
  const email = outbox.at(-1);
  assert.ok(email.subject.startsWith('Renewal reminder: Cargo POS is paid until') && /in 10 days/.test(email.text) && /LKR 25,000/.test(email.text), email.text);
  assert.match(email.text, /^Hi Cargo Traders,/);
  await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, email: 'Owner@Cargo.example' } });
  assert.equal((await run(owner, 'subscriptions.remind', { projectId: project.id })).to, 'owner@cargo.example');
  const bare = await run(owner, 'projects.add', { row: { name: 'No email' } });
  await run(owner, 'subscriptions.set', { projectId: bare.id, row: { package: 'Website Care', price: 12000 } });
  await assert.rejects(run(owner, 'subscriptions.remind', { projectId: bare.id }), { code: 'no_email' });
});
test('the daily job sends each due reminder once, as System, and notes when it ran', async () => {
  const cargo = await run(owner, 'subscriptions.set', { projectId: project.id, row: { package: 'POS Business', price: 25000, email: null, starts_on: addYears(addDays(day, 31), -1), ends_on: addDays(day, 30) } });
  assert.equal(cargo.status, 'ending');
  outbox.length = 0;
  const first = await portal.sendDueReminders();
  assert.deepEqual(first.sent, [{ project: 'Cargo POS', to: 'accounts@cargo.example', stage: 'before' }]);
  assert.ok(first.failed.length === 0 && outbox.length === 1 && /in 30 days/.test(outbox[0].text), JSON.stringify(first));
  assert.deepEqual((await portal.sendDueReminders()).sent, [], 'the same reminder never goes twice');
  const [log] = await run(owner, 'activity.list', { projectId: project.id, limit: 1 });
  assert.ok(log.actor_label === 'System' && /Emailed accounts@cargo.example a renewal reminder for Cargo POS: it ends in 30 days/.test(log.summary), log.summary);
  const { remindersRanAt } = await run(owner, 'subscriptions.list');
  assert.ok(remindersRanAt && Date.now() - Date.parse(remindersRanAt) < 60e3, 'the Renewals page can say when it last ran');
});
test('a reminder that fails is reported and tried again next time', async () => {
  const later = await run(owner, 'projects.add', { row: { name: 'Gloss site', client_id: client.id } });
  await run(owner, 'subscriptions.set', { projectId: later.id, row: { package: 'Website Care', price: 12000, starts_on: addYears(addDays(day, 8), -1), ends_on: addDays(day, 7) } });
  mailDown = true;
  try {
    const failed = await portal.sendDueReminders();
    assert.deepEqual(failed.failed, [{ project: 'Gloss site', problem: 'Resend is down' }]);
  } finally {
    mailDown = false;
  }
  assert.deepEqual((await portal.sendDueReminders()).sent.map((s) => s.project), ['Gloss site']);
});
test('deleting a subscription keeps its payments; deleting the project removes everything', async () => {
  const before = (await run(owner, 'money.payments', { projectId: project.id })).length;
  await run(owner, 'subscriptions.remove', { projectId: project.id });
  assert.equal((await run(owner, 'subscriptions.get', { projectId: project.id })).subscription, null);
  assert.equal((await run(owner, 'money.payments', { projectId: project.id })).length, before);
  const gone = await run(owner, 'projects.add', { row: { name: 'Short-lived' } });
  await run(owner, 'subscriptions.set', { projectId: gone.id, row: { package: 'Website Care', price: 12000 } });
  await run(owner, 'subscriptions.renew', { projectId: gone.id });
  await run(owner, 'projects.remove', { id: gone.id });
  for (const name of ['subscriptions', 'renewals']) assert.equal(await store.col(name).countDocuments({ project_id: gone.id }), 0, name);
});

// --- The daily job's address --------------------------------------------------------------------
const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));
test('/api/cron/renewals only runs for Vercel Cron, with CRON_SECRET', () => withEnv({ CRON_SECRET: 'cron-test-secret' }, async () => {
  const server = createApp({ store, mailer }).listen(0);
  servers.push(server);
  await once(server, 'listening');
  const url = `http://localhost:${server.address().port}/api/cron/renewals`;
  const call = (authorization) => fetch(url, authorization ? { headers: { authorization } } : {});
  assert.equal((await call()).status, 401);
  assert.equal((await call('Bearer wrong-secret')).status, 401);
  assert.equal((await call('Bearer cron-test-secret-but-longer')).status, 401);
  const ok = await call('Bearer cron-test-secret');
  const body = await ok.json();
  assert.ok(ok.status === 200 && body.day === day && Array.isArray(body.sent) && Array.isArray(body.failed), JSON.stringify(body));
  await withEnv({ CRON_SECRET: undefined }, async () => assert.equal((await call('Bearer undefined')).status, 401, 'no secret set: closed'));
}));
