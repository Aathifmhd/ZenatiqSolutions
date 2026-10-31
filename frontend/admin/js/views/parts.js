// Zenatiq admin: pieces shared by several pages (rows, forms, the conversation view).
import {
  html, icon, mount, modal, confirmDialog, toast, options, pill, avatar, LABELS,
  ago, fmtShort, fmtDate, fmtTime, isOverdue, val, num, today, safeUrl, friendly, money,
} from '../lib.js';

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
export const sortTasks = (a, b) =>
  (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') ||
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

const memberOptions = (store, selected, blank = 'Nobody yet') => html`
  <option value="">${blank}</option>
  ${store.activeTeam().map((m) => html`<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${m.full_name}</option>`)}`;

// --- Rows -------------------------------------------------------------------------
export const threadRow = (t, store, { active = false, showProject = true, href } = {}) => {
  const project = store.project(t.project_id);
  return html`
    <a class="trow ${t.unread_by_team ? 'is-unread' : ''} ${active ? 'is-active' : ''}" href="${href || `#/inbox/${t.id}`}">
      <span class="trow__dot" aria-hidden="true"></span>
      <span class="trow__main">
        <span class="trow__top"><b>${showProject ? project?.name || 'Project' : t.client_name || 'Client'}</b><time>${ago(t.last_message_at)}</time></span>
        <span class="trow__subject">${t.unread_by_team ? html`<span class="sr-only">Unread: </span>` : ''}${t.subject}</span>
        <span class="trow__tags">${pill('category', t.category)}${pill('thread', t.status)}</span>
      </span>
    </a>`;
};

export const taskRow = (t, store, { showProject = true } = {}) => {
  const project = store.project(t.project_id);
  const done = t.status === 'done';
  return html`
    <div class="rtask ${done ? 'is-done' : ''}">
      <button class="check ${done ? 'is-on' : ''}" type="button" data-act="toggle-task" data-id="${t.id}"
        aria-label="${done ? 'Mark as not done' : 'Mark as done'}" aria-pressed="${done}">${icon('check')}</button>
      <button class="rtask__main" type="button" data-act="open-task" data-id="${t.id}">
        <span class="rtask__title">${t.title}</span>
        <span class="rtask__meta">
          ${showProject && project ? html`<span>${project.name}</span>` : ''}
          ${done ? '' : pill('priority', t.priority)}
          ${t.due_date ? html`<span class="due ${isOverdue(t.due_date, done) ? 'is-late' : ''}">${icon('clock')}${fmtShort(t.due_date)}</span>` : ''}
        </span>
      </button>
      ${avatar(store.member(t.assignee_id), 'av--sm')}
    </div>`;
};

const ACTIVITY_ICON = { message: 'i-chat', thread: 'i-chat', task: 'a-tasks', project: 'a-folder', team: 'a-users', client: 'a-building', payment: 'a-wallet', finance: 'a-wallet' };
export const activityRow = (a, store, { showProject = true } = {}) => {
  const kind = a.action.split('.')[0];
  const project = showProject && a.project_id ? store.project(a.project_id) : null;
  return html`
    <li class="act act--${kind}">
      <span class="act__icon">${icon(ACTIVITY_ICON[kind] || 'clock')}</span>
      <div class="act__body">
        <p><b>${a.actor_label}</b> · ${a.summary}</p>
        <p class="act__meta"><time title="${fmtTime(a.created_at)}">${ago(a.created_at)}</time>${project ? html` · <a href="#/projects/${project.id}">${project.name}</a>` : ''}</p>
      </div>
    </li>`;
};

// --- Forms ------------------------------------------------------------------------
export function taskModal(ctx, { task = null, projectId = null, status = 'todo', fromThread = null } = {}) {
  const { store, db, me } = ctx;
  const t = task || {
    title: fromThread ? fromThread.subject : '',
    description: fromThread?.lastMessage || '',
    status,
    priority: fromThread?.category === 'bug' ? 'high' : 'medium',
    assignee_id: fromThread?.assignee_id || null,
    due_date: null,
  };
  const pickProject = !task && !projectId && !fromThread;
  return modal({
    title: task ? 'Edit task' : fromThread ? 'Create a task from this message' : 'New task',
    submitLabel: task ? 'Save changes' : 'Add task',
    body: html`
      <label class="field"><span>Task</span><input class="input" name="title" required maxlength="300" value="${t.title}" autofocus></label>
      ${pickProject ? html`<label class="field"><span>Project</span><select class="input" name="project_id" required>
        <option value="">Choose a project</option>${store.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>` : ''}
      <label class="field"><span>Details <em>(optional)</em></span><textarea class="input" name="description" rows="4" maxlength="5000">${t.description || ''}</textarea></label>
      <div class="field-row">
        <label class="field"><span>Status</span><select class="input" name="status">${options(LABELS.task, t.status)}</select></label>
        <label class="field"><span>Priority</span><select class="input" name="priority">${options(LABELS.priority, t.priority)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Assigned to</span><select class="input" name="assignee_id">${memberOptions(store, t.assignee_id)}</select></label>
        <label class="field"><span>Due date</span><input class="input" type="date" name="due_date" value="${t.due_date || ''}"></label>
      </div>`,
    actions: task ? [{ act: 'delete', label: 'Delete', icon: 'a-trash', danger: true }] : [],
    onAction: async (act) => {
      if (act !== 'delete') return false;
      if (!(await confirmDialog({ title: 'Delete this task?', message: `"${task.title}" will be removed for everyone.` }))) return false;
      await db.tasks.remove(task.id);
      toast('Task deleted');
    },
    onSubmit: async (fd) => {
      const row = {
        title: val(fd, 'title'), description: val(fd, 'description'), status: val(fd, 'status'),
        priority: val(fd, 'priority'), assignee_id: val(fd, 'assignee_id'), due_date: val(fd, 'due_date'),
      };
      if (task) {
        await db.tasks.update(task.id, row);
        toast('Task saved');
      } else {
        await db.tasks.add({
          ...row,
          project_id: pickProject ? val(fd, 'project_id') : projectId || fromThread.project_id,
          thread_id: fromThread?.id || null,
          created_by: me.id,
        });
        toast('Task added');
      }
      return true;
    },
  });
}

export function projectModal(ctx, project = null) {
  const { store, db } = ctx;
  const p = project || { type: 'website', status: 'planning' };
  return modal({
    title: project ? 'Edit project' : 'New project',
    submitLabel: project ? 'Save changes' : 'Create project',
    wide: true,
    body: html`
      <label class="field"><span>Project name</span><input class="input" name="name" required maxlength="200" value="${p.name || ''}" placeholder="e.g. Veloura online store" autofocus></label>
      <div class="field-row">
        <label class="field"><span>Client</span>
          <select class="input" name="client_id" data-client-select>
            <option value="">No client yet</option>
            ${store.clients.map((c) => html`<option value="${c.id}"${c.id === p.client_id ? ' selected' : ''}>${c.name}</option>`)}
            <option value="__new">+ Add a new client…</option>
          </select></label>
        <label class="field" data-new-client hidden><span>New client's business name</span><input class="input" name="new_client" maxlength="200"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Type</span><select class="input" name="type">${options(LABELS.type, p.type)}</select></label>
        <label class="field"><span>Stage</span><select class="input" name="status">${options(LABELS.status, p.status)}</select></label>
      </div>
      <label class="field"><span>Live website <em>(optional)</em></span><input class="input" name="live_url" inputmode="url" value="${p.live_url || ''}" placeholder="https://"></label>
      <div class="field-row">
        <label class="field"><span>Client's admin panel <em>(optional)</em></span><input class="input" name="admin_url" inputmode="url" value="${p.admin_url || ''}" placeholder="https://"></label>
        <label class="field"><span>Code repository <em>(optional)</em></span><input class="input" name="repo_url" inputmode="url" value="${p.repo_url || ''}" placeholder="https://github.com/…"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Start date</span><input class="input" type="date" name="start_date" value="${p.start_date || ''}"></label>
        <label class="field"><span>Due date</span><input class="input" type="date" name="due_date" value="${p.due_date || ''}"></label>
      </div>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="description" rows="3" maxlength="5000">${p.description || ''}</textarea></label>`,
    onOpen: (form) => {
      const select = form.querySelector('[data-client-select]');
      const box = form.querySelector('[data-new-client]');
      select.addEventListener('change', () => {
        box.hidden = select.value !== '__new';
        box.querySelector('input').required = !box.hidden;
        if (!box.hidden) box.querySelector('input').focus();
      });
    },
    onSubmit: async (fd) => {
      const urls = {};
      for (const name of ['live_url', 'admin_url', 'repo_url']) {
        const raw = val(fd, name);
        urls[name] = raw ? safeUrl(raw) : null;
        if (raw && !urls[name]) throw new Error(`"${raw}" doesn't look like a web address.`);
      }
      let clientId = val(fd, 'client_id');
      if (clientId === '__new') {
        const created = await db.clients.add({ name: val(fd, 'new_client') });
        clientId = created.id;
      }
      const row = {
        name: val(fd, 'name'), client_id: clientId, type: val(fd, 'type'), status: val(fd, 'status'),
        start_date: val(fd, 'start_date'), due_date: val(fd, 'due_date'), description: val(fd, 'description'), ...urls,
      };
      const saved = project ? await db.projects.update(project.id, row) : await db.projects.add(row);
      await store.load();
      toast(project ? 'Project saved' : 'Project created');
      return saved;
    },
  });
}

