// Tasks: what you (or everyone) needs to do, across every project.
import { html, icon, mount, pageHead, options, LABELS, emptyState, remember, recall, toast, friendly } from '../lib.js';
import { taskRow, taskModal, sortTasks } from './parts.js';

const WHO = { me: 'Assigned to me', all: 'Everyone', unassigned: 'Not assigned' };
const SHOW = { open: 'Not done', done: 'Done', all: 'All' };

export async function render(ctx) {
  const { el, db, store, me } = ctx;
  ctx.title = 'Tasks';
  await store.load();
  let tasks = await db.tasks.list();
  if (!ctx.isCurrent()) return;

  const state = {
    who: WHO[recall('zq-tasks-who')] ? recall('zq-tasks-who') : 'me',
    show: SHOW[recall('zq-tasks-show')] ? recall('zq-tasks-show') : 'open',
    project: recall('zq-tasks-project') || '',
  };

  const draw = () => {
    const visible = tasks.filter((t) =>
      (state.who === 'all' || (state.who === 'me' ? t.assignee_id === me.id : !t.assignee_id)) &&
      (state.show === 'all' || (state.show === 'done' ? t.status === 'done' : t.status !== 'done')) &&
      (!state.project || t.project_id === state.project));
    const groups = Object.entries(LABELS.task)
      .map(([status, label]) => [label, visible.filter((t) => t.status === status).sort(sortTasks)])
      .filter(([, list]) => list.length);
    el.querySelector('[data-list]').innerHTML = String(groups.length
      ? groups.map(([label, list]) => html`
          <section class="card tgroup"><header class="card__head"><h2>${label}</h2><span class="col__count">${list.length}</span></header>
            <div class="rlist">${list.map((t) => taskRow(t, store))}</div></section>`).join('')
      : emptyState(state.who === 'me' && state.show === 'open' ? 'Nothing on your list' : 'No tasks match',
          state.who === 'me' && state.show === 'open' ? 'Tasks assigned to you will appear here.' : 'Try different filters.'));
  };

  mount(el, html`
    ${pageHead('Tasks', 'Everything that needs doing, across every project.',
      html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}New task</button>`)}
    <div class="filters">
      <label class="sr-only" for="tf-who">Whose tasks</label>
      <select class="input" id="tf-who" data-change="who">${options(WHO, state.who)}</select>
      <label class="sr-only" for="tf-show">Status</label>
      <select class="input" id="tf-show" data-change="show">${options(SHOW, state.show)}</select>
      <label class="sr-only" for="tf-project">Project</label>
      <select class="input" id="tf-project" data-change="project"><option value="">All projects</option>
        ${store.projects.map((p) => html`<option value="${p.id}"${p.id === state.project ? ' selected' : ''}>${p.name}</option>`)}</select>
    </div>
    <div data-list></div>`, {
    new: async () => { if (await taskModal(ctx)) reload(); },
    who: (s) => { state.who = s.value; remember('zq-tasks-who', s.value); draw(); },
    show: (s) => { state.show = s.value; remember('zq-tasks-show', s.value); draw(); },
    project: (s) => { state.project = s.value; remember('zq-tasks-project', s.value); draw(); },
    'open-task': async (btn) => {
      const task = tasks.find((t) => t.id === btn.dataset.id);
      if (task && (await taskModal(ctx, { task }))) reload();
    },
    'toggle-task': async (btn) => {
      const task = tasks.find((t) => t.id === btn.dataset.id);
      try {
        await db.tasks.update(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
        toast(task.status === 'done' ? 'Moved back to To do' : 'Nice, that\'s done');
        reload();
      } catch (err) { toast(friendly(err), 'error'); }
    },
  });
  const reload = async () => { tasks = await db.tasks.list(); if (ctx.isCurrent()) draw(); };
  draw();
  ctx.reloadTasks = reload;
}

export function onLive(ctx, table) {
  if (table === 'tasks' && ctx.reloadTasks) {
    clearTimeout(ctx.liveTimer);
    ctx.liveTimer = setTimeout(() => ctx.isCurrent() && ctx.reloadTasks(), 400);
  }
}
