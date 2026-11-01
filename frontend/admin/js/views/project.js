// One project: overview, task board, client messages, payments, activity and the widget code.
import {
  html, icon, mount, pill, avatar, options, LABELS, TYPE_ICON, fmtDate, fmtShort, fmtTime, ago, isOverdue, money,
  safeUrl, prettyUrl, emptyState, toast, confirmDialog, copyText, friendly, modal, val, quotePayments,
} from '../lib.js';
import {
  taskModal, projectModal, quoteModal, paymentModal, clientModal, renderConversation, threadRow, activityRow,
  subscriptionModal, renewModal, paidUntilSays,
} from './parts.js';

const SITE = ['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin : 'https://www.zenatiqsolutions.com';

export async function render(ctx) {
  const { el, db, store, isAdmin } = ctx;
  const [id, tab = 'overview', sub] = ctx.params;
  await store.load();
  const project = store.project(id);
  if (!ctx.isCurrent()) return;
  if (!project) {
    ctx.title = 'Project not found';
    el.innerHTML = String(emptyState('Project not found', 'It may have been deleted.',
      html`<a class="btn btn--primary" href="#/projects">Back to projects</a>`));
    return;
  }
  ctx.title = project.name;
  ctx.project = project;

  const threads = await db.threads.list({ projectId: id });
  const unread = threads.filter((t) => t.unread_by_team).length;
  const tabs = [
    ['overview', 'Overview'], ['tasks', 'Tasks'], ['messages', 'Contact Clients'],
    ...(isAdmin ? [['payments', 'Payments']] : []), ['activity', 'Activity'], ['connect', 'Widget'],
  ];
  const active = tabs.some((t) => t[0] === tab) ? tab : 'overview';
  ctx.tab = active;
  const client = store.client(project.client_id);
  const live = safeUrl(project.live_url);
  const adminUrl = safeUrl(project.admin_url);

  mount(el, html`
    <a class="crumb" href="#/projects">${icon('a-back')}Projects</a>
    <header class="phead">
      <div class="phead__main">
        <span class="phead__icon">${icon(TYPE_ICON[project.type] || 'a-folder')}</span>
        <div><h1>${project.name}</h1><p>${client ? client.name : 'No client yet'} · ${LABELS.type[project.type]}</p></div>
      </div>
      <div class="phead__actions">
        <label class="mini"><span>Stage</span><select class="input input--sm" data-change="stage">${options(LABELS.status, project.status)}</select></label>
        ${live ? html`<a class="btn btn--ghost btn--sm" href="${live}" target="_blank" rel="noopener">${icon('external')}Live site</a>` : ''}
        ${adminUrl ? html`<a class="btn btn--ghost btn--sm" href="${adminUrl}" target="_blank" rel="noopener">${icon('external')}Admin panel</a>` : ''}
        <button class="btn btn--ghost btn--sm" type="button" data-act="edit">${icon('a-edit')}Edit</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Project sections">
      ${tabs.map(([key, label]) => html`<a href="#/projects/${id}/${key}" class="${key === active ? 'is-active' : ''}"
        aria-current="${key === active ? 'page' : 'false'}">${label}${key === 'messages' && unread ? html`<b class="badge">${unread}</b>` : ''}</a>`)}
    </nav>
    <div class="tab" data-tab></div>`, {
    stage: async (select) => {
      try { await db.projects.update(id, { status: select.value }); toast(`Moved to ${LABELS.status[select.value]}`); await store.load(); }
      catch (err) { toast(friendly(err), 'error'); }
    },
    edit: async () => { if (await projectModal(ctx, project)) render(ctx); },
  });

  await TABS[active](ctx, el.querySelector('[data-tab]'), project, { sub, threads });
}

// What the team did in the portal on this project, newest first.
async function portalActivity(ctx, box, project) {
  const { db, store } = ctx;
  let items = await db.activity.list({ projectId: project.id, limit: 40 });
  const draw = (more) => mount(box, html`
    <section class="card">
      ${items.length ? html`<ul class="acts">${items.map((a) => activityRow(a, store, { showProject: false }))}</ul>` : emptyState('No activity yet')}
      ${more ? html`<button class="btn btn--ghost btn--sm load-more" type="button" data-act="more">Show older</button>` : ''}
    </section>`, {
    more: async () => {
      const older = await db.activity.list({ projectId: project.id, limit: 40, before: items.at(-1).id });
      items = items.concat(older);
      draw(older.length === 40);
    },
  });
  draw(items.length === 40);
}

// Every commit in the project's GitHub repository, newest first and grouped by day, from the
// latest one back to the very first ("Show older commits" loads the next 50).
async function commitLog(ctx, box, project) {
  const { db } = ctx;
  if (!project.repo_url) {
    return mount(box, html`<section class="card">${emptyState('No GitHub repository yet',
      "Add the project's repository address and every commit shows up here, newest first.",
      html`<button class="btn btn--primary" type="button" data-act="edit">${icon('a-edit')}Add the repository</button>`)}</section>`, {
      edit: async () => { if (await projectModal(ctx, project)) render(ctx); },
    });
  }

  let state;
  const load = async (branch = null) => {
    box.innerHTML = '<section class="card"><div class="loading"><span class="spinner"></span></div></section>';
    try {
      const first = await db.github.commits(project.id, { branch });
      state = { first, commits: first.commits, nextPage: first.nextPage };
    } catch (err) {
      state = { error: friendly(err), branch };
    }
    if (ctx.isCurrent()) draw();
  };

  const draw = () => {
    if (state.error) {
      return mount(box, html`<section class="card">${emptyState("The commits couldn't load", state.error,
        html`<button class="btn btn--ghost" type="button" data-act="retry">Try again</button>`)}</section>`, {
        retry: () => load(state.branch),
      });
    }
    const { first, commits, nextPage } = state;
    const { repo, branch, branches, total } = first;
    mount(box, html`
      <section class="card commits">
        <header class="commits__head">
          <a class="commits__repo" href="${repo.url}" target="_blank" rel="noopener">${icon('a-commit')}<b>${repo.owner}/${repo.name}</b>${icon('external')}</a>
          ${repo.private ? html`<span class="pill pill--off">Private</span>` : ''}
          <span class="commits__count">${total.toLocaleString('en-US')} commit${total === 1 ? '' : 's'} on <b>${branch}</b></span>
          ${branches.length > 1 ? html`<label class="mini commits__branch">${icon('a-branch')}<span class="sr-only">Branch</span>
            <select class="input input--sm" data-change="branch">${branches.map((b) => html`<option value="${b}" ${b === branch ? 'selected' : ''}>${b}</option>`)}</select></label>` : ''}
        </header>
        ${commits.length ? byDay(commits).map(([day, list]) => html`
          <h3 class="commits__day">${day}</h3>
          <ol class="commits__list">${list.map(commitRow)}</ol>`) : emptyState('No commits yet', `The ${branch} branch has no commits.`)}
        ${nextPage ? html`<button class="btn btn--ghost btn--sm load-more" type="button" data-act="more">Show older commits</button>`
          : commits.length ? html`<p class="commits__end">That's every commit on ${branch}, back to the first one.</p>` : ''}
      </section>`, {
      branch: (select) => load(select.value),
      more: async (button) => {
        button.disabled = true;
        button.textContent = 'Loading older commits…';
        try {
          const older = await db.github.commits(project.id, { branch, page: nextPage });
          Object.assign(state, { commits: commits.concat(older.commits), nextPage: older.nextPage });
          if (ctx.isCurrent()) draw();
        } catch (err) {
          toast(friendly(err), 'error');
          button.disabled = false;
          button.textContent = 'Show older commits';
        }
      },
    });
  };
  await load();
}

// [["Sat 31 Oct 2026", [commits…]], …] in the order the commits came.
function byDay(commits) {
  const days = new Map();
  for (const c of commits) {
    const day = c.date ? new Date(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Undated';
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(c);
  }
  return [...days];
}

function commitRow(c) {
  const [title, ...rest] = c.message.split('\n');
  const body = rest.join('\n').trim();
  let face = null;
  try {
    const url = new URL(c.avatar);
    url.searchParams.set('s', '56');
    face = url.protocol === 'https:' ? url.href : null;
  } catch { /* no GitHub account linked to this commit */ }
  return html`<li class="commit">
    ${face ? html`<img class="av av--sm commit__av" src="${face}" alt="" width="28" height="28" loading="lazy">` : avatar({ full_name: c.name, email: c.name }, 'av--sm')}
    <div class="commit__main">
      <a class="commit__title" href="${c.url}" target="_blank" rel="noopener">${title || '(no message)'}</a>
      ${body ? html`<details class="commit__more"><summary>Full message</summary><pre>${body}</pre></details>` : ''}
      <p class="commit__meta"><b>${c.login || c.name}</b> committed ${c.date ? html`<time datetime="${c.date}" title="${fmtTime(c.date)}">${ago(c.date)}</time>` : ''}</p>
    </div>
    <a class="commit__sha" href="${c.url}" target="_blank" rel="noopener" title="${c.sha}">${c.sha.slice(0, 7)}</a>
  </li>`;
}

export function onLive(ctx, table, payload) {
  if (!ctx.project) return;
  if (table === 'threads' || table === 'messages') {
    // Refresh in place on the messages tab so a half-written reply survives.
    if (ctx.tab === 'messages' && ctx.refreshMessages) debounce(ctx, ctx.refreshMessages);
    else if (ctx.tab === 'overview') debounce(ctx, () => render(ctx));
  }
  if (table === 'tasks' && ctx.tab === 'tasks' && (payload.new?.project_id === ctx.project.id || payload.old?.project_id === ctx.project.id)) {
    debounce(ctx, () => render(ctx));
  }
}
const debounce = (ctx, fn) => { clearTimeout(ctx.liveTimer); ctx.liveTimer = setTimeout(() => ctx.isCurrent() && fn(), 500); };

const TABS = {
  // --- Overview ----------------------------------------------------------------
  async overview(ctx, panel, project, { threads }) {
    const { db, store, isAdmin } = ctx;
    const [assigned, tasks, finances, payments] = await Promise.all([
      db.projects.members(project.id), db.tasks.list({ projectId: project.id }),
      isAdmin ? db.money.finances(project.id) : null, isAdmin ? db.money.payments(project.id) : [],
    ]);
    const team = assigned.map((a) => store.member(a.member_id)).filter(Boolean);
    const others = store.activeTeam().filter((m) => !team.some((t) => t.id === m.id));
    const client = store.client(project.client_id);
    const openTasks = tasks.filter((t) => t.status !== 'done').length;
    const openThreads = threads.filter((t) => t.status !== 'resolved').length;
    const paid = quotePayments(payments).reduce((s, p) => s + Number(p.amount), 0);
    const quote = Number(finances?.quoted_amount || 0);
    const link = (url) => (safeUrl(url) ? html`<a href="${safeUrl(url)}" target="_blank" rel="noopener">${prettyUrl(url)} ${icon('external')}</a>` : html`<span class="muted">Not added</span>`);

    mount(panel, html`
      <div class="ov">
        <section class="card">
          <header class="card__head"><h2>Project details</h2><button class="link-sm" type="button" data-act="edit-project">Edit</button></header>
          <dl class="dl">
            <dt>Stage</dt><dd>${pill('status', project.status)}</dd>
            <dt>Type</dt><dd>${LABELS.type[project.type]}</dd>
            <dt>Started</dt><dd>${project.start_date ? fmtDate(project.start_date) : html`<span class="muted">Not set</span>`}</dd>
            <dt>Due</dt><dd>${project.due_date ? html`<span class="${isOverdue(project.due_date, ['live', 'completed', 'maintenance'].includes(project.status)) ? 'is-late' : ''}">${fmtDate(project.due_date)}</span>` : html`<span class="muted">Not set</span>`}</dd>
            <dt>Live website</dt><dd>${link(project.live_url)}</dd>
            <dt>Client's admin panel</dt><dd>${link(project.admin_url)}</dd>
            <dt>Code repository</dt><dd>${link(project.repo_url)}</dd>
          </dl>
          ${project.description ? html`<div class="notes"><h3>Notes</h3><p>${project.description}</p></div>` : ''}
        </section>
        <aside class="ov__side">
          <section class="card card--numbers">
            <a href="#/projects/${project.id}/tasks"><b>${openTasks}</b><span>open task${openTasks === 1 ? '' : 's'}</span></a>
            <a href="#/projects/${project.id}/messages"><b>${openThreads}</b><span>open conversation${openThreads === 1 ? '' : 's'}</span></a>
            ${isAdmin ? html`<a href="#/projects/${project.id}/payments"><b>${finances ? money(Math.max(quote - paid, 0), finances.currency) : '—'}</b><span>balance due</span></a>` : ''}
          </section>
          <section class="card">
            <header class="card__head"><h2>Team</h2></header>
            <ul class="people">${team.map((m) => html`<li>${avatar(m, 'av--sm')}<span><b>${m.full_name}</b><small>${m.job_title || LABELS.role[m.role]}</small></span>
              <button class="icon-btn icon-btn--sm" type="button" data-act="unassign" data-id="${m.id}" aria-label="Take ${m.full_name} off this project">${icon('close')}</button></li>`)}</ul>
            ${team.length ? '' : html`<p class="muted small">Nobody is assigned yet.</p>`}
            ${others.length ? html`<label class="sr-only" for="assign-${project.id}">Add someone</label>
              <select class="input input--sm" id="assign-${project.id}" data-change="assign"><option value="">+ Add someone to this project</option>
              ${others.map((m) => html`<option value="${m.id}">${m.full_name}</option>`)}</select>` : ''}
          </section>
          <section class="card">
            <header class="card__head"><h2>Client</h2>${client ? html`<button class="link-sm" type="button" data-act="edit-client">Edit</button>` : ''}</header>
            ${client ? html`
              <p class="client-name">${client.name}</p>
              <ul class="contact">
                ${client.contact_name ? html`<li>${icon('i-user')}${client.contact_name}</li>` : ''}
                ${client.phone ? html`<li>${icon('phone')}<a href="tel:${client.phone.replace(/\s/g, '')}">${client.phone}</a></li>` : ''}
                ${client.email ? html`<li>${icon('a-send')}<a href="mailto:${client.email}">${client.email}</a></li>` : ''}
                ${client.address ? html`<li>${icon('pin')}${client.address}</li>` : ''}
              </ul>
              ${client.notes ? html`<p class="small muted">${client.notes}</p>` : ''}`
            : html`<p class="muted small">No client linked.</p><button class="btn btn--ghost btn--sm" type="button" data-act="edit-project">Link a client</button>`}
          </section>
        </aside>
      </div>`, {
      'edit-project': async () => { if (await projectModal(ctx, project)) render(ctx); },
      'edit-client': async () => { if (await clientModal(ctx, client)) render(ctx); },
      assign: async (select) => {
        if (!select.value) return;
        try { await db.projects.assign(project.id, select.value); toast('Added to the project'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); }
      },
      unassign: async (btn) => {
        try { await db.projects.unassign(project.id, btn.dataset.id); toast('Taken off the project'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); }
      },
    });
  },

  // --- Task board ------------------------------------------------------------------
  async tasks(ctx, panel, project) {
    const { db, store, me } = ctx;
    let tasks = await db.tasks.list({ projectId: project.id });
    let mineOnly = false;

    const card = (t) => html`
      <article class="tcard" draggable="true" data-task="${t.id}" data-act="open" tabindex="0" aria-label="${t.title}">
        <p class="tcard__title">${t.title}</p>
        <div class="tcard__meta">
          ${pill('priority', t.priority)}
          ${t.due_date ? html`<span class="due ${isOverdue(t.due_date, t.status === 'done') ? 'is-late' : ''}">${icon('clock')}${fmtShort(t.due_date)}</span>` : ''}
          ${t.thread_id ? html`<span class="tcard__from" title="Created from a client message">${icon('i-chat')}</span>` : ''}
          <span class="grow"></span>${avatar(store.member(t.assignee_id), 'av--sm')}
        </div>
      </article>`;

    const draw = () => {
      const visible = mineOnly ? tasks.filter((t) => t.assignee_id === me.id) : tasks;
      panel.querySelector('[data-board]').innerHTML = String(html`${Object.entries(LABELS.task).map(([status, label]) => {
        const list = visible.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
        return html`
          <section class="col col--${status}">
            <header class="col__head"><h3>${label}</h3><span class="col__count">${list.length}</span>
              <button class="icon-btn icon-btn--sm" type="button" data-act="add" data-status="${status}" aria-label="Add a task to ${label}">${icon('a-plus')}</button></header>
            <div class="col__list" data-drop="${status}">${list.map(card)}${list.length ? '' : html`<p class="col__empty">Drag tasks here</p>`}</div>
          </section>`;
      })}`);
    };
    const reload = async () => { tasks = await db.tasks.list({ projectId: project.id }); draw(); };

    mount(panel, html`
      <div class="board-bar">
        <button class="btn btn--primary btn--sm" type="button" data-act="add" data-status="todo">${icon('a-plus')}Add task</button>
        <label class="switch"><input type="checkbox" data-change="mine"><span>Only my tasks</span></label>
        <span class="hint">Drag cards between columns, or open a card to change it.</span>
      </div>
      <div class="board" data-board></div>`, {
      add: async (btn) => { if (await taskModal(ctx, { projectId: project.id, status: btn.dataset.status })) reload(); },
      open: async (cardEl) => {
        const task = tasks.find((t) => t.id === cardEl.dataset.task);
        if (task && (await taskModal(ctx, { task }))) reload();
      },
      mine: (box) => { mineOnly = box.checked; draw(); },
    });
    draw();

    const board = panel.querySelector('[data-board]');
    board.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-task]')) { e.preventDefault(); e.target.click(); }
    });
    board.addEventListener('dragstart', (e) => {
      const c = e.target.closest('[data-task]');
      if (!c) return;
      e.dataTransfer.setData('text/plain', c.dataset.task);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('is-dragging');
    });
    board.addEventListener('dragend', (e) => e.target.closest('[data-task]')?.classList.remove('is-dragging'));
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('[data-drop]');
      if (!col) return;
      e.preventDefault();
      board.querySelectorAll('.is-over').forEach((c) => c !== col && c.classList.remove('is-over'));
      col.classList.add('is-over');
    });
    board.addEventListener('dragleave', (e) => {
      const col = e.target.closest('[data-drop]');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
    });
    board.addEventListener('drop', async (e) => {
      const col = e.target.closest('[data-drop]');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('is-over');
      const task = tasks.find((t) => t.id === e.dataTransfer.getData('text/plain'));
      if (!task) return;
      const status = col.dataset.drop;
      const inCol = tasks.filter((t) => t.status === status && t.id !== task.id).sort((a, b) => a.position - b.position);
      const before = e.target.closest('[data-task]');
      const idx = before ? inCol.findIndex((t) => t.id === before.dataset.task) : -1;
      let position;
      if (idx === -1) position = (inCol.at(-1)?.position ?? 0) + 1;
      else position = idx === 0 ? inCol[0].position - 1 : (inCol[idx - 1].position + inCol[idx].position) / 2;
      if (task.status === status && task.position === position) return;
      Object.assign(task, { status, position });
      draw();
      try {
        await db.tasks.update(task.id, { status, position });
        if (status === 'done') toast(`"${task.title}" is done`);
      } catch (err) { toast(friendly(err), 'error'); reload(); }
    });
  },

  // --- Client messages ----------------------------------------------------------------
  async messages(ctx, panel, project, { sub, threads }) {
    const { db, store } = ctx;
    const selected = sub && threads.find((t) => t.id === sub) ? sub : null;
    const list = (items) => (items.length
      ? html`<div class="tlist">${items.map((t) => threadRow(t, store, {
        showProject: false, active: t.id === selected, href: `#/projects/${project.id}/messages/${t.id}`,
      }))}</div>`
      : emptyState('No messages yet', `When ${store.client(project.client_id)?.name || 'the client'} writes through Contact with Zenatiq, it lands here.`,
        html`<a class="btn btn--ghost btn--sm" href="#/projects/${project.id}/connect">Set up the widget</a>`));
    mount(panel, html`
      <div class="inbox ${selected ? 'has-open' : ''}">
        <section class="inbox__list">
          <header class="inbox__list-head">
            <p><b data-total>${threads.length}</b> conversation${threads.length === 1 ? '' : 's'}</p>
            <button class="btn btn--ghost btn--sm" type="button" data-act="start">${icon('a-plus')}Message the client</button>
          </header>
          <div data-list>${list(threads)}</div>
        </section>
        <section class="inbox__convo" data-convo>
          ${selected ? '' : html`<div class="empty empty--sm">${icon('i-chat')}<h3>Pick a conversation</h3><p>Bug reports, update requests and questions from this client appear on the left.</p></div>`}
        </section>
      </div>`, {
      start: async () => {
        const threadId = await modal({
          title: `Message ${store.client(project.client_id)?.name || 'the client'}`,
          submitLabel: 'Send',
          body: html`
            <p class="modal__text">Starts a new conversation that the client sees in their Contact with Zenatiq panel.</p>
            <label class="field"><span>Subject</span><input class="input" name="subject" required maxlength="200" placeholder="e.g. Your new product page is live" autofocus></label>
            <label class="field"><span>Type</span><select class="input" name="category">${options(LABELS.category, 'update')}</select></label>
            <label class="field"><span>Message</span><textarea class="input" name="body" rows="5" required maxlength="5000"></textarea></label>`,
          onSubmit: async (fd) => {
            const thread = await db.threads.add({ project_id: project.id, subject: val(fd, 'subject'), category: val(fd, 'category'), unread_by_team: false });
            await db.threads.reply(thread.id, val(fd, 'body'));
            toast('Message sent to the client');
            return thread.id;
          },
        });
        if (threadId) ctx.go(`#/projects/${project.id}/messages/${threadId}`);
      },
    });
    const convoOptions = {
      backHref: `#/projects/${project.id}/messages`,
      onChange: (why) => { if (why !== 'read') render(ctx); else ctx.refreshBadges(); },
    };
    if (selected) await renderConversation(ctx, panel.querySelector('[data-convo]'), selected, convoOptions);

    ctx.refreshMessages = async () => {
      const fresh = await db.threads.list({ projectId: project.id });
      if (!ctx.isCurrent()) return;
      panel.querySelector('[data-list]').innerHTML = String(list(fresh));
      panel.querySelector('[data-total]').textContent = fresh.length;
      if (selected) await renderConversation(ctx, panel.querySelector('[data-convo]'), selected, convoOptions);
    };
  },

  // --- Payments (owners and admins) -------------------------------------------------------
  async payments(ctx, panel, project) {
    const { db, store } = ctx;
    const [finances, payments, { subscription: sub, renewals }] = await Promise.all([
      db.money.finances(project.id), db.money.payments(project.id), db.subscriptions.get(project.id),
    ]);
    const currency = finances?.currency || 'LKR';
    const quote = Number(finances?.quoted_amount || 0);
    const paid = quotePayments(payments).reduce((s, p) => s + Number(p.amount), 0);
    const pct = quote ? Math.min(100, Math.round((paid / quote) * 100)) : 0;
    const client = store.client(project.client_id);
    const remindTo = sub?.email || client?.email;

    mount(panel, html`
      <div class="money">
        <section class="card subcard">
          ${sub ? html`
            <header class="card__head"><h2>Yearly subscription</h2>${pill('sub', sub.status)}</header>
            <div class="subcard__facts">
              <div><span>Package</span><b>${sub.package}</b></div>
              <div><span>Yearly price</span><b>${money(sub.price, sub.currency)}</b></div>
              <div><span>Paid until</span><b>${fmtDate(sub.ends_on)}</b><small class="${['grace', 'expired'].includes(sub.status) ? 'is-due' : ''}">${paidUntilSays(sub)}</small></div>
              <div><span>Reminders go to</span><b class="${remindTo ? '' : 'is-due'}">${remindTo || 'No email yet'}</b>
                <small>${sub.last_reminded_at ? `Last one ${ago(sub.last_reminded_at)}` : 'None sent yet'}</small></div>
            </div>
            ${sub.notes ? html`<p class="small muted">${sub.notes}</p>` : ''}
            <div class="subcard__actions">
              ${sub.status === 'cancelled' ? '' : html`<button class="btn btn--primary btn--sm" type="button" data-act="renew">${icon('a-renew')}Record a renewal</button>
                <button class="btn btn--ghost btn--sm" type="button" data-act="remind" ${remindTo ? '' : 'disabled'}>${icon('a-send')}Email a reminder now</button>`}
              ${sub.renew_url ? html`<button class="btn btn--ghost btn--sm" type="button" data-act="copy-renew" title="The client's renewal page, where they can pay">${icon('copy')}Copy renewal link</button>` : ''}
              <button class="btn btn--ghost btn--sm" type="button" data-act="edit-sub">${icon('a-edit')}Edit</button>
              <button class="btn btn--ghost btn--sm" type="button" data-act="cancel-sub">${sub.status === 'cancelled' ? 'Restart reminders' : 'Cancel subscription'}</button>
            </div>
            ${renewals.length ? html`<details class="subcard__history"><summary>Renewal history (${renewals.length})</summary>
              <ul class="plist">${renewals.map((r) => html`<li><div><b>${money(r.amount, r.currency)}</b>
                <small>${r.years} year${r.years > 1 ? 's' : ''}: paid until ${fmtDate(r.to_ends_on)} · ${store.member(r.recorded_by)?.full_name || ''}</small></div>
                <time>${fmtDate(r.paid_on)}</time></li>`)}</ul></details>` : ''}`
          : html`<div class="subcard__empty">
              <div><h2>Yearly subscription</h2><p class="small muted">If ${client?.name || 'the client'} pays every year to keep using this, set it up here. The portal tracks when it's due and emails reminders before then.</p></div>
              <button class="btn btn--primary btn--sm" type="button" data-act="setup-sub">${icon('a-renew')}Set up a yearly subscription</button>
            </div>`}
        </section>
        <section class="card money__summary">
          <div><span>Quoted price</span><b>${finances ? money(quote, currency) : '—'}</b></div>
          <div><span>Paid towards quote</span><b>${money(paid, currency)}</b></div>
          <div><span>Balance due</span><b class="${quote - paid > 0 ? 'is-due' : ''}">${finances ? money(Math.max(quote - paid, 0), currency) : '—'}</b></div>
          <div class="money__bar" role="img" aria-label="${pct}% paid"><i style="width:${pct}%"></i></div>
          <div class="money__actions">
            <button class="btn btn--ghost btn--sm" type="button" data-act="quote">${icon('a-edit')}${finances ? 'Change quote' : 'Add the quote'}</button>
            <button class="btn btn--primary btn--sm" type="button" data-act="pay">${icon('a-plus')}Record a payment</button>
          </div>
          ${finances?.notes ? html`<p class="small muted money__notes">${finances.notes}</p>` : ''}
        </section>
        <section class="card">
          <header class="card__head"><h2>Payments</h2><span class="muted small">Only owners and admins can see this</span></header>
          ${payments.length ? html`
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded by</th><th><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>${payments.map((p) => html`<tr>
                <td>${fmtDate(p.paid_on)}</td><td class="num">${money(p.amount, currency)}</td><td>${LABELS.method[p.method]}</td>
                <td>${p.kind === 'renewal' ? html`<span class="pill is-renewal">Renewal</span> ` : ''}${p.reference || ''}${p.note ? html`<small class="block muted">${p.note}</small>` : ''}</td>
                <td>${store.member(p.recorded_by)?.full_name || ''}</td>
                <td class="right"><button class="icon-btn icon-btn--sm" type="button" data-act="delete" data-id="${p.id}" aria-label="Delete this payment">${icon('a-trash')}</button></td>
              </tr>`)}</tbody>
            </table></div>` : emptyState('No payments recorded', 'Record each advance or instalment as it comes in.')}
        </section>
      </div>`, {
      quote: async () => { if (await quoteModal(ctx, project, finances)) render(ctx); },
      pay: async () => { if (await paymentModal(ctx, { projectId: project.id, currency })) render(ctx); },
      'setup-sub': async () => { if (await subscriptionModal(ctx, project)) render(ctx); },
      'edit-sub': async () => { if (await subscriptionModal(ctx, project, sub)) render(ctx); },
      renew: async () => { if (await renewModal(ctx, project, sub)) render(ctx); },
      'copy-renew': () => copyText(sub.renew_url, 'Renewal link copied. Send it to the client to pay online or by bank transfer.'),
      remind: async (btn) => {
        btn.disabled = true;
        try { const { to } = await db.subscriptions.remind(project.id); toast(`Reminder emailed to ${to}`); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); btn.disabled = false; }
      },
      'cancel-sub': async () => {
        const restart = sub.status === 'cancelled';
        if (!restart && !(await confirmDialog({
          title: 'Cancel this subscription?', confirmLabel: 'Cancel subscription',
          message: `No more reminder emails go to ${remindTo || 'the client'}. You can restart it, or record a renewal, any time.`,
        }))) return;
        try { await db.subscriptions.cancel(project.id, !restart); toast(restart ? 'Reminders are back on' : 'Subscription cancelled'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); }
      },
      delete: async (btn) => {
        const p = payments.find((x) => x.id === btn.dataset.id);
        if (!(await confirmDialog({ title: 'Delete this payment?', message: `${money(p.amount, currency)} on ${fmtDate(p.paid_on)} will be removed.` }))) return;
        try { await db.money.removePayment(p.id); toast('Payment deleted'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); }
      },
    });
  },

  // --- Activity: the commits in the project's GitHub repository, and the portal's own log ---
  async activity(ctx, panel, project, { sub }) {
    const view = sub === 'portal' ? 'portal' : 'commits';
    const link = (key, label, symbol) => html`<a href="#/projects/${project.id}/activity/${key}" class="${view === key ? 'is-on' : ''}"
      aria-current="${view === key ? 'page' : 'false'}">${icon(symbol)}${label}</a>`;
    mount(panel, html`
      <nav class="seg seg--tabs" aria-label="Activity">${link('commits', 'GitHub commits', 'a-commit')}${link('portal', 'Portal activity', 'clock')}</nav>
      <div data-view></div>`);
    const box = panel.querySelector('[data-view]');
    return view === 'portal' ? portalActivity(ctx, box, project) : commitLog(ctx, box, project);
  },

  // --- Widget code, and the licence check for systems on a yearly subscription ----------------
  async connect(ctx, panel, project) {
    const { db, demo, isAdmin } = ctx;
    const sub = isAdmin ? (await db.subscriptions.get(project.id)).subscription : null;
    if (!ctx.isCurrent()) return;
    const snippet = `<!-- Contact with Zenatiq -->\n<script src="${SITE}/connect/widget.js" data-key="${project.connect_key}" defer></script>`;
    const inline = `<div id="zenatiq-connect"></div>\n<script src="${SITE}/connect/widget.js" data-key="${project.connect_key}" data-mode="inline" defer></script>`;
    const pageLink = `${SITE}/connect/?key=${project.connect_key}`;
    const licenseKey = `ZENATIQ_KEY=${project.connect_key}`;
    const licenseServer = [
      "import { createLicense } from './zenatiq-license.mjs';",
      '',
      "const license = createLicense({ key: process.env.ZENATIQ_KEY, file: '.zenatiq-license.json' });",
      'await license.start(); // checks now, then once a day',
      "app.use(license.readOnlyGuard({ allow: ['/api/login', '/api/logout'] }));",
      "app.get('/api/license', (req, res) => res.json(license.state()));",
    ].join('\n');
    const licenseBanner = [
      "fetch('/api/license').then((r) => r.json()).then((s) => {",
      '  if (!s.message) return;',
      "  const bar = document.createElement('div');",
      "  bar.style.cssText = 'position:sticky;top:0;z-index:9999;padding:10px 16px;background:#b3261e;color:#fff;font:14px sans-serif;text-align:center';",
      "  bar.textContent = s.message + ' ';",
      "  if (s.renewUrl) bar.append(Object.assign(document.createElement('a'), { href: s.renewUrl, target: '_blank', textContent: 'Renew now', style: 'color:#fff;font-weight:bold' }));",
      '  document.body.prepend(bar);',
      '});',
    ].join('\n');
    // What the licence says today, for owners and admins (members can't see subscriptions).
    const LICENSE_SAYS = {
      active: 'The system works normally.',
      ending: 'The system shows a renewal banner.',
      grace: 'The system shows a renewal banner, and goes read-only when the grace days run out.',
      expired: 'The system is read-only until the client renews.',
      cancelled: 'Cancelled: the system goes read-only once its paid days and grace days run out.',
    };
    const licenseStatus = !isAdmin ? '' : sub
      ? html`<p class="licence__status ${{ active: 'is-on', grace: 'is-due', expired: 'is-due' }[sub.status] || ''}">${icon(sub.status === 'active' ? 'check' : 'clock')}<span>
          <b>${sub.package}</b>, paid until ${fmtDate(sub.ends_on)}. ${LICENSE_SAYS[sub.status] || ''}</span></p>`
      : html`<p class="licence__status">${icon('clock')}<span>No yearly subscription yet, so the licence counts this project as a one-time purchase and the system never goes read-only.
          <a href="#/projects/${project.id}/payments">Set one up on the Payments tab</a>.</span></p>`;
    mount(panel, html`
      <div class="connect">
        <div class="connect__main">
        <section class="card">
          <header class="card__head"><h2>Contact with Zenatiq</h2>
            <label class="switch"><input type="checkbox" data-change="toggle" ${project.connect_enabled ? 'checked' : ''}><span>${project.connect_enabled ? 'On' : 'Off'}</span></label></header>
          <p>Put this in <b>${project.name}</b>'s admin panel. The client can then report bugs, ask for updates and read your replies, and everything lands in your inbox here.</p>
          <ol class="steps-sm">
            <li><b>Floating button</b> (recommended). Paste before <code>&lt;/body&gt;</code> on the admin panel's pages:</li>
          </ol>
          <div class="code"><pre>${snippet}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="snippet">${icon('copy')}Copy</button></div>
          <ol class="steps-sm" start="2"><li><b>Inside a page</b>, for example a "Support" page in their admin panel:</li></ol>
          <div class="code"><pre>${inline}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="inline">${icon('copy')}Copy</button></div>
          <ol class="steps-sm" start="3"><li><b>A link</b>, for systems where you can't add code (for example Odoo), as a menu item or bookmark:</li></ol>
          <div class="code"><pre>${pageLink}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="link">${icon('copy')}Copy</button></div>
          <p class="hint">React apps: put the script tag in <code>index.html</code>. The key only works for this project, so keep it inside the client's logged-in admin area.</p>
        </section>
        <section class="card licence" id="licence">
          <header class="card__head"><h2>Licence check</h2>${sub ? pill('sub', sub.status) : ''}</header>
          <p>For a system on a yearly subscription, such as a POS. Its server asks Zenatiq once a day whether the subscription is paid, shows a banner when renewal is due, and goes read-only once the grace days run out. Staff can still sign in, look things up and export their data.</p>
          ${licenseStatus}
          <ol class="steps-sm">
            <li><b>Download the licence check</b> and put it in the system's server folder. It needs Node.js 18 or newer, and nothing else.</li>
          </ol>
          <a class="btn btn--ghost btn--sm" href="${SITE}/license/zenatiq-license.mjs" download="zenatiq-license.mjs">Download zenatiq-license.mjs</a>
          <ol class="steps-sm" start="2"><li><b>Add this project's key</b> to the server's settings, in its <code>.env</code> file or its hosting settings:</li></ol>
          <div class="code"><pre>${licenseKey}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="licenseKey">${icon('copy')}Copy</button></div>
          <ol class="steps-sm" start="3"><li><b>Add the check</b> to the server's main file (Express). Change the two paths to the system's own sign-in and sign-out addresses:</li></ol>
          <div class="code"><pre>${licenseServer}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="licenseServer">${icon('copy')}Copy</button></div>
          <ol class="steps-sm" start="4"><li><b>Show the banner</b> in the admin panel. Skip this if the floating Contact with Zenatiq button is there: it already shows one.</li></ol>
          <div class="code"><pre>${licenseBanner}</pre><button class="btn btn--ghost btn--sm" type="button" data-act="copy" data-what="licenseBanner">${icon('copy')}Copy</button></div>
          <p class="hint">While the system is read-only, saving anything gets a <code>402</code> reply: show its <code>error.message</code> to the user. Add <code>.zenatiq-license.json</code> to <code>.gitignore</code>, and on Vercel leave out <code>file</code>. A system without its own Node.js server, such as a React app that talks straight to Firebase, can't run the check: the floating Contact with Zenatiq button still shows renewal banners there.</p>
        </section>
        </div>
        <aside class="ov__side">
          <section class="card">
            <h2>See what the client sees</h2>
            ${demo ? html`<p class="small muted">In demo mode you can send a pretend client message to try the inbox.</p>
              <button class="btn btn--primary btn--sm" type="button" data-act="simulate">${icon('i-chat')}Send a test client message</button>`
            : html`<p class="small muted">Opens the client's view in a new tab. Messages you send there arrive as real client messages.</p>
              <a class="btn btn--primary btn--sm" href="${pageLink}" target="_blank" rel="noopener">${icon('external')}Open the client view</a>`}
          </section>
          <section class="card">
            <h2>Key</h2>
            <p class="small muted">If the key ends up somewhere public, make a new one. The old code stops working straight away, and so does the licence check until the new key is in the system's settings.</p>
            <button class="btn btn--danger-ghost btn--sm" type="button" data-act="rekey">${icon('a-key')}Make a new key</button>
          </section>
        </aside>
      </div>`, {
      copy: (btn) => copyText({ snippet, inline, link: pageLink, licenseKey, licenseServer, licenseBanner }[btn.dataset.what], 'Copied'),
      toggle: async (box) => {
        try { await db.projects.update(project.id, { connect_enabled: box.checked }); toast(box.checked ? 'Contact with Zenatiq is on' : 'Contact with Zenatiq is off'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); box.checked = !box.checked; }
      },
      rekey: async () => {
        const ok = await confirmDialog({ title: 'Make a new key?', message: `The widget already on ${project.name}'s admin panel stops working until you paste the new code there.`, confirmLabel: 'Make a new key' });
        if (!ok) return;
        try { await db.projects.newKey(project.id); toast('New key made. Update the code on the client\'s site.'); render(ctx); }
        catch (err) { toast(friendly(err), 'error'); }
      },
      simulate: async () => {
        const sent = await modal({
          title: 'Send a test client message',
          submitLabel: 'Send as the client',
          body: html`
            <label class="field"><span>Client's name</span><input class="input" name="name" value="Test client" required></label>
            <label class="field"><span>Type</span><select class="input" name="category">${options(LABELS.category, 'bug')}</select></label>
            <label class="field"><span>Subject</span><input class="input" name="subject" required value="The contact form isn't sending"></label>
            <label class="field"><span>Message</span><textarea class="input" name="body" rows="4" required>Customers say nothing happens when they press Send.</textarea></label>`,
          onSubmit: async (fd) => db.simulateClientMessage(project.id, Object.fromEntries(fd)),
        });
        if (sent) { toast('Test message sent. Check the inbox.'); ctx.refreshBadges(); db.pollNow(); }
      },
    });
  },
};
