// Packages: one-time purchases (free updates and services for 2 months after going live) and yearly
// subscriptions, what each includes, and the widget API's "package" request that client systems'
// Contact Zenatiq pages use.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { MemoryStore } from '../core/memory.js';
import { createPortal, SYSTEM } from '../core/ops.js';
import { today, addDays, addMonths } from '../core/renewals.js';
import { PACKAGES, FREE_SUPPORT_MONTHS, freeSupportUntil } from '../core/packages.js';

delete process.env.MONGODB_URI;
delete process.env.VERCEL;

const store = new MemoryStore({});
const portal = createPortal(store, { mailer: async () => ({ sent: true }) });
const run = (me, op, args) => portal.run(me, op, args);
const day = today();

const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));
const server = createApp({ store, mailer: async () => ({ sent: true }) }).listen(0);
servers.push(server);
await once(server, 'listening');
const widget = async (op, key) => {
  const res = await fetch(`http://localhost:${server.address().port}/api/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, key }),
  });
  return { status: res.status, json: await res.json() };
};

test('months, and the end of the free updates and services', () => {
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28', 'the 31st becomes the last day of a shorter month');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29', 'a leap year');
  assert.equal(FREE_SUPPORT_MONTHS, 2);
  assert.equal(freeSupportUntil('2026-11-01'), '2026-12-31', 'live on 1 November: free until the end of December');
  assert.equal(freeSupportUntil('2027-01-15'), '2027-03-14');
});

let owner, member;
test('a one-time purchase going live gets 2 months of free updates and services; a yearly one does not', async () => {
  owner = await run(SYSTEM, 'team.add', { row: { email: 'owner@test.lk', full_name: 'Owner Person', role: 'owner' } });
  member = await run(owner, 'team.add', { row: { email: 'member@test.lk', full_name: 'Mo Member' } });
  const shop = await run(owner, 'projects.add', { row: { name: 'Gloss shop', status: 'review' } });
  assert.equal(shop.support_until, null, 'not live yet');
  const live = await run(member, 'projects.update', { id: shop.id, patch: { status: 'live' } });
  assert.equal(live.support_until, freeSupportUntil(day), 'set the day it goes live');
  await run(owner, 'projects.update', { id: shop.id, patch: { status: 'maintenance' } });
  assert.equal((await run(owner, 'projects.update', { id: shop.id, patch: { status: 'live' } })).support_until, freeSupportUntil(day), 'kept when it goes live again');
  const moved = await run(owner, 'projects.update', { id: shop.id, patch: { support_until: addDays(day, 90) } });
  assert.equal(moved.support_until, addDays(day, 90), 'the team can change the date');
  await assert.rejects(run(owner, 'projects.update', { id: shop.id, patch: { support_until: '31/12/2026' } }), { message: /Free updates and services until/ });

  const already = await run(owner, 'projects.add', { row: { name: 'Amore site', status: 'live' } });
  assert.equal(already.support_until, freeSupportUntil(day), 'created already live');
  const yearlyLive = await run(owner, 'projects.add', { row: { name: 'Regal ERP', status: 'live', billing: 'yearly' } });
  assert.equal(yearlyLive.support_until, null, 'a yearly subscription instead');
  const pos = await run(owner, 'projects.add', { row: { name: 'Cargo POS', status: 'review' } });
  await run(owner, 'subscriptions.set', { projectId: pos.id, row: { package: 'POS Business', price: 25000 } });
  assert.equal((await run(owner, 'projects.update', { id: pos.id, patch: { status: 'live' } })).support_until, null, 'yearly: its subscription covers it');
});
test("everyone sees each project's package type, but not the subscription", async () => {
  const { projects } = await run(member, 'load');
  const type = Object.fromEntries(projects.map((p) => [p.name, p.billing]));
  assert.deepEqual(type, { 'Gloss shop': 'one_time', 'Amore site': 'one_time', 'Regal ERP': 'one_time', 'Cargo POS': 'yearly' });
  assert.ok(projects.every((p) => !('price' in p) && !('subscription' in p)));
  await assert.rejects(run(member, 'subscriptions.list'), { code: 'forbidden' });
});
test('the package request: what a one-time purchase includes, and until when it is free', async () => {
  const shop = (await run(owner, 'load')).projects.find((p) => p.name === 'Gloss shop');
  const r = await widget('package', shop.connect_key);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, {
    type: 'one_time', name: 'One-time purchase', services: PACKAGES.one_time.services, free_months: 2,
    support_until: addDays(day, 90), support_days_left: 90,
  });
  const amore = (await run(owner, 'load')).projects.find((p) => p.name === 'Amore site');
  await run(owner, 'projects.update', { id: amore.id, patch: { support_until: addDays(day, -3) } });
  const ended = (await widget('package', amore.connect_key)).json.data;
  assert.ok(ended.support_days_left === -3 && ended.services.some((s) => /charged separately/.test(s)), 'ended 3 days ago: services are paid now');
});
test('the package request: a yearly subscription, with its services and renewal link', async () => {
  const pos = (await run(owner, 'load')).projects.find((p) => p.name === 'Cargo POS');
  const { data } = (await widget('package', pos.connect_key)).json;
  assert.ok(data.type === 'yearly' && data.name === 'Yearly subscription', JSON.stringify(data));
  assert.deepEqual(data.services, PACKAGES.yearly.services);
  assert.ok(data.services.some((s) => /Small updates/.test(s)), 'small updates are included');
  assert.ok(data.subscription.package === 'POS Business' && data.subscription.price === 25000 && data.subscription.status === 'active', JSON.stringify(data));
  assert.match(data.subscription.renew_url, /\/renew\?t=[0-9a-f]{48}$/);
  assert.equal((await widget('package', 'ab'.repeat(20))).status, 403, 'a wrong key');
});
