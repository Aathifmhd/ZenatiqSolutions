// Dashboard: the day at a glance.
import { html, icon, mount, pageHead, money, LABELS, ACTIVE_STATUSES, firstName, emptyState, remember } from '../lib.js';
import { threadRow, taskRow, activityRow, taskModal, projectModal, sortTasks } from './parts.js';

const stat = (label, value, href, iconName, alert = false) => html`
  <a class="stat ${alert ? 'is-alert' : ''}" href="${href}">
    <span class="stat__icon">${icon(iconName)}</span>
    <span class="stat__value">${value}</span>
    <span class="stat__label">${label}</span>
  </a>`;

export async function render(ctx) {
  const { el, db, store, me, isAdmin } = ctx;
  ctx.title = 'Dashboard';
  await store.load();
  const [threads, myTasks, activity, finances, payments] = await Promise.all([
    db.threads.list(),
    db.tasks.list({ assigneeId: me.id }),
    db.activity.list({ limit: 8 }),
    isAdmin ? db.money.allFinances() : [],
    isAdmin ? db.money.payments() : [],
  ]);
  if (!ctx.isCurrent()) return;

  const active = store.projects.filter((p) => ACTIVE_STATUSES.includes(p.status));
  const waiting = threads.filter((t) => t.unread_by_team);
  const open = threads.filter((t) => t.status !== 'resolved');
  const attention = [...waiting, ...open.filter((t) => !t.unread_by_team)].slice(0, 6);
  const openTasks = myTasks.filter((t) => t.status !== 'done').sort(sortTasks);
  const paidBy = payments.reduce((acc, p) => ({ ...acc, [p.project_id]: (acc[p.project_id] || 0) + Number(p.amount) }), {});
  const due = finances.reduce((sum, f) => sum + Math.max(Number(f.quoted_amount) - (paidBy[f.project_id] || 0), 0), 0);
  const stages = Object.entries(LABELS.status).map(([key, label]) => [key, label, store.projects.filter((p) => p.status === key).length]);
  const most = Math.max(1, ...stages.map((s) => s[2]));
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  mount(el, html`
    ${pageHead(`${hello}, ${firstName(me.full_name)}`, "Here's where everything stands across Zenatiq today.",
      html`<button class="btn btn--ghost" type="button" data-act="new-task">${icon('a-tasks')}New task</button>
           <button class="btn btn--primary" type="button" data-act="new-project">${icon('a-plus')}New project</button>`)}
    <section class="stats">
      ${stat('Active projects', active.length, '#/projects', 'a-folder')}
      ${stat('Waiting for your reply', waiting.length, '#/inbox', 'a-inbox', waiting.length > 0)}
      ${stat('Open conversations', open.length, '#/inbox', 'i-chat')}
      ${stat('Your open tasks', openTasks.length, '#/tasks', 'a-tasks')}
      ${isAdmin ? stat('Balance due', money(due), '#/payments', 'a-wallet') : ''}
    </section>
    <div class="grid-2">
      <section class="card">
        <header class="card__head"><h2>Needs attention</h2><a class="link-sm" href="#/inbox">Open inbox</a></header>
        ${attention.length ? html`<div class="tlist">${attention.map((t) => threadRow(t, store))}</div>`
          : emptyState('All caught up', 'No client is waiting for a reply.')}
      </section>
      <section class="card">
        <header class="card__head"><h2>Your tasks</h2><a class="link-sm" href="#/tasks">All tasks</a></header>
        ${openTasks.length ? html`<div class="rlist">${openTasks.slice(0, 7).map((t) => taskRow(t, store))}</div>`
          : emptyState('Nothing assigned to you', 'Tasks assigned to you will show up here.')}
      </section>
      <section class="card">
        <header class="card__head"><h2>Projects by stage</h2><a class="link-sm" href="#/projects">All projects</a></header>
        <ul class="stages">${stages.filter((s) => s[2] > 0).map(([key, label, n]) => html`
          <li><a href="#/projects" data-act="stage" data-status="${key}">
            <span class="stages__label">${label}</span>
            <span class="stages__bar"><i class="is-${key}" style="width:${Math.round((n / most) * 100)}%"></i></span>
            <b>${n}</b></a></li>`)}</ul>
        ${store.projects.length ? '' : emptyState('No projects yet', 'Add your first project to get started.')}
      </section>
      <section class="card">
        <header class="card__head"><h2>Recent activity</h2><a class="link-sm" href="#/activity">See all</a></header>
        ${activity.length ? html`<ul class="acts">${activity.map((a) => activityRow(a, store))}</ul>` : emptyState('No activity yet')}
      </section>
    </div>`, {
    'new-project': async () => { const p = await projectModal(ctx); if (p?.id) ctx.go(`#/projects/${p.id}`); },
    'new-task': async () => { if (await taskModal(ctx)) render(ctx); },
    'open-task': async (btn) => {
      const task = myTasks.find((t) => t.id === btn.dataset.id);
      if (task && (await taskModal(ctx, { task }))) render(ctx);
    },
    'toggle-task': async (btn) => {
      const task = myTasks.find((t) => t.id === btn.dataset.id);
      await db.tasks.update(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
      render(ctx);
    },
    stage: (link, e) => { e.preventDefault(); remember('zq-projects-status', link.dataset.status); ctx.go('#/projects'); },
  });
}

export function onLive(ctx, table) {
  if (['threads', 'messages', 'tasks'].includes(table)) {
    clearTimeout(ctx.liveTimer);
    ctx.liveTimer = setTimeout(() => ctx.isCurrent() && render(ctx), 400);
  }
}