export function clientModal(ctx, client = null) {
  const { store, db } = ctx;
  const c = client || {};
  return modal({
    title: client ? 'Edit client' : 'New client',
    submitLabel: client ? 'Save changes' : 'Add client',
    body: html`
      <label class="field"><span>Business name</span><input class="input" name="name" required maxlength="200" value="${c.name || ''}" autofocus></label>
      <div class="field-row">
        <label class="field"><span>Contact person</span><input class="input" name="contact_name" maxlength="120" value="${c.contact_name || ''}"></label>
        <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" maxlength="40" value="${c.phone || ''}" placeholder="+94 7X XXX XXXX"></label>
      </div>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" maxlength="200" value="${c.email || ''}"></label>
      <label class="field"><span>Address</span><input class="input" name="address" maxlength="300" value="${c.address || ''}"></label>
      <label class="field"><span>Notes</span><textarea class="input" name="notes" rows="3" maxlength="5000">${c.notes || ''}</textarea></label>`,
    actions: client && ctx.isAdmin ? [{ act: 'delete', label: 'Delete', icon: 'a-trash', danger: true }] : [],
    onAction: async (act) => {
      if (act !== 'delete') return false;
      const count = store.projects.filter((p) => p.client_id === client.id).length;
      const ok = await confirmDialog({
        title: `Delete ${client.name}?`,
        message: count ? `Their ${count} project${count > 1 ? 's' : ''} will stay, just without a client.` : 'This removes the client and their contact details.',
      });
      if (!ok) return false;
      await db.clients.remove(client.id);
      await store.load();
      toast('Client deleted');
    },
    onSubmit: async (fd) => {
      const row = Object.fromEntries(['name', 'contact_name', 'phone', 'email', 'address', 'notes'].map((k) => [k, val(fd, k)]));
      const saved = client ? await db.clients.update(client.id, row) : await db.clients.add(row);
      await store.load();
      toast(client ? 'Client saved' : 'Client added');
      return saved;
    },
  });
}

