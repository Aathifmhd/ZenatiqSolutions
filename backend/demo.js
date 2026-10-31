// The local demo: the whole portal on your computer without a database. The portal's real rules
// (core/ops.js) run on sample data kept in memory (core/memory.js), and the three sample people
// sign in with one sample password. backend/server.js starts it when MONGODB_URI isn't set; the
// sample data comes back fresh whenever the server restarts.
import { randomUUID as uuid } from 'node:crypto';
import { createConnect, makeActivityId, newConnectKey, OpError } from './core/ops.js';
import { MemoryStore } from './core/memory.js';
import { hashPassword } from './passwords.js';

const SIGN_IN = { email: 'demo@zenatiqsolutions.com', password: 'zenatiq-demo' };

const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString();
const dateIn = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const money = (n, c = 'LKR') => `${c} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function seed(ownerId, passwordHash) {
  const team = [
    { id: ownerId, email: SIGN_IN.email, full_name: 'Mohamed Aathif', role: 'owner', job_title: 'Founder', phone: '+94 75 811 2170', active: true, created_at: ago(60) },
    { id: uuid(), email: 'developer@example.com', full_name: 'Sample Developer', role: 'admin', job_title: 'Developer', phone: null, active: true, created_at: ago(40) },
    { id: uuid(), email: 'designer@example.com', full_name: 'Sample Designer', role: 'member', job_title: 'UI/UX Designer', phone: null, active: true, created_at: ago(30) },
  ];
  const [aathif, dev, designer] = team;
  const client = (name) => ({ id: uuid(), name, contact_name: null, phone: null, email: null, address: null, notes: null, created_at: ago(50) });
  const clients = ['Regal Hardware', 'Cargo POS client', 'Gloss Workx', 'YYR International Trading', 'Veloura', 'Amore Ice Cream'].map(client);
  const project = (name, c, type, status, live, extra = {}) => ({
    id: uuid(), name, client_id: c ? c.id : null, type, status, live_url: live, admin_url: null, repo_url: null, description: null,
    start_date: null, due_date: null, connect_key: newConnectKey(), connect_enabled: true, created_at: ago(45), updated_at: ago(1), ...extra,
  });
  const [regal, cargo, gloss, yyr, veloura, amore] = clients;
  const projects = [
    project('Veloura online store', veloura, 'online_shop', 'in_progress', 'https://veloura-online-store.web.app', { start_date: dateIn(-24), due_date: dateIn(9), description: 'Boutique store with owner-editable products and WhatsApp ordering.' }),
    project('Regal Hardware ERP & POS', regal, 'pos', 'maintenance', 'https://www.regalhw.lk', { admin_url: 'https://www.regalhw.lk/demo', description: 'Odoo-based POS on five tills, a custom ERP and the online store.' }),
    project('Cargo POS', cargo, 'pos', 'live', 'https://cargo-pos-system.vercel.app'),
    project('Gloss Workx website', gloss, 'website', 'live', 'https://glossworkx-landing-page.web.app'),
    project('YYR International website', yyr, 'website', 'maintenance', 'https://yyr-international-trading.web.app'),
    project('Amore concept site', amore, 'website', 'lead', 'https://amore-icecream.web.app', { due_date: dateIn(-1) }),
    project('Zenatiq admin portal', null, 'other', 'review', 'https://www.zenatiqsolutions.com/admin', {
      start_date: dateIn(-7), due_date: dateIn(3), repo_url: 'https://github.com/Aathifmhd/ZenatiqSolutions',
    }),
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
    id: uuid(), thread_id: t.id, project_id: t.project_id, sender, member_id: member?.id || null,
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
    task(pPortal, 'Connect the portal to MongoDB', 'in_progress', 'high', aathif, 2),
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

  const act = (p, member, by, action, summary, when, adminOnly = false) => ({
    id: makeActivityId(Date.parse(when)), project_id: p?.id || null, actor_member_id: member?.id || null,
    actor_label: by || member.full_name, action, summary, admin_only: adminOnly, created_at: when,
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

  const credentials = team.map((m) => ({ member_id: m.id, password_hash: passwordHash, temporary: false, expires_at: null, updated_at: ago(30) }));

  return { team_members: team, credentials, clients, projects, project_members, threads, messages, tasks, project_finances, payments, activity, changes: [] };
}

export async function createDemo() {
  // The sample owner keeps one id, so resetting the data doesn't sign them out.
  const ownerId = uuid();
  const passwordHash = await hashPassword(SIGN_IN.password);
  const store = new MemoryStore(seed(ownerId, passwordHash), { cap: { changes: 300, login_attempts: 100 } });

  return {
    store,
    // Filled in on the sign-in page. The other sample people use the same password.
    signIn: SIGN_IN,
    // Fresh sample data. Sign-ins are kept.
    reset() {
      store.data = { ...seed(ownerId, passwordHash), sessions: store.data.sessions ?? [] };
    },
    // Pretend a client wrote through the Contact with Zenatiq widget.
    async clientMessage({ projectId, ...fields } = {}) {
      const project = typeof projectId === 'string' ? await store.col('projects').findOne({ id: projectId }) : null;
      if (!project) throw new OpError('That project was not found.', 'not_found', 404);
      return createConnect(store).run('start', { ...fields, key: project.connect_key });
    },
  };
}
