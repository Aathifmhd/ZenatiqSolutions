// Clients: who you work for, their contact details and their projects.
import { html, icon, mount, pageHead, emptyState } from '../lib.js';
import { clientModal } from './parts.js';

export async function render(ctx) {
  const { el, store } = ctx;
  ctx.title = 'Clients';
  await store.load();
  if (!ctx.isCurrent()) return;
  let q = '';

  const draw = () => {
    const term = q.toLowerCase();
    const list = store.clients.filter((c) => !term || `${c.name} ${c.contact_name || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase().includes(term));
    el.querySelector('[data-list]').innerHTML = String(list.length ? html`
      <div class="table-wrap card"><table class="table table--hover">
        <thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Email</th><th>Projects</th></tr></thead>
        <tbody>${list.map((c) => {
          const projects = store.projects.filter((p) => p.client_id === c.id);
          return html`<tr data-act="edit" data-id="${c.id}" tabindex="0">
            <td><b>${c.name}</b>${c.notes ? html`<small class="block muted clip">${c.notes}</small>` : ''}</td>
            <td>${c.contact_name || html`<span class="muted">—</span>`}</td>
            <td>${c.phone ? html`<a href="tel:${c.phone.replace(/\s/g, '')}" data-stop>${c.phone}</a>` : html`<span class="muted">—</span>`}</td>
            <td>${c.email ? html`<a href="mailto:${c.email}" data-stop>${c.email}</a>` : html`<span class="muted">—</span>`}</td>
            <td><span class="chips">${projects.map((p) => html`<a class="chip-link" href="#/projects/${p.id}" data-stop>${p.name}</a>`)}${projects.length ? '' : html`<span class="muted">None yet</span>`}</span></td>
          </tr>`;
        })}</tbody>
      </table></div>` : emptyState(store.clients.length ? 'No clients match' : 'No clients yet',
        store.clients.length ? 'Try a different search.' : 'Add the businesses you work for, with their contact details.',
        store.clients.length ? '' : html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}Add a client</button>`));
  };

  mount(el, html`
    ${pageHead('Clients', 'The businesses you work for, with their contact details and projects.',
      html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}Add a client</button>`)}
    <div class="filters">
      <label class="search">${icon('search')}<span class="sr-only">Search clients</span>
        <input class="input" type="search" placeholder="Search by name, phone or email" data-input="search"></label>
      <span class="filters__count">${store.clients.length} client${store.clients.length === 1 ? '' : 's'}</span>
    </div>
    <div data-list></div>`, {
    new: async () => { if (await clientModal(ctx)) draw(); },
    edit: async (row, e) => {
      if (e.target.closest('[data-stop]')) return;
      const client = store.client(row.dataset.id);
      if (await clientModal(ctx, client)) draw();
    },
    search: (input) => { q = input.value; draw(); },
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click();
  });
  draw();
}