export function quoteModal(ctx, project, finances) {
  return modal({
    title: `Quote for ${project.name}`,
    submitLabel: 'Save quote',
    body: html`
      <div class="field-row field-row--money">
        <label class="field"><span>Currency</span><input class="input" name="currency" maxlength="3" value="${finances?.currency || 'LKR'}" required></label>
        <label class="field"><span>Quoted price</span><input class="input" name="quoted_amount" inputmode="decimal" required value="${finances?.quoted_amount ?? ''}" placeholder="e.g. 40000" autofocus></label>
      </div>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="notes" rows="3" placeholder="e.g. 50% upfront, rest on launch">${finances?.notes || ''}</textarea></label>`,
    onSubmit: async (fd) => {
      const amount = num(fd, 'quoted_amount');
      if (!(amount >= 0)) throw new Error('Enter the quoted price as a number.');
      await ctx.db.money.setQuote(project.id, amount, (val(fd, 'currency') || 'LKR').toUpperCase(), val(fd, 'notes'));
      toast('Quote saved');
      return true;
    },
  });
}

export function paymentModal(ctx, { projectId = null, currency = 'LKR' } = {}) {
  const { store, db, me } = ctx;
  return modal({
    title: 'Record a payment',
    submitLabel: 'Record payment',
    body: html`
      ${projectId ? '' : html`<label class="field"><span>Project</span><select class="input" name="project_id" required>
        <option value="">Choose a project</option>${store.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>`}
      <div class="field-row">
        <label class="field"><span>Amount (${currency})</span><input class="input" name="amount" inputmode="decimal" required placeholder="e.g. 20000" autofocus></label>
        <label class="field"><span>Paid on</span><input class="input" type="date" name="paid_on" required value="${today()}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Method</span><select class="input" name="method">${options(LABELS.method, 'bank_transfer')}</select></label>
        <label class="field"><span>Reference <em>(optional)</em></span><input class="input" name="reference" maxlength="120" placeholder="Receipt or transfer no."></label>
      </div>
      <label class="field"><span>Note <em>(optional)</em></span><input class="input" name="note" maxlength="300"></label>`,
    onSubmit: async (fd) => {
      const amount = num(fd, 'amount');
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
      await db.money.addPayment({
        project_id: projectId || val(fd, 'project_id'), amount, paid_on: val(fd, 'paid_on'),
        method: val(fd, 'method'), reference: val(fd, 'reference'), note: val(fd, 'note'), recorded_by: me.id,
      });
      toast('Payment recorded');
      return true;
    },
  });
}

// --- Yearly subscriptions ------------------------------------------------------------
// The server's date rules (backend/core/renewals.js), here only to preview dates in the forms.
const utc = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const plusYears = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return iso(Date.UTC(y + n, m - 1, Math.min(d, new Date(Date.UTC(y + n, m, 0)).getUTCDate())));
};
const paidUntil = (starts, years = 1) => iso(utc(plusYears(starts, years)) - 864e5);
const renewedUntil = (sub, years, paidOn) =>
  (paidOn && (utc(paidOn) - utc(sub.ends_on)) / 864e5 > sub.grace_days ? paidUntil(paidOn, years) : plusYears(sub.ends_on, years));

