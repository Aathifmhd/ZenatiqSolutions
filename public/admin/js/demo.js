// Demo mode for local previews: an in-browser stand-in for the Supabase client, with sample data.
// It is only used on localhost (see app.js) and nothing leaves the browser.
// It copies the behaviour of the database triggers closely enough to try every page.

const KEY = 'zenatiq-demo-db';
const VERSION = 1;
const ME = 'demo@zenatiqsolutions.com';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString();
const dateIn = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const hexKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const clone = (v) => JSON.parse(JSON.stringify(v));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* demo still works for this visit */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const LABEL = {
  todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done', lead: 'Lead', planning: 'Planning',
  live: 'Live', maintenance: 'Maintenance', on_hold: 'On hold', completed: 'Completed', open: 'Open', resolved: 'Resolved',
  bug: 'bug report', update: 'update request', question: 'question', other: 'message',
};
const money = (n, c = 'LKR') => `${c} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function seed() {
  const team = [
    { id: uuid(), email: ME, full_name: 'Mohamed Aathif', role: 'owner', job_title: 'Founder', phone: '+94 75 811 2170', active: true, created_at: ago(60) },
    { id: uuid(), email: 'developer@example.com', full_name: 'Sample Developer', role: 'admin', job_title: 'Developer', phone: null, active: true, created_at: ago(40) },
    { id: uuid(), email: 'designer@example.com', full_name: 'Sample Designer', role: 'member', job_title: 'UI/UX Designer', phone: null, active: true, created_at: ago(30) },
  ];
  const [aathif, dev, designer] = team;
  const client = (name) => ({ id: uuid(), name, contact_name: null, phone: null, email: null, address: null, notes: null, created_at: ago(50) });
  const clients = ['Regal Hardware', 'Cargo POS client', 'Gloss Workx', 'YYR International Trading', 'Veloura', 'Amore Ice Cream'].map(client);
  const project = (name, c, type, status, live, extra = {}) => ({
    id: uuid(), name, client_id: c ? c.id : null, type, status, live_url: live, admin_url: null, repo_url: null, description: null,
    start_date: null, due_date: null, connect_key: hexKey(), connect_enabled: true, created_at: ago(45), updated_at: ago(1), ...extra,
  });
  const [regal, cargo, gloss, yyr, veloura, amore] = clients;
  const projects = [
    project('Veloura online store', veloura, 'online_shop', 'in_progress', 'https://veloura-online-store.web.app', { start_date: dateIn(-24), due_date: dateIn(9), description: 'Boutique store with owner-editable products and WhatsApp ordering.' }),
    project('Regal Hardware ERP & POS', regal, 'pos', 'maintenance', 'https://www.regalhw.lk', { admin_url: 'https://www.regalhw.lk/demo', description: 'Odoo-based POS on five tills, a custom ERP and the online store.' }),
    project('Cargo POS', cargo, 'pos', 'live', 'https://cargo-pos-system.vercel.app'),
    project('Gloss Workx website', gloss, 'website', 'live', 'https://glossworkx-landing-page.web.app'),
    project('YYR International website', yyr, 'website', 'maintenance', 'https://yyr-international-trading.web.app'),
    project('Amore concept site', amore, 'website', 'lead', 'https://amore-icecream.web.app', { due_date: dateIn(-1) }),
    project('Zenatiq admin portal', null, 'other', 'review', 'https://www.zenatiqsolutions.com/admin', { start_date: dateIn(-7), due_date: dateIn(3) }),
  ];
  const [pVeloura, pRegal, pCargo, pGloss, pYyr, pAmore, pPortal] = projects;
  const project_members = [
    ...projects.map((p) => ({ project_id: p.id, member_id: aathif.id })),
    { project_id: pVeloura.id, member_id: designer.id }, { project_id: pAmore.id, member_id: designer.id },
    { project_id: pRegal.id, member_id: dev.id }, { project_id: pCargo.id, member_id: dev.id }, { project_id: pYyr.id, member_id: dev.id },
  ];

  const thread = (p, subject, category, status, clientName, extra = {}) => ({
    id: uuid(), project_id: p.id, subject, category, status, client_name: clientName, client_contact: null, assignee_id: null,
    unread_by_team: false, unread_by_client: false, last_message_at: ago(0), created_at: ago(0), ...extra,
  });
  const tPhotos = thread(pVeloura, 'Product photos load slowly on mobile', 'bug', 'open', 'Veloura owner', { unread_by_team: true, last_message_at: ago(0, 2), created_at: ago(0, 2) });
  const tPrice = thread(pGloss, 'Please change the Premium Detail price', 'update', 'open', 'Gloss Workx', { unread_by_team: true, last_message_at: ago(0, 0.5), created_at: ago(0, 0.5) });
  const tListings = thread(pYyr, 'Add a page for new property listings', 'update', 'in_progress', 'YYR office', { assignee_id: dev.id, last_message_at: ago(1), created_at: ago(2) });
  const tCashier = thread(pRegal, 'Can we add a login for a new cashier?', 'question', 'resolved', 'Regal manager', { last_message_at: ago(4), created_at: ago(5) });
  const threads = [tPhotos, tPrice, tListings, tCashier];
  const msg = (t, sender, body, when, member = null) => ({
    id: uuid(), thread_id: t.id, sender, member_id: member?.id || null,
    author_name: sender === 'team' ? member.full_name : t.client_name, body, created_at: when,
  });
  const messages = [
    msg(tPhotos, 'client', 'Hi, customers say the product photos take a long time to appear on their phones, especially on mobile data. Can you check?', ago(0, 2)),
    msg(tPrice, 'client', 'Hello! We are changing the Premium Detail package to LKR 19,500 from next month. Can you update the website?', ago(0, 0.5)),
    msg(tListings, 'client', 'We have 12 new properties coming. Can we get a separate page for new listings with photos?', ago(2)),
    msg(tListings, 'team', 'Yes, we can do that. We will send you a preview of the new page by Thursday.', ago(1), dev),
    msg(tCashier, 'client', 'We hired a new cashier. How do we give them their own login for Till 4?', ago(5)),
    msg(tCashier, 'team', "I've created the login and sent the details to your WhatsApp. They can start today.", ago(5, -3), aathif),
    msg(tCashier, 'client', 'Thanks, it works!', ago(4)),
  ];

  let pos = 1;
  const task = (p, title, status, priority, assignee, due, extra = {}) => ({
    id: uuid(), project_id: p.id, title, description: null, status, priority, assignee_id: assignee?.id || null,
    due_date: due == null ? null : dateIn(due), position: pos++, thread_id: null, created_by: aathif.id, created_at: ago(3), updated_at: ago(1), ...extra,
  });
  const tasks = [
    task(pVeloura, 'Speed up product photos on mobile', 'todo', 'urgent', dev, 1, { thread_id: tPhotos.id, description: 'Compress images and serve WebP. Reported by the client.' }),
    task(pVeloura, 'Add a size filter to the products page', 'in_progress', 'high', designer, 3),
    task(pVeloura, 'Cash on delivery option', 'review', 'medium', aathif, 5),
    task(pVeloura, 'Launch checklist', 'done', 'medium', aathif, null),
    task(pRegal, 'Monthly backup check', 'todo', 'medium', dev, 7),
    task(pRegal, 'Create login for the new cashier', 'done', 'high', aathif, null, { thread_id: tCashier.id }),
    task(pYyr, 'Build the new listings page', 'in_progress', 'medium', dev, 4, { thread_id: tListings.id }),
    task(pGloss, 'Update the Premium Detail price', 'todo', 'high', aathif, 2, { thread_id: tPrice.id }),
    task(pAmore, 'Send the concept preview to the owner', 'todo', 'high', aathif, -1),
    task(pPortal, 'Connect the portal to Supabase', 'in_progress', 'high', aathif, 2),
    task(pPortal, 'Add the team members', 'todo', 'medium', aathif, 3),
  ];

  const finance = (p, quoted) => ({ project_id: p.id, quoted_amount: quoted, currency: 'LKR', notes: null, updated_at: ago(20) });
  const project_finances = [finance(pVeloura, 85000), finance(pRegal, 250000), finance(pCargo, 120000), finance(pGloss, 35000), finance(pYyr, 60000)];
  const payment = (p, amount, days, method, reference = null) => ({
    id: uuid(), project_id: p.id, amount, paid_on: dateIn(-days), method, reference, note: null, recorded_by: aathif.id, created_at: ago(days),
  });
  const payments = [
    payment(pVeloura, 40000, 20, 'bank_transfer', 'Advance'), payment(pRegal, 150000, 70, 'cheque'), payment(pRegal, 50000, 12, 'bank_transfer'),
    payment(pCargo, 70000, 30, 'bank_transfer'), payment(pGloss, 20000, 25, 'cash'), payment(pYyr, 60000, 40, 'bank_transfer'),
  ];

  let n = 1;
  const act = (p, member, label, action, summary, when, adminOnly = false) => ({
    id: n++, project_id: p?.id || null, actor_member_id: member?.id || null, actor_label: label || member.full_name,
    action, summary, admin_only: adminOnly, created_at: when,
  });
  const activity = [
    act(null, aathif, null, 'team.added', 'Added Sample Developer to the team as admin', ago(40)),
    act(pRegal, aathif, null, 'payment.added', `Recorded a payment of ${money(50000)} for Regal Hardware ERP & POS`, ago(12), true),
    act(pRegal, null, 'Client · Regal manager', 'message.new', 'New question from Regal Hardware ERP & POS: "Can we add a login for a new cashier?"', ago(5)),
    act(pRegal, aathif, null, 'thread.status', 'Marked "Can we add a login for a new cashier?" as Resolved', ago(4)),
    act(pYyr, dev, null, 'message.reply', 'Replied to "Add a page for new property listings" (YYR International website)', ago(1)),
    act(pVeloura, designer, null, 'task.moved', 'Moved "Add a size filter to the products page" to In progress', ago(0, 5)),
    act(pVeloura, null, 'Client · Veloura owner', 'message.new', 'New bug report from Veloura online store: "Product photos load slowly on mobile"', ago(0, 2)),
    act(pGloss, null, 'Client · Gloss Workx', 'message.new', 'New update request from Gloss Workx website: "Please change the Premium Detail price"', ago(0, 0.5)),
  ];

  return { version: VERSION, team_members: team, clients, projects, project_members, threads, messages, tasks, project_finances, payments, activity, nextActivity: n };
}

class Query {
  constructor(db, table) {
    Object.assign(this, { db, table, op: 'select', filters: [], orders: [], max: null, one: null, returning: false, payload: null, conflict: null });
  }
  select() { if (this.op !== 'select') this.returning = true; return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  upsert(row, { onConflict } = {}) { this.op = 'upsert'; this.payload = row; this.conflict = onConflict; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  in(c, list) { this.filters.push((r) => list.includes(r[c])); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
  limit(n) { this.max = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(resolve, reject) {
    return new Promise((r) => setTimeout(r, 60)).then(() => {
      try { return { data: this.db.run(this), error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
    }).then(resolve, reject);
  }
}

const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

class DemoDb {
  constructor() {
    let data = null;
    try { data = JSON.parse(store.get(KEY)); } catch { data = null; }
    this.data = data?.version === VERSION ? data : seed();
    this.listeners = [];
    this.asClient = false;
    this.save();
  }
  save() { store.set(KEY, JSON.stringify(this.data)); }
  me() { return this.data.team_members.find((m) => m.email === ME); }
  rows(table) {
    if (!this.data[table]) throw new Error(`Unknown table: ${table}`);
    return this.data[table];
  }

  run(q) {
    const rows = this.rows(q.table);
    const match = (r) => q.filters.every((f) => f(r));
    let result;
    if (q.op === 'select') {
      result = rows.filter(match);
      for (const [c, asc] of [...q.orders].reverse()) result = [...result].sort((a, b) => cmp(a[c], b[c]) * (asc ? 1 : -1));
      if (q.max != null) result = result.slice(0, q.max);
    } else if (q.op === 'insert') {
      result = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => this.insert(q.table, r));
    } else if (q.op === 'update') {
      result = rows.filter(match).map((r) => this.update(q.table, r, q.payload));
    } else if (q.op === 'upsert') {
      const key = q.conflict || 'id';
      const existing = rows.find((r) => r[key] === q.payload[key]);
      result = [existing ? this.update(q.table, existing, q.payload) : this.insert(q.table, q.payload)];
    } else {
      result = rows.filter(match);
      result.forEach((r) => this.remove(q.table, r));
    }
    this.save();
    result = clone(result);
    if (q.one) {
      if (result.length > 1) throw new Error('More than one row was returned');
      if (!result.length && q.one === 'single') throw new Error('No rows were returned');
      return result[0] ?? null;
    }
    return q.op === 'select' || q.returning ? result : null;
  }

  defaults(table) {
    const t = now();
    return {
      team_members: { id: uuid(), role: 'member', active: true, job_title: null, phone: null, created_at: t },
      clients: { id: uuid(), contact_name: null, phone: null, email: null, address: null, notes: null, created_at: t },
      projects: { id: uuid(), type: 'website', status: 'planning', connect_key: hexKey(), connect_enabled: true, created_at: t, updated_at: t },
      project_members: {},
      threads: { id: uuid(), category: 'question', status: 'open', unread_by_team: true, unread_by_client: false, assignee_id: null, last_message_at: t, created_at: t },
      messages: { id: uuid(), created_at: t },
      tasks: { id: uuid(), status: 'todo', priority: 'medium', position: Date.now() / 1000, thread_id: null, created_at: t, updated_at: t },
      project_finances: { quoted_amount: 0, currency: 'LKR', notes: null, updated_at: t },
      payments: { id: uuid(), paid_on: t.slice(0, 10), method: 'bank_transfer', created_at: t },
      activity: { id: this.data.nextActivity++, admin_only: false, created_at: t },
    }[table];
  }

  insert(table, input) {
    const row = { ...this.defaults(table), ...input };
    if (table === 'team_members') {
      row.email = row.email.trim().toLowerCase();
      if (this.rows(table).some((m) => m.email === row.email)) throw new Error('duplicate key value violates unique constraint "team_members_email_idx"');
    }
    if (table === 'project_members' && this.rows(table).some((r) => r.project_id === row.project_id && r.member_id === row.member_id)) {
      throw new Error('This person is already on the project.');
    }
    if (table === 'messages') {
      if (this.asClient) Object.assign(row, { sender: 'client', member_id: null });
      else { const me = this.me(); Object.assign(row, { sender: 'team', member_id: me.id, author_name: me.full_name }); }
    }
    this.rows(table).push(row);
    this.after(table, 'INSERT', row, null);
    return row;
  }

  update(table, row, patch) {
    const old = { ...row };
    Object.assign(row, patch);
    if ('updated_at' in row && table !== 'threads') row.updated_at = now();
    if (table === 'team_members' && row.email) row.email = row.email.trim().toLowerCase();
    this.after(table, 'UPDATE', row, old);
    return row;
  }

  remove(table, row) {
    const list = this.rows(table);
    const i = list.indexOf(row);
    if (i >= 0) list.splice(i, 1);
    const drop = (t, test) => { this.data[t] = this.data[t].filter((r) => !test(r)); };
    if (table === 'projects') {
      const threadIds = this.data.threads.filter((t) => t.project_id === row.id).map((t) => t.id);
      drop('messages', (m) => threadIds.includes(m.thread_id));
      ['threads', 'tasks', 'payments', 'project_finances', 'project_members'].forEach((t) => drop(t, (r) => r.project_id === row.id));
      this.data.activity.forEach((a) => { if (a.project_id === row.id) a.project_id = null; });
    }
    if (table === 'threads') drop('messages', (m) => m.thread_id === row.id);
    if (table === 'team_members') {
      drop('project_members', (r) => r.member_id === row.id);
      this.data.tasks.forEach((t) => { if (t.assignee_id === row.id) t.assignee_id = null; });
    }
    if (table === 'clients') this.data.projects.forEach((p) => { if (p.client_id === row.id) p.client_id = null; });
    this.after(table, 'DELETE', null, row);
  }

  log(projectId, action, summary, adminOnly = false, label = null) {
    const me = this.me();
    const row = {
      ...this.defaults('activity'), project_id: projectId, actor_member_id: label ? null : me.id,
      actor_label: label || me.full_name, action, summary, admin_only: adminOnly,
    };
    this.data.activity.push(row);
    this.emit('activity', 'INSERT', row);
  }

  // Mirrors the triggers in supabase/schema.sql.
  after(table, op, row, old) {
    const projectName = (id) => this.data.projects.find((p) => p.id === id)?.name || 'a project';
    const memberName = (id) => this.data.team_members.find((m) => m.id === id)?.full_name;
    const r = row || old;
    if (table === 'team_members' && op === 'INSERT') this.log(null, 'team.added', `Added ${row.full_name} to the team as ${row.role}`);
    if (table === 'team_members' && op === 'UPDATE' && row.role !== old.role) this.log(null, 'team.role', `Changed ${row.full_name}'s role to ${row.role}`);
    if (table === 'team_members' && op === 'UPDATE' && row.active !== old.active) {
      this.log(null, 'team.access', row.active ? `Gave ${row.full_name} access again` : `Removed portal access for ${row.full_name}`);
    }
    if (table === 'clients' && op === 'INSERT') this.log(null, 'client.added', `Added client ${row.name}`);
    if (table === 'projects') {
      if (op === 'INSERT') this.log(row.id, 'project.created', `Created project ${row.name}`);
      if (op === 'UPDATE' && row.status !== old.status) this.log(row.id, 'project.status', `${row.name}: ${LABEL[old.status]} → ${LABEL[row.status]}`);
      else if (op === 'UPDATE' && row.connect_key !== old.connect_key) this.log(row.id, 'project.key', `Made a new Contact with Zenatiq key for ${row.name}`);
      else if (op === 'UPDATE' && row.connect_enabled !== old.connect_enabled) this.log(row.id, 'project.connect', `${row.connect_enabled ? 'Turned on' : 'Turned off'} Contact with Zenatiq for ${row.name}`);
      if (op === 'DELETE') this.log(null, 'project.deleted', `Deleted project ${old.name}`);
    }
    if (table === 'project_members' && op === 'INSERT') this.log(row.project_id, 'project.member_added', `Added ${memberName(row.member_id)} to ${projectName(row.project_id)}`);
    if (table === 'tasks') {
      if (op === 'INSERT') this.log(row.project_id, 'task.created', `Added task "${row.title}"`);
      if (op === 'UPDATE' && row.status !== old.status) this.log(row.project_id, 'task.moved', `Moved "${row.title}" to ${LABEL[row.status]}`);
      if (op === 'UPDATE' && row.assignee_id !== old.assignee_id) {
        this.log(row.project_id, 'task.assigned', row.assignee_id ? `Assigned "${row.title}" to ${memberName(row.assignee_id)}` : `Unassigned "${row.title}"`);
      }
      if (op === 'DELETE') this.log(old.project_id, 'task.deleted', `Deleted task "${old.title}"`);
    }
    if (table === 'payments' && op === 'INSERT') this.log(row.project_id, 'payment.added', `Recorded a payment of ${money(row.amount)} for ${projectName(row.project_id)}`, true);
    if (table === 'payments' && op === 'DELETE') this.log(old.project_id, 'payment.deleted', `Deleted a payment of ${money(old.amount)} for ${projectName(old.project_id)}`, true);
    if (table === 'project_finances' && (op === 'INSERT' || row.quoted_amount !== old.quoted_amount)) {
      this.log(row.project_id, 'finance.quote', `Set the quote for ${projectName(row.project_id)} to ${money(row.quoted_amount, row.currency)}`, true);
    }
    if (table === 'threads') {
      if (op === 'INSERT') {
        if (this.asClient) this.log(row.project_id, 'message.new', `New ${LABEL[row.category]} from ${projectName(row.project_id)}: "${row.subject}"`, false, `Client · ${row.client_name || projectName(row.project_id)}`);
        else this.log(row.project_id, 'thread.created', `Started a conversation "${row.subject}" for ${projectName(row.project_id)}`);
      }
      if (op === 'UPDATE' && row.status !== old.status && !this.asClient) this.log(row.project_id, 'thread.status', `Marked "${row.subject}" as ${LABEL[row.status]}`);
    }
    if (table === 'messages' && op === 'INSERT') {
      const thread = this.data.threads.find((t) => t.id === row.thread_id);
      if (row.sender === 'client') {
        Object.assign(thread, { last_message_at: row.created_at, unread_by_team: true, status: thread.status === 'resolved' ? 'open' : thread.status });
      } else {
        Object.assign(thread, { last_message_at: row.created_at, unread_by_client: true, unread_by_team: false });
        this.log(thread.project_id, 'message.reply', `Replied to "${thread.subject}" (${projectName(thread.project_id)})`);
      }
      this.emit('threads', 'UPDATE', thread);
    }
    if (['threads', 'messages', 'tasks'].includes(table)) this.emit(table, op, r);
  }

  emit(table, eventType, row) {
    for (const l of this.listeners) if (l.table === table) setTimeout(() => l.cb({ eventType, new: clone(row), old: {} }), 0);
  }
}

export function createDemoClient() {
  const db = new DemoDb();
  const signedIn = () => store.get(`${KEY}-session`) === '1';
  const authListeners = [];
  return {
    from: (table) => new Query(db, table),
    auth: {
      getSession: async () => ({ data: { session: signedIn() ? { user: { email: ME } } : null }, error: null }),
      onAuthStateChange: (cb) => { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithOAuth: async () => { store.set(`${KEY}-session`, '1'); location.reload(); return { data: {}, error: null }; },
      signOut: async () => { store.del(`${KEY}-session`); authListeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
    },
    channel: () => {
      const channel = {
        on: (type, filter, cb) => { db.listeners.push({ table: filter.table, cb }); return channel; },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: () => {},
    // Demo only: pretend a client wrote through the Contact with Zenatiq widget.
    demoClientMessage: async (projectId, { name, category, subject, body }) => {
      db.asClient = true;
      try {
        const thread = db.insert('threads', { project_id: projectId, subject, category, client_name: name || null });
        db.insert('messages', { thread_id: thread.id, author_name: name || null, body });
      } finally {
        db.asClient = false;
      }
      db.save();
      return true;
    },
  };
}
