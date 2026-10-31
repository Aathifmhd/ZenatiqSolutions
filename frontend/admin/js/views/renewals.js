// Renewals: every yearly subscription, with the ones to chase first (owners and admins only).
import { html, icon, mount, pageHead, pill, money, fmtDate, ago, emptyState, toast, friendly, remember, recall } from '../lib.js';
import { renewModal, paidUntilSays } from './parts.js';

const ORDER = { expired: 0, grace: 1, ending: 2, active: 3, cancelled: 4 };
const DUE = ['ending', 'grace', 'expired'];
const sum = (rows) => rows.reduce((total, r) => total + Number(r.s.price), 0);

export async function render(ctx) {
  const { el, db, store } = ctx;
  ctx.title = 'Renewals';
  await store.load();
  const { subscriptions, remindersRanAt } = await db.subscriptions.list();
  if (!ctx.isCurrent()) return;

  const rows = subscriptions.map((s) => ({ s, p: store.project(s.project_id) })).filter((r) => r.p)
    .sort((a, b) => ORDER[a.s.status] - ORDER[b.s.status] || a.s.ends_on.localeCompare(b.s.ends_on));
  const by = (status) => rows.filter((r) => r.s.status === status);
  const live = rows.filter((r) => r.s.status !== 'cancelled');
  let showAll = recall('zq-renewals') === 'all';

  const draw = () => {
    const list = showAll ? rows : rows.filter((r) => DUE.includes(r.s.status));
    el.querySelector('[data-list]').innerHTML = String(list.length ? html`
      <div class="table-wrap"><table class="table table--hover renewals">
        <thead><tr><th>Project</th><th>Package</th><th class="num">Yearly price</th><th>Paid until</th><th>Status</th><th>Last reminder</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map(({ s, p }) => html`<tr data-act="open" data-id="${p.id}" tabindex="0">
          <td><b>${p.name}</b><small class="block muted">${store.client(p.client_id)?.name || 'No client'}</small></td>
          <td>${s.package}</td>
          <td class="num">${money(s.price, s.currency)}</td>
          <td>${fmtDate(s.ends_on)}<small class="block ${['grace', 'expired'].includes(s.status) ? 'is-due' : 'muted'}">${paidUntilSays(s)}</small></td>
          <td>${pill('sub', s.status)}</td>
          <td>${s.last_reminded_at ? html`<span title="${fmtDate(s.last_reminded_at)}">${ago(s.last_reminded_at)}</span>` : html`<span class="muted">None yet</span>`}</td>
          <td class="right">${s.status === 'cancelled' ? '' : html`<button class="btn btn--primary btn--sm" type="button" data-act="renew" data-id="${p.id}">${icon('a-renew')}Record renewal</button>`}</td>
        </tr>`)}</tbody>
      </table></div>` : emptyState(rows.length ? 'Nothing to renew right now' : 'No yearly subscriptions yet',
        rows.length ? 'Every subscription is paid for more than 30 days ahead.'
          : "Open a project's Payments tab and choose \"Set up a yearly subscription\"."));
    el.querySelectorAll('[data-show]').forEach((b) => b.classList.toggle('is-on', (b.dataset.show === 'all') === showAll));
  };

  mount(el, html`
    ${pageHead('Renewals', 'Yearly subscriptions and when each one is due. Only owners and admins see this page.')}
    <section class="stats stats--4">
      <div class="stat ${by('ending').length ? 'is-alert' : ''}"><span class="stat__icon">${icon('a-renew')}</span><span class="stat__value">${by('ending').length}</span>
        <span class="stat__label">Due in the next 30 days${by('ending').length ? ` · ${money(sum(by('ending')))}` : ''}</span></div>
      <div class="stat ${by('grace').length ? 'is-alert' : ''}"><span class="stat__icon">${icon('clock')}</span><span class="stat__value">${by('grace').length}</span><span class="stat__label">In the grace period</span></div>
      <div class="stat"><span class="stat__icon">${icon('a-wallet')}</span><span class="stat__value">${by('expired').length}</span><span class="stat__label">Expired</span></div>
      <div class="stat"><span class="stat__icon">${icon('check')}</span><span class="stat__value">${money(sum(live))}</span><span class="stat__label">A year from ${live.length} subscription${live.length === 1 ? '' : 's'}</span></div>
    </section>
    <section class="card">
      <header class="card__head"><h2>Subscriptions</h2>
        <div class="seg"><button type="button" data-act="show" data-show="due">Needs renewing</button><button type="button" data-act="show" data-show="all">All (${rows.length})</button></div>
      </header>
      <div data-list></div>
      <footer class="renewals__job">
        <p class="small muted">${icon('a-send')}<span>${remindersRanAt
          ? html`Reminder emails last went out automatically ${ago(remindersRanAt)}. They go 30, 14, 7 and 1 days before a subscription is due, and when it ends.`
          : html`Automatic reminder emails haven't run yet. They start once <code>CRON_SECRET</code> is set in Vercel (see ADMIN-SETUP.md).`}</span></p>
        <button class="btn btn--ghost btn--sm" type="button" data-act="run">Send today's reminders now</button>
      </footer>
    </section>`, {
    open: (row) => ctx.go(`#/projects/${row.dataset.id}/payments`),
    show: (btn) => { showAll = btn.dataset.show === 'all'; remember('zq-renewals', showAll ? 'all' : 'due'); draw(); },
    renew: async (btn) => {
      const { s, p } = rows.find((r) => r.p.id === btn.dataset.id);
      if (await renewModal(ctx, p, s)) render(ctx);
    },
    run: async (btn) => {
      btn.disabled = true;
      try {
        const { sent, failed } = await db.subscriptions.runReminders();
        if (failed.length) toast(`Couldn't email ${failed.map((f) => `${f.project} (${f.problem})`).join(', ')}`, 'error');
        toast(sent.length ? `Sent ${sent.length} reminder${sent.length === 1 ? '' : 's'}: ${sent.map((x) => x.project).join(', ')}` : 'No reminders were due today.');
        render(ctx);
      } catch (err) {
        toast(friendly(err), 'error');
        btn.disabled = false;
      }
    },
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click(); });
  draw();
}
