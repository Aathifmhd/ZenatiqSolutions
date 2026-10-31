// Projects: every project with its links, stage, team and open work.
import {
  html, icon, mount, pageHead, pill, avatar, options, LABELS, TYPE_ICON, ACTIVE_STATUSES, fmtShort, isOverdue,
  safeUrl, prettyUrl, emptyState, remember, recall,
} from '../lib.js';
import { projectModal } from './parts.js';

export async function render(ctx) {
  const { el, db, store } = ctx;
  ctx.title = 'Projects';
  await store.load();
  const [assignments, tasks, threads] = await Promise.all([db.projects.allMembers(), db.tasks.list(), db.threads.list()]);
  if (!ctx.isCurrent()) return;

  const filters = {
    q: recall('zq-projects-q') || '',
    status: recall('zq-projects-status') || 'active',
    type: recall('zq-projects-type') || '',
  };
  const STATUS_FILTER = { active: 'Active work', all: 'All stages', ...LABELS.status };

  const card = (p) => {
    const client = store.client(p.client_id);
    const team = assignments.filter((a) => a.project_id === p.id).map((a) => store.member(a.member_id)).filter(Boolean);
    const open = tasks.filter((t) => t.project_id === p.id && t.status !== 'done').length;
    const unread = threads.filter((t) => t.project_id === p.id && t.unread_by_team).length;
    const live = safeUrl(p.live_url);
    return html`
      <article class="pcard">
        <a class="pcard__link" href="#/projects/${p.id}" aria-label="Open ${p.name}"></a>
        <div class="pcard__top">
          <span class="pcard__icon">${icon(TYPE_ICON[p.type] || 'a-folder')}</span>
          ${pill('status', p.status)}
        </div>
        <h3>${p.name}</h3>
        <p class="pcard__client">${client?.name || 'No client yet'} · ${LABELS.type[p.type]}</p>
        ${live ? html`<a class="pcard__url" href="${live}" target="_blank" rel="noopener" title="${prettyUrl(p.live_url)}">${icon('external')}<span>${prettyUrl(p.live_url)}</span></a>` : html`<span class="pcard__url pcard__url--none">No live link yet</span>`}
        <div class="pcard__foot">
          <span class="avs">${team.slice(0, 4).map((m) => avatar(m, 'av--sm'))}${team.length ? '' : html`<span class="muted">No team yet</span>`}</span>
          <span class="pcard__counts">
            <span title="Open tasks">${icon('a-tasks')}${open}</span>
            <span class="${unread ? 'is-alert' : ''}" title="Unread client messages">${icon('a-inbox')}${unread}</span>
            ${p.due_date ? html`<span class="${isOverdue(p.due_date, ['live', 'completed', 'maintenance'].includes(p.status)) ? 'is-late' : ''}" title="Due date">${icon('clock')}${fmtShort(p.due_date)}</span>` : ''}
          </span>
        </div>
      </article>`;
  };

  const draw = () => {
    const q = filters.q.toLowerCase();
    const list = store.projects.filter((p) => {
      if (filters.status === 'active' && !ACTIVE_STATUSES.includes(p.status)) return false;
      if (!['active', 'all'].includes(filters.status) && p.status !== filters.status) return false;
      if (filters.type && p.type !== filters.type) return false;
      if (q && !`${p.name} ${store.client(p.client_id)?.name || ''} ${p.live_url || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    el.querySelector('[data-results]').innerHTML = String(list.length
      ? html`<div class="pgrid">${list.map(card)}</div>`
      : emptyState(store.projects.length ? 'No projects match' : 'No projects yet',
          store.projects.length ? 'Try a different stage, type or search.' : 'Add your first project with its website link.',
          store.projects.length ? '' : html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}New project</button>`));
    el.querySelector('[data-count]').textContent = `${list.length} of ${store.projects.length}`;
  };

  mount(el, html`
    ${pageHead('Projects', 'Every website, shop, POS and app you look after.',
      html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}New project</button>`)}
    <div class="filters">
      <label class="search">${icon('search')}<span class="sr-only">Search projects</span>
        <input class="input" type="search" placeholder="Search projects or clients" value="${filters.q}" data-input="q"></label>
      <label class="sr-only" for="pf-status">Stage</label>
      <select class="input" id="pf-status" data-change="status">${options(STATUS_FILTER, filters.status)}</select>
      <label class="sr-only" for="pf-type">Type</label>
      <select class="input" id="pf-type" data-change="type">${options(LABELS.type, filters.type, { blank: 'All types' })}</select>
      <span class="filters__count" data-count></span>
    </div>
    <div data-results></div>`, {
    new: async () => { const p = await projectModal(ctx); if (p?.id) ctx.go(`#/projects/${p.id}`); },
    q: (input) => { filters.q = input.value; remember('zq-projects-q', input.value); draw(); },
    status: (select) => { filters.status = select.value; remember('zq-projects-status', select.value); draw(); },
    type: (select) => { filters.type = select.value; remember('zq-projects-type', select.value); draw(); },
  });
  draw();

  if (ctx.params[0] === 'new') {
    history.replaceState(null, '', '#/projects');
    const p = await projectModal(ctx);
    if (p?.id) ctx.go(`#/projects/${p.id}`);
  }
}
