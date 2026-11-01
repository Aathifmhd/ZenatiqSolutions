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
  const [{ subscriptions, remindersRanAt, setup }, settings] = await Promise.all([db.subscriptions.list(), db.subscriptions.settings()]);
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
          : setup.reminders
            ? html`Automatic reminder emails haven't run yet. <code>CRON_SECRET</code> is set, so they start with Vercel's next daily run, at about 8:00. To run it now, choose <b>Run</b> in Vercel under Settings → Cron Jobs.`
            : html`Automatic reminder emails are off: this deployment doesn't have <code>CRON_SECRET</code>. Add it in Vercel, then redeploy (see ADMIN-SETUP.md).`}</span></p>
        <button class="btn btn--ghost btn--sm" type="button" data-act="run">Send today's reminders now</button>
      </footer>
    </section>
    <section class="card renewpage">
      <header class="card__head"><h2>Renewal page</h2>
        ${rows[0]?.s.renew_url ? html`<a class="link-sm" href="${rows[0].s.renew_url.replace(/^https:\/\/www\.zenatiqsolutions\.com/, location.origin)}" target="_blank" rel="noopener">Preview a client's page ${icon('external')}</a>` : ''}</header>
      <p class="small muted">Each client renews on their own page, linked from their reminder emails and their Contact with Zenatiq widget. They choose how many years, then pay online or by bank transfer.</p>
      <ul class="renewpage__setup">
        <li class="${setup.online ? 'is-on' : ''}">${icon(setup.online ? 'check' : 'clock')}<span>${setup.online
          ? html`Online payments are on${setup.sandbox ? html` in <b>PayHere test mode</b>: no real money is taken` : ''}. Paid renewals go through by themselves.`
          : html`Online payments are off. They start once <code>PAYHERE_MERCHANT_ID</code> and <code>PAYHERE_MERCHANT_SECRET</code> are set in Vercel.`}</span></li>
        <li class="${setup.licenses ? 'is-on' : ''}">${icon(setup.licenses ? 'check' : 'clock')}<span>${setup.licenses
          ? 'Licences are on: client systems can check whether their subscription is paid.'
          : html`Licences are off. They start once <code>LICENSE_PRIVATE_KEY</code> is set in Vercel.`}</span></li>
      </ul>
      <form class="renewpage__bank" data-submit="bank">
        <label class="field"><span>Bank transfer details</span>
          <textarea class="input" name="bank_details" rows="5" maxlength="2000" placeholder="Bank: …&#10;Branch: …&#10;Account name: Zenatiq Solutions&#10;Account number: …">${settings.bank_details || ''}</textarea>
          <small class="field__hint">Shown to clients on their renewal page, exactly as typed here.</small></label>
        <button class="btn btn--primary btn--sm" type="submit">Save bank details</button>
      </form>
    </section>`, {
    bank: async (form) => {
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await db.subscriptions.saveSettings(new FormData(form).get('bank_details'));
        toast('Bank details saved');
      } catch (err) {
        toast(friendly(err), 'error');
      }
      button.disabled = false;
    },
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
