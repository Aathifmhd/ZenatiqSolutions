// Contact with Zenatiq inbox: every client conversation across all projects.
import { html, icon, mount, pageHead, emptyState, remember, recall } from '../lib.js';
import { threadRow, renderConversation } from './parts.js';

const FILTERS = {
  waiting: ['Needs a reply', (t) => t.unread_by_team],
  active: ['Not resolved', (t) => t.status !== 'resolved'],
  resolved: ['Resolved', (t) => t.status === 'resolved'],
  all: ['All', () => true],
};

export async function render(ctx) {
  const { el, db, store } = ctx;
  ctx.title = 'Contact with Zenatiq';
  const selected = ctx.params[0] || null;
  await store.load();
  let threads = await db.threads.list();
  if (!ctx.isCurrent()) return;

  const state = { filter: recall('zq-inbox-filter') || 'active', project: recall('zq-inbox-project') || '' };
  if (!FILTERS[state.filter]) state.filter = 'active';
  const inProject = (t) => !state.project || t.project_id === state.project;

  const drawList = () => {
    const visible = threads.filter((t) => inProject(t) && FILTERS[state.filter][1](t));
    el.querySelector('[data-seg]').innerHTML = String(html`${Object.entries(FILTERS).map(([key, [label, test]]) => html`
      <button type="button" class="${key === state.filter ? 'is-on' : ''}" aria-pressed="${key === state.filter}" data-act="filter" data-key="${key}">
        ${label}<span>${threads.filter((t) => inProject(t) && test(t)).length}</span></button>`)}`);
    el.querySelector('[data-list]').innerHTML = String(visible.length
      ? html`<div class="tlist">${visible.map((t) => threadRow(t, store, { active: t.id === selected }))}</div>`
      : emptyState(threads.length ? 'Nothing here' : 'No client messages yet',
          threads.length ? 'Try another filter.' : 'Add the Contact with Zenatiq widget to a client\'s admin panel from the project\'s Widget tab.'));
  };

  mount(el, html`
    ${pageHead('Contact with Zenatiq', 'Bug reports, update requests and questions sent from your clients\' websites.')}
    <div class="inbox inbox--page ${selected ? 'has-open' : ''}">
      <section class="inbox__list">
        <div class="inbox__filters">
          <div class="seg" data-seg></div>
          <label class="sr-only" for="inbox-project">Project</label>
          <select class="input input--sm" id="inbox-project" data-change="project">
            <option value="">All projects</option>
            ${store.projects.map((p) => html`<option value="${p.id}"${p.id === state.project ? ' selected' : ''}>${p.name}</option>`)}
          </select>
        </div>
        <div data-list></div>
      </section>
      <section class="inbox__convo" data-convo>
        ${selected ? '' : html`<div class="empty empty--sm">${icon('i-chat')}<h3>Pick a conversation</h3>
          <p>Replies you send here appear in the client's Contact with Zenatiq panel on their website.</p></div>`}
      </section>
    </div>`, {
    filter: (btn) => { state.filter = btn.dataset.key; remember('zq-inbox-filter', state.filter); drawList(); },
    project: (select) => { state.project = select.value; remember('zq-inbox-project', state.project); drawList(); },
  });
  drawList();

  const refreshList = async () => { threads = await db.threads.list(); if (ctx.isCurrent()) drawList(); };
  const options = { backHref: '#/inbox', onChange: refreshList };
  if (selected) await renderConversation(ctx, el.querySelector('[data-convo]'), selected, options);

  ctx.refreshInbox = async () => {
    await refreshList();
    if (selected && ctx.isCurrent()) await renderConversation(ctx, el.querySelector('[data-convo]'), selected, options);
  };
}

export function onLive(ctx, table) {
  if ((table === 'threads' || table === 'messages') && ctx.refreshInbox) {
    clearTimeout(ctx.liveTimer);
    ctx.liveTimer = setTimeout(() => ctx.isCurrent() && ctx.refreshInbox(), 400);
  }
}
