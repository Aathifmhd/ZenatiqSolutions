// Activity: the full history of who did what, and when.
import { html, mount, pageHead, options, emptyState } from '../lib.js';
import { activityRow } from './parts.js';

const KINDS = { message: 'Client messages', thread: 'Conversations', task: 'Tasks', project: 'Projects', team: 'Team', client: 'Clients' };
const PAGE = 100;

export async function render(ctx) {
  const { el, db, store, isAdmin } = ctx;
  ctx.title = 'Activity';
  await store.load();
  const kinds = isAdmin ? { ...KINDS, payment: 'Payments', finance: 'Quotes' } : KINDS;
  const state = { project: '', kind: '' };
  let items = [];
  let more = false;

  const load = async (append = false) => {
    const batch = await db.activity.list({ projectId: state.project || undefined, limit: PAGE, before: append ? items.at(-1)?.id : undefined });
    items = append ? items.concat(batch) : batch;
    more = batch.length === PAGE;
  };
  const draw = () => {
    const visible = items.filter((a) => !state.kind || a.action.startsWith(`${state.kind}.`));
    el.querySelector('[data-list]').innerHTML = String(html`
      ${visible.length ? html`<ul class="acts">${visible.map((a) => activityRow(a, store))}</ul>` : emptyState('Nothing to show', 'Try a different filter.')}
      ${more ? html`<button class="btn btn--ghost btn--sm load-more" type="button" data-act="more">Show older</button>` : ''}`);
  };

  await load();
  if (!ctx.isCurrent()) return;
  mount(el, html`
    ${pageHead('Activity', 'Everything that has happened in the portal, newest first. It can\'t be edited or deleted.')}
    <div class="filters">
      <label class="sr-only" for="af-project">Project</label>
      <select class="input" id="af-project" data-change="project"><option value="">All projects</option>
        ${store.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
      <label class="sr-only" for="af-kind">Type</label>
      <select class="input" id="af-kind" data-change="kind">${options(kinds, '', { blank: 'Everything' })}</select>
    </div>
    <section class="card" data-list></section>`, {
    project: async (s) => { state.project = s.value; await load(); draw(); },
    kind: (s) => { state.kind = s.value; draw(); },
    more: async () => { await load(true); draw(); },
  });
  draw();
}

export function onLive(ctx, table) {
  if (table === 'activity') {
    clearTimeout(ctx.liveTimer);
    ctx.liveTimer = setTimeout(() => ctx.isCurrent() && render(ctx), 800);
  }
}
