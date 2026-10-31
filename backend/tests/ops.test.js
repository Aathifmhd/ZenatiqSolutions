// Every access rule and side effect in core/ops.js, on sample data in memory. With TEST_MONGODB_URI
// set, the same checks also run on MongoDB, in a database called zenatiq_test that they empty first.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPortal, createConnect, SYSTEM } from '../core/ops.js';
import { MemoryStore } from '../core/memory.js';

// Emails with temporary passwords are kept here instead of being sent.
const outbox = [];
const mailer = async (email) => { outbox.push(email); return { sent: true }; };

describe('rules, in memory', () => rules(() => new MemoryStore({})));

describe('rules, on MongoDB', { skip: !process.env.TEST_MONGODB_URI && 'set TEST_MONGODB_URI to run these' }, () => {
  let db;
  rules(async () => {
    Object.assign(process.env, { MONGODB_URI: process.env.TEST_MONGODB_URI, MONGODB_DB: 'zenatiq_test' });
    const { database, storeFor } = await import('../db.js');
    // db.js connects and creates the indexes, as on a first deployment. Start empty.
    db = await database();
    for (const c of await db.collections()) if (c.collectionName !== 'meta') await c.deleteMany({});
    return storeFor(db);
  });
  after(() => db?.client.close());
});

function rules(makeStore) {
  let store, portal, connect;
  before(async () => {
    store = await makeStore();
    portal = createPortal(store, { mailer });
    connect = createConnect(store);
  });
  const col = (n) => store.col(n);
  const lastActivity = (n = 1) => col('activity').find({}, { sort: { id: -1 }, limit: n });
  const lastSummary = async () => (await lastActivity())[0].summary;

  // --- Team ----------------------------------------------------------------------------
  let owner, admin, member, other;
  test('the first owner is added by SYSTEM (npm run member)', async () => {
    owner = await portal.run(SYSTEM, 'team.add', { row: { email: 'Owner@Test.LK', full_name: 'Owner Person', role: 'owner', job_title: 'Founder' } });
    assert.ok(owner.role === 'owner' && owner.email === 'owner@test.lk' && owner.job_title === 'Founder', 'owner not created with lowercase email');
    assert.equal((await lastActivity())[0].actor_label, 'System');
  });
  test('owner adds an admin and a member, who each get a temporary password by email', async () => {
    admin = await portal.run(owner, 'team.add', { row: { email: 'Admin@Test.lk', full_name: 'Ada Admin', role: 'admin' } });
    member = await portal.run(owner, 'team.add', { row: { email: 'member@test.lk', full_name: 'Mo Member' } });
    assert.ok(admin.email === 'admin@test.lk' && member.role === 'member', 'bad defaults');
    assert.equal(await lastSummary(), 'Added Mo Member to the team as member');
    assert.deepEqual(member.invite, { emailed: true });
    assert.equal(outbox.at(-1).to, 'member@test.lk');
    const saved = await col('credentials').findOne({ member_id: member.id });
    assert.ok(saved.temporary && saved.password_hash.startsWith('scrypt$'), 'temporary password saved as a hash');
  });
  test('duplicate email is refused (any case)', () =>
    assert.rejects(portal.run(owner, 'team.add', { row: { email: 'MEMBER@test.lk', full_name: 'Dup' } }), { code: 'duplicate' }));
  test('member cannot add people', () =>
    assert.rejects(portal.run(member, 'team.add', { row: { email: 'x@y.lk', full_name: 'X' } }), { code: 'forbidden' }));
  test('admin cannot add an owner', () =>
    assert.rejects(portal.run(admin, 'team.add', { row: { email: 'o2@y.lk', full_name: 'O2', role: 'owner' } }), { message: /Only an owner/ }));
  test('member edits own name and phone', async () => {
    member = await portal.run(member, 'team.update', { id: member.id, patch: { full_name: 'Mo Member', phone: '+94 77 000 0000', job_title: 'Dev' } });
    assert.equal(member.phone, '+94 77 000 0000');
  });
  test('member cannot change own role', () =>
    assert.rejects(portal.run(member, 'team.update', { id: member.id, patch: { role: 'admin' } }), { message: /Only owners and admins/ }));
  test('member cannot change own email', () =>
    assert.rejects(portal.run(member, 'team.update', { id: member.id, patch: { email: 'new@test.lk' } }), { message: /Only owners and admins/ }));
  test('member cannot edit someone else', () =>
    assert.rejects(portal.run(member, 'team.update', { id: admin.id, patch: { full_name: 'Hacked' } }), { code: 'forbidden' }));
  test('admin cannot edit an owner', () =>
    assert.rejects(portal.run(admin, 'team.update', { id: owner.id, patch: { phone: '1' } }), { message: /Only an owner/ }));
  test('admin cannot remove an owner', () =>
    assert.rejects(portal.run(admin, 'team.remove', { id: owner.id }), { message: /Only an owner/ }));
  test('the last owner cannot step down', () =>
    assert.rejects(portal.run(owner, 'team.update', { id: owner.id, patch: { role: 'admin' } }), { code: 'last_owner' }));
  test('the last owner cannot lose access', () =>
    assert.rejects(portal.run(owner, 'team.update', { id: owner.id, patch: { active: false } }), { code: 'last_owner' }));
  test('owner changes a role (logged)', async () => {
    await portal.run(owner, 'team.update', { id: member.id, patch: { role: 'admin' } });
    assert.equal(await lastSummary(), "Changed Mo Member's role to admin");
    member = await portal.run(owner, 'team.update', { id: member.id, patch: { role: 'member' } });
  });
  test('removing access locks someone out', async () => {
    other = await portal.run(owner, 'team.add', { row: { email: 'other@test.lk', full_name: 'Olu Other' } });
    const off = await portal.run(admin, 'team.update', { id: other.id, patch: { active: false } });
    await assert.rejects(portal.run(off, 'load'), { code: 'signed_out' });
    assert.equal(await lastSummary(), 'Removed portal access for Olu Other');
  });

  // --- Clients and projects ---------------------------------------------------------------
  let client, project, project2;
  test('member adds and edits a client', async () => {
    client = await portal.run(member, 'clients.add', { row: { name: 'Veloura', email: 'hi@veloura.lk' } });
    const edited = await portal.run(member, 'clients.update', { id: client.id, patch: { phone: '011 222 3333' } });
    assert.ok(edited.phone === '011 222 3333' && edited.name === 'Veloura', 'client edit');
  });
  test('client email is checked', () =>
    assert.rejects(portal.run(member, 'clients.add', { row: { name: 'X', email: 'not-an-email' } }), { message: /email address/ }));
  test('member adds a project with a secret key', async () => {
    project = await portal.run(member, 'projects.add', { row: { name: 'Veloura store', client_id: client.id, type: 'online_shop', live_url: 'https://veloura.lk' } });
    assert.ok(/^[0-9a-f]{64}$/.test(project.connect_key) && project.status === 'planning' && project.connect_enabled, 'project defaults');
    project2 = await portal.run(owner, 'projects.add', { row: { name: 'Gloss site' } });
  });
  test('web addresses must be http(s)', () =>
    assert.rejects(portal.run(member, 'projects.add', { row: { name: 'Bad', live_url: 'javascript:alert(1)' } }), { message: /must start with http/ }));
  test('a missing project name is refused', () =>
    assert.rejects(portal.run(member, 'projects.add', { row: { name: '   ' } }), { message: /required/ }));
  test('status change is logged with both stages', async () => {
    await portal.run(member, 'projects.update', { id: project.id, patch: { status: 'in_progress' } });
    assert.equal(await lastSummary(), 'Veloura store: Planning → In progress');
  });
  test('detail edits and the widget switch are logged', async () => {
    await portal.run(member, 'projects.update', { id: project.id, patch: { description: 'Boutique' } });
    assert.equal((await lastActivity())[0].action, 'project.updated');
    await portal.run(member, 'projects.update', { id: project2.id, patch: { connect_enabled: false } });
    assert.equal(await lastSummary(), 'Turned off Contact with Zenatiq for Gloss site');
  });
  test('a new key replaces the old one', async () => {
    const before = project.connect_key;
    project = await portal.run(member, 'projects.newKey', { id: project.id });
    assert.ok(project.connect_key !== before && /^[0-9a-f]{64}$/.test(project.connect_key), 'key not replaced');
    await assert.rejects(connect.run('info', { key: before }), { code: 'bad_key' });
  });
  test('members and assignments', async () => {
    await portal.run(member, 'projects.assign', { projectId: project.id, memberId: member.id });
    await assert.rejects(portal.run(member, 'projects.assign', { projectId: project.id, memberId: member.id }), { code: 'duplicate' });
    assert.equal((await portal.run(member, 'projects.members', { projectId: project.id })).length, 1);
    await portal.run(member, 'projects.unassign', { projectId: project.id, memberId: member.id });
    assert.equal(await lastSummary(), 'Took Mo Member off Veloura store');
    await portal.run(member, 'projects.assign', { projectId: project.id, memberId: member.id });
  });
  test('member cannot delete clients or projects', async () => {
    await assert.rejects(portal.run(member, 'clients.remove', { id: client.id }), { code: 'forbidden' });
    await assert.rejects(portal.run(member, 'projects.remove', { id: project.id }), { code: 'forbidden' });
  });

  // --- Money -------------------------------------------------------------------------------
  test('members cannot see or change money', async () => {
    for (const [op, args] of [['money.finances', { projectId: project.id }], ['money.allFinances', {}], ['money.payments', {}],
      ['money.setQuote', { projectId: project.id, quotedAmount: 1 }], ['money.addPayment', { row: { project_id: project.id, amount: 1 } }]]) {
      await assert.rejects(portal.run(member, op, args), { code: 'forbidden' }, op);
    }
  });
  test('admin sets a quote and records payments', async () => {
    const q = await portal.run(admin, 'money.setQuote', { projectId: project.id, quotedAmount: '85,000', currency: 'lkr', notes: '50% upfront' });
    assert.ok(q.quoted_amount === 85000 && q.currency === 'LKR', 'quote parse');
    await portal.run(admin, 'money.setQuote', { projectId: project.id, quotedAmount: 90000, currency: 'LKR' });
    assert.equal((await portal.run(admin, 'money.allFinances', {})).length, 1, 'quote upsert made a second row');
    const p = await portal.run(admin, 'money.addPayment', { row: { project_id: project.id, amount: '25,000', paid_on: '2026-10-01', method: 'cash' } });
    assert.ok(p.amount === 25000 && p.recorded_by === admin.id, 'payment parse');
    await portal.run(admin, 'money.addPayment', { row: { project_id: project.id, amount: 5000, paid_on: '2026-10-20' } });
    const list = await portal.run(admin, 'money.payments', { projectId: project.id });
    assert.ok(list[0].paid_on === '2026-10-20' && list.length === 2, 'payments order');
    assert.equal(await lastSummary(), 'Recorded a payment of LKR 5,000.00 for Veloura store');
  });
  test('payment amounts must be above zero', async () => {
    for (const amount of [0, -5, 'abc']) {
      await assert.rejects(portal.run(admin, 'money.addPayment', { row: { project_id: project.id, amount } }), { message: /more than zero/ });
    }
  });
  test('members never see money in the activity log', async () => {
    const seen = await portal.run(member, 'activity.list', { limit: 100 });
    assert.ok(!seen.some((a) => a.admin_only), 'member saw an admin-only entry');
    const all = await portal.run(admin, 'activity.list', { limit: 100 });
    assert.ok(all.some((a) => a.admin_only && a.action === 'finance.quote'), 'admin should see money entries');
  });
  test('activity pages with "before"', async () => {
    const first = await portal.run(admin, 'activity.list', { limit: 3 });
    const next = await portal.run(admin, 'activity.list', { limit: 3, before: first.at(-1).id });
    assert.ok(first.length === 3 && next.length === 3 && next[0].id < first[2].id, 'paging order');
    assert.ok(first[0].id > first[1].id && first[1].id > first[2].id, 'newest first');
  });

  // --- Tasks and conversations -----------------------------------------------------------------
  let thread;
  test('team starts a conversation and replies', async () => {
    thread = await portal.run(member, 'threads.add', { row: { project_id: project.id, subject: 'Launch plan', category: 'update', unread_by_team: false } });
    const msg = await portal.run(member, 'threads.reply', { threadId: thread.id, body: '  We launch Friday.  ' });
    assert.ok(msg.sender === 'team' && msg.author_name === 'Mo Member' && msg.body === 'We launch Friday.', 'team message');
    const t = await portal.run(member, 'threads.get', { id: thread.id });
    assert.ok(t.unread_by_client === true && t.unread_by_team === false, 'unread flags after team reply');
  });
  test('tasks: add, move, assign, delete (all logged)', async () => {
    const task = await portal.run(member, 'tasks.add', { row: { project_id: project.id, title: 'Fix photos', priority: 'urgent', thread_id: thread.id } });
    assert.ok(task.status === 'todo' && task.created_by === member.id && task.thread_id === thread.id, 'task defaults');
    await portal.run(member, 'tasks.update', { id: task.id, patch: { status: 'done', position: 3.5 } });
    assert.equal(await lastSummary(), 'Moved "Fix photos" to Done');
    await portal.run(member, 'tasks.update', { id: task.id, patch: { assignee_id: admin.id } });
    assert.equal(await lastSummary(), 'Assigned "Fix photos" to Ada Admin');
    assert.equal((await portal.run(member, 'tasks.list', { assigneeId: admin.id })).length, 1, 'list by assignee');
    const extra = await portal.run(member, 'tasks.add', { row: { project_id: project.id, title: 'Temp' } });
    await portal.run(member, 'tasks.remove', { id: extra.id });
    assert.equal(await lastSummary(), 'Deleted task "Temp"');
  });
  test('ids must be plain strings (no database operators)', async () => {
    await assert.rejects(portal.run(member, 'tasks.list', { projectId: { $ne: null } }), { code: 'not_found' });
    await assert.rejects(portal.run(member, 'threads.get', { id: { $gt: '' } }), { code: 'not_found' });
    await assert.rejects(portal.run(member, 'tasks.update', { id: { $ne: 'x' }, patch: { title: 'x' } }), { code: 'not_found' });
  });
  test('unknown operations are refused', () =>
    assert.rejects(portal.run(owner, 'team.dropEverything', {}), { code: 'unknown_op' }));
  test('too-long text is refused', () =>
    assert.rejects(portal.run(member, 'tasks.add', { row: { project_id: project.id, title: 'x'.repeat(301) } }), { message: /too long/ }));

  // --- Contact with Zenatiq (the widget) ---------------------------------------------------------
  let clientThread;
  test('bad keys get nothing (including database operators)', async () => {
    for (const key of [{ $ne: null }, 'short', 'f'.repeat(64), ['a'], null]) {
      await assert.rejects(connect.run('info', { key }), { code: 'bad_key' });
    }
  });
  test('a switched-off widget gets nothing', () =>
    assert.rejects(connect.run('threads', { key: project2.connect_key }), { code: 'bad_key' }));
  test('client starts a conversation', async () => {
    const info = await connect.run('info', { key: project.connect_key });
    assert.ok(info.project_name === 'Veloura store' && info.client_name === 'Veloura', 'info');
    const id = await connect.run('start', { key: project.connect_key, subject: 'Photos are slow', body: '<b>help</b>', category: 'bug', name: 'Owner', contact: '077' });
    clientThread = await portal.run(member, 'threads.get', { id });
    assert.ok(clientThread.unread_by_team && clientThread.category === 'bug' && clientThread.client_name === 'Owner', 'client thread');
    const msgs = await portal.run(member, 'threads.messages', { threadId: id });
    assert.ok(msgs.length === 1 && msgs[0].sender === 'client' && msgs[0].body === '<b>help</b>' && msgs[0].member_id === null, 'client message');
    const log = (await lastActivity())[0];
    assert.ok(log.summary === 'New bug report from Veloura store: "Photos are slow"' && log.actor_label === 'Client · Owner' && log.actor_member_id === null, 'client log');
  });
  test('a client never sees other projects', async () => {
    const p3 = await portal.run(owner, 'projects.add', { row: { name: 'Third' } });
    const otherThread = await connect.run('start', { key: p3.connect_key, subject: 'Private', body: 'secret' });
    await assert.rejects(connect.run('messages', { key: project.connect_key, thread: otherThread }), { code: 'not_found' });
    await assert.rejects(connect.run('reply', { key: project.connect_key, thread: otherThread, body: 'x' }), { code: 'not_found' });
    const list = await connect.run('threads', { key: project.connect_key });
    assert.ok(!list.some((t) => t.id === otherThread) && list.every((t) => !('unread_by_team' in t) && !('assignee_id' in t)), 'thread list leaks');
  });
  test('reading a reply clears the client badge', async () => {
    await portal.run(member, 'threads.reply', { threadId: clientThread.id, body: 'On it!' });
    let list = await connect.run('threads', { key: project.connect_key });
    assert.equal(list.find((t) => t.id === clientThread.id).unread, true, 'client should see unread');
    const msgs = await connect.run('messages', { key: project.connect_key, thread: clientThread.id });
    assert.ok(msgs.at(-1).author_name === 'Mo Member' && !('member_id' in msgs.at(-1)), 'team message for client');
    list = await connect.run('threads', { key: project.connect_key });
    assert.equal(list.find((t) => t.id === clientThread.id).unread, false, 'unread not cleared');
  });
  test('a client reply reopens a resolved conversation', async () => {
    await portal.run(member, 'threads.update', { id: clientThread.id, patch: { status: 'resolved', assignee_id: admin.id } });
    await connect.run('reply', { key: project.connect_key, thread: clientThread.id, body: 'Still slow', name: 'Owner' });
    const t = await portal.run(member, 'threads.get', { id: clientThread.id });
    assert.ok(t.status === 'open' && t.unread_by_team, 'not reopened');
    const [reply, reopened] = await lastActivity(2);
    assert.ok(reopened.action === 'thread.reopened' && reopened.actor_label === 'System' && reply.action === 'message.client', 'reopen log order');
  });
  test('empty client messages are refused', async () => {
    await assert.rejects(connect.run('start', { key: project.connect_key, subject: ' ', body: 'x' }), { message: /subject/ });
    await assert.rejects(connect.run('reply', { key: project.connect_key, thread: clientThread.id, body: '   ' }), { message: /write your message/ });
  });
  test('30 client messages an hour per project, then a pause', async () => {
    const p = await portal.run(owner, 'projects.add', { row: { name: 'Rate test' } });
    const t = await connect.run('start', { key: p.connect_key, subject: 'Hi', body: '1' });
    for (let i = 2; i <= 30; i++) await connect.run('reply', { key: p.connect_key, thread: t, body: String(i) });
    await assert.rejects(connect.run('reply', { key: p.connect_key, thread: t, body: '31' }), { code: 'rate_limited' });
    await assert.rejects(connect.run('start', { key: p.connect_key, subject: 'Again', body: 'x' }), { code: 'rate_limited' });
    // Other projects are not affected.
    await connect.run('reply', { key: project.connect_key, thread: clientThread.id, body: 'fine' });
  });
  test('unread count and live changes', async () => {
    assert.ok((await portal.run(member, 'threads.unreadCount', {})) >= 1, 'unread count');
    const { now, changes } = await portal.run(member, 'poll', {});
    assert.ok(typeof now === 'string' && changes.some((c) => c.table === 'messages' && c.row.sender === 'client'), 'poll shows client messages');
    assert.ok(changes.every((c) => !('expire_at' in c) && !('_id' in c)), 'internal fields leaked');
  });

  // --- Deleting ---------------------------------------------------------------------------
  test('deleting a project removes everything under it', async () => {
    await portal.run(owner, 'projects.remove', { id: project.id });
    for (const name of ['threads', 'messages', 'tasks', 'payments', 'project_finances', 'project_members']) {
      assert.equal(await col(name).countDocuments({ project_id: project.id }), 0, `${name} left behind`);
    }
    assert.equal(await col('activity').countDocuments({ project_id: project.id }), 0, 'activity still linked');
    assert.equal(await col('activity').countDocuments({ summary: 'Veloura store: Planning → In progress' }), 1, 'history was deleted');
    assert.equal(await lastSummary(), 'Deleted project Veloura store');
    await assert.rejects(connect.run('info', { key: project.connect_key }), { code: 'bad_key' });
  });
  test('deleting a client keeps their projects', async () => {
    const c = await portal.run(owner, 'clients.add', { row: { name: 'Temp client' } });
    const p = await portal.run(owner, 'projects.add', { row: { name: 'Kept', client_id: c.id } });
    await portal.run(admin, 'clients.remove', { id: c.id });
    assert.equal((await portal.run(member, 'projects.get', { id: p.id })).client_id, null);
  });
  test('deleting a member unassigns their work', async () => {
    const t = await portal.run(owner, 'tasks.add', { row: { project_id: project2.id, title: 'Owned', assignee_id: other.id } });
    await portal.run(owner, 'projects.assign', { projectId: project2.id, memberId: other.id });
    await portal.run(owner, 'team.remove', { id: other.id });
    const after = await portal.run(owner, 'tasks.list', { projectId: project2.id });
    assert.equal(after.find((x) => x.id === t.id).assignee_id, null, 'task still assigned');
    assert.ok(!(await portal.run(owner, 'projects.allMembers', {})).some((m) => m.member_id === other.id), 'assignment left');
  });
  test('a second owner lets the first one step down', async () => {
    await portal.run(owner, 'team.update', { id: admin.id, patch: { role: 'owner' } });
    const stepped = await portal.run(owner, 'team.update', { id: owner.id, patch: { role: 'admin' } });
    assert.equal(stepped.role, 'admin');
  });
}