// Setting up, changing or deleting a project's yearly subscription.
export function subscriptionModal(ctx, project, sub = null) {
  const client = ctx.store.client(project.client_id);
  const starts = sub?.starts_on || today();
  return modal({
    title: sub ? `Yearly subscription for ${project.name}` : 'Set up a yearly subscription',
    submitLabel: sub ? 'Save changes' : 'Set up subscription',
    body: html`
      ${sub ? '' : html`<p class="modal__text">For what ${client?.name || 'the client'} pays every year for ${project.name}. Reminder emails go out 30, 14, 7 and 1 days before it's due.</p>`}
      <label class="field"><span>Package</span><input class="input" name="package" required maxlength="120" value="${sub?.package || ''}" placeholder="e.g. POS Business" ${sub ? '' : 'autofocus'}></label>
      <div class="field-row field-row--money">
        <label class="field"><span>Currency</span><input class="input" name="currency" maxlength="3" required value="${sub?.currency || 'LKR'}"></label>
        <label class="field"><span>Yearly price</span><input class="input" name="price" inputmode="decimal" required value="${sub?.price ?? ''}" placeholder="e.g. 25000"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Started on</span><input class="input" type="date" name="starts_on" required value="${starts}"></label>
        <label class="field"><span>Paid until</span><input class="input" type="date" name="ends_on" required value="${sub?.ends_on || paidUntil(starts)}">
          <small class="field__hint">The last day that's paid for.</small></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Grace days</span><input class="input" name="grace_days" inputmode="numeric" required value="${sub?.grace_days ?? 14}">
          <small class="field__hint">Extra days to renew after it ends.</small></label>
        <label class="field"><span>Reminder email <em>(optional)</em></span><input class="input" type="email" name="email" maxlength="200" value="${sub?.email || ''}" placeholder="${client?.email || 'name@example.com'}">
          <small class="field__hint">${client?.email ? `Empty: reminders go to ${client.email}.` : 'The client has no email yet, so add one here.'}</small></label>
      </div>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="notes" rows="2" placeholder="e.g. 2 tills, SMS credits included">${sub?.notes || ''}</textarea></label>`,
    actions: sub ? [{ act: 'delete', label: 'Delete', icon: 'a-trash', danger: true }] : [],
    onAction: async (act) => {
      if (act !== 'delete') return false;
      const ok = await confirmDialog({ title: 'Delete this subscription?', message: 'Its renewal history goes too. Payments already recorded stay.' });
      if (!ok) return false;
      await ctx.db.subscriptions.remove(project.id);
      toast('Subscription deleted');
      return true;
    },
    // On a new subscription, "Paid until" follows the start date.
    onOpen: (form) => {
      if (sub) return;
      const { starts_on: start, ends_on: end } = form.elements;
      start.addEventListener('change', () => { if (start.value) end.value = paidUntil(start.value); });
    },
    onSubmit: async (fd) => {
      const price = num(fd, 'price');
      if (!(price >= 0)) throw new Error('Enter the yearly price as a number.');
      await ctx.db.subscriptions.set(project.id, {
        package: val(fd, 'package'), price, currency: (val(fd, 'currency') || 'LKR').toUpperCase(),
        starts_on: val(fd, 'starts_on'), ends_on: val(fd, 'ends_on'), grace_days: num(fd, 'grace_days'),
        email: val(fd, 'email'), notes: val(fd, 'notes'),
      });
      toast(sub ? 'Subscription saved' : 'Subscription set up');
      return true;
    },
  });
}

// Recording a renewal payment, which moves "paid until" on by the years paid for.
export function renewModal(ctx, project, sub) {
  return modal({
    title: `Record a renewal for ${project.name}`,
    submitLabel: 'Record renewal',
    body: html`
      <p class="modal__text">${sub.package}, ${money(sub.price, sub.currency)} a year. Paid until <b>${fmtDate(sub.ends_on)}</b> now.</p>
      <div class="field-row">
        <label class="field"><span>Renew for</span><select class="input" name="years">${[1, 2, 3].map((n) => html`<option value="${n}">${n} year${n > 1 ? 's' : ''}</option>`)}</select></label>
        <label class="field"><span>Amount paid (${sub.currency})</span><input class="input" name="amount" inputmode="decimal" required value="${sub.price}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Paid on</span><input class="input" type="date" name="paid_on" required value="${today()}"></label>
        <label class="field"><span>Method</span><select class="input" name="method">${options(LABELS.method, 'bank_transfer')}</select></label>
      </div>
      <label class="field"><span>Reference <em>(optional)</em></span><input class="input" name="reference" maxlength="120" placeholder="Receipt or transfer no."></label>
      <p class="renew-preview" data-preview></p>`,
    onOpen: (form) => {
      const { years, amount, paid_on: paidOn } = form.elements;
      const show = () => {
        form.querySelector('[data-preview]').innerHTML = String(html`${icon('a-renew')}New paid-until date: <b>${fmtDate(renewedUntil(sub, Number(years.value), paidOn.value))}</b>`);
      };
      years.addEventListener('change', () => { amount.value = Math.round(sub.price * Number(years.value) * 100) / 100; show(); });
      paidOn.addEventListener('change', show);
      show();
    },
    onSubmit: async (fd) => {
      const amount = num(fd, 'amount');
      if (!(amount >= 0)) throw new Error('Enter the amount paid as a number.');
      const renewed = await ctx.db.subscriptions.renew(project.id, {
        years: Number(val(fd, 'years')), amount, paid_on: val(fd, 'paid_on'), method: val(fd, 'method'), reference: val(fd, 'reference'),
      });
      toast(`Renewed. ${project.name} is paid until ${fmtDate(renewed.ends_on)}.`);
      return true;
    },
  });
}

// "in 12 days", "ends today", "ended 3 days ago" for a subscription's paid-until date.
export const paidUntilSays = (sub) => {
  if (sub.status === 'cancelled') return 'Reminders are off';
  const n = sub.days_left;
  if (n === 0) return 'Ends today';
  if (n > 0) return `${n} day${n === 1 ? '' : 's'} left`;
  return `Ended ${-n} day${n === -1 ? '' : 's'} ago`;
};

// --- Conversation ------------------------------------------------------------------
const bubble = (m) => html`
  <div class="msg msg--${m.sender}">
    <div class="msg__meta"><b>${m.sender === 'team' ? m.author_name || 'Zenatiq' : m.author_name || 'Client'}</b>
      ${m.sender === 'team' ? html`<span class="msg__tag">Zenatiq</span>` : ''}<time>${fmtTime(m.created_at)}</time></div>
    <p class="msg__body">${m.body}</p>
  </div>`;

// Shows one conversation with its controls and reply box inside `el`.
export async function renderConversation(ctx, el, threadId, { onChange, backHref } = {}) {
  const { db, store } = ctx;
  const draft = el.querySelector('textarea[name="body"]')?.value || '';
  const [thread, messages] = await Promise.all([db.threads.get(threadId), db.threads.messages(threadId)]);
  if (!thread) {
    el.innerHTML = String(html`<div class="empty empty--sm"><h3>Conversation not found</h3><p>It may have been deleted.</p></div>`);
    return;
  }
  if (thread.unread_by_team) {
    await db.threads.update(thread.id, { unread_by_team: false });
    thread.unread_by_team = false;
    ctx.refreshBadges();
    onChange?.('read');
  }
  const project = store.project(thread.project_id);
  const lastClient = [...messages].reverse().find((m) => m.sender === 'client');

  mount(el, html`
    <header class="convo__head">
      ${backHref ? html`<a class="convo__back" href="${backHref}">${icon('a-back')}All conversations</a>` : ''}
      <p class="convo__project">${project ? html`<a href="#/projects/${project.id}">${project.name}</a>` : 'Project'} ${pill('category', thread.category)}</p>
      <h2>${thread.subject}</h2>
      <p class="convo__from">From <b>${thread.client_name || 'the client'}</b>${thread.client_contact ? html` · ${thread.client_contact}` : ''} · ${fmtTime(thread.created_at)}</p>
      <div class="convo__controls">
        <label class="mini"><span>Status</span><select class="input input--sm" data-change="status">${options(LABELS.thread, thread.status)}</select></label>
        <label class="mini"><span>Handled by</span><select class="input input--sm" data-change="assignee">${memberOptions(store, thread.assignee_id, 'Nobody')}</select></label>
        <button class="btn btn--ghost btn--sm" type="button" data-act="make-task">${icon('a-tasks')}Create task</button>
      </div>
    </header>
    <div class="convo__msgs">${messages.map(bubble)}</div>
    <form class="convo__reply" data-submit="reply">
      <label class="sr-only" for="reply-${thread.id}">Reply</label>
      <textarea class="input" id="reply-${thread.id}" name="body" rows="3" maxlength="5000" required
        placeholder="Reply to ${thread.client_name || 'the client'}…">${draft}</textarea>
      <div class="convo__reply-foot">
        <span class="hint">They'll see it in Contact with Zenatiq on their website. Ctrl + Enter sends.</span>
        <button class="btn btn--primary" type="submit">${icon('a-send')}Send reply</button>
      </div>
    </form>`, {
    status: async (select) => {
      try {
        await db.threads.update(thread.id, { status: select.value });
        toast(`Marked as ${LABELS.thread[select.value].toLowerCase()}`);
        onChange?.('status');
      } catch (err) { toast(friendly(err), 'error'); }
    },
    assignee: async (select) => {
      try {
        await db.threads.update(thread.id, { assignee_id: select.value || null });
        toast(select.value ? `Handled by ${store.member(select.value)?.full_name}` : 'Nobody is handling this now');
      } catch (err) { toast(friendly(err), 'error'); }
    },
    'make-task': async () => {
      const saved = await taskModal(ctx, { fromThread: { ...thread, lastMessage: lastClient?.body || '' } });
      if (saved) onChange?.('task');
    },
    reply: async (form) => {
      const body = form.body.value.trim();
      if (!body) return;
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await db.threads.reply(thread.id, body);
        form.body.value = '';
        await renderConversation(ctx, el, threadId, { onChange, backHref });
        onChange?.('reply');
      } catch (err) {
        toast(friendly(err), 'error');
        button.disabled = false;
      }
    },
  });

  const box = el.querySelector('.convo__msgs');
  box.scrollTop = box.scrollHeight;
  el.querySelector('textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.querySelector('form').requestSubmit(); }
  });
}
