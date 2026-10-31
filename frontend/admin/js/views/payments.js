// Payments: quotes, payments received and balances for every project (owners and admins only).
import { html, icon, mount, pageHead, money, fmtDate, LABELS, emptyState, remember, recall } from '../lib.js';
import { paymentModal } from './parts.js';

export async function render(ctx) {
  const { el, db, store } = ctx;
  ctx.title = 'Payments';
  await store.load();
  const [finances, payments] = await Promise.all([db.money.allFinances(), db.money.payments()]);
  if (!ctx.isCurrent()) return;

  const paidBy = {};
  const lastBy = {};
  for (const p of payments) {
    paidBy[p.project_id] = (paidBy[p.project_id] || 0) + Number(p.amount);
    if (!lastBy[p.project_id] || p.paid_on > lastBy[p.project_id]) lastBy[p.project_id] = p.paid_on;
  }
  const rows = store.projects.map((p) => {
    const f = finances.find((x) => x.project_id === p.id);
    const quote = Number(f?.quoted_amount || 0);
    const paid = paidBy[p.id] || 0;
    return { p, f, quote, paid, due: Math.max(quote - paid, 0), last: lastBy[p.id], currency: f?.currency || 'LKR' };
  }).filter((r) => r.f || r.paid);
  const month = new Date().toISOString().slice(0, 7);
  const totals = {
    quoted: rows.reduce((s, r) => s + r.quote, 0),
    received: rows.reduce((s, r) => s + r.paid, 0),
    due: rows.reduce((s, r) => s + r.due, 0),
    month: payments.filter((p) => p.paid_on.startsWith(month)).reduce((s, p) => s + Number(p.amount), 0),
  };
  let onlyDue = recall('zq-pay-due') === '1';

  const draw = () => {
    const list = rows.filter((r) => !onlyDue || r.due > 0).sort((a, b) => b.due - a.due);
    el.querySelector('[data-list]').innerHTML = String(list.length ? html`
      <div class="table-wrap"><table class="table table--hover">
        <thead><tr><th>Project</th><th class="num">Quoted</th><th class="num">Paid</th><th class="num">Balance due</th><th>Last payment</th></tr></thead>
        <tbody>${list.map((r) => html`<tr data-act="open" data-id="${r.p.id}" tabindex="0">
          <td><b>${r.p.name}</b><small class="block muted">${store.client(r.p.client_id)?.name || ''}</small></td>
          <td class="num">${r.f ? money(r.quote, r.currency) : html`<span class="muted">No quote</span>`}</td>
          <td class="num">${money(r.paid, r.currency)}</td>
          <td class="num"><b class="${r.due > 0 ? 'is-due' : 'is-clear'}">${r.due > 0 ? money(r.due, r.currency) : 'Paid up'}</b></td>
          <td>${r.last ? fmtDate(r.last) : html`<span class="muted">—</span>`}</td></tr>`)}</tbody>
      </table></div>` : emptyState(rows.length ? 'Everything is paid up' : 'No quotes yet',
        rows.length ? '' : 'Add a quote on a project\'s Payments tab to start tracking.'));
  };

  mount(el, html`
    ${pageHead('Payments', 'Quotes, money received and what\'s still owed. Only owners and admins see this page.',
      html`<button class="btn btn--primary" type="button" data-act="pay">${icon('a-plus')}Record a payment</button>`)}
    <section class="stats stats--4">
      <div class="stat"><span class="stat__icon">${icon('a-folder')}</span><span class="stat__value">${money(totals.quoted)}</span><span class="stat__label">Quoted in total</span></div>
      <div class="stat"><span class="stat__icon">${icon('check')}</span><span class="stat__value">${money(totals.received)}</span><span class="stat__label">Received</span></div>
      <div class="stat ${totals.due ? 'is-alert' : ''}"><span class="stat__icon">${icon('a-wallet')}</span><span class="stat__value">${money(totals.due)}</span><span class="stat__label">Still owed</span></div>
      <div class="stat"><span class="stat__icon">${icon('clock')}</span><span class="stat__value">${money(totals.month)}</span><span class="stat__label">Received this month</span></div>
    </section>
    <div class="grid-2 grid-2--wide">
      <section class="card">
        <header class="card__head"><h2>By project</h2><label class="switch"><input type="checkbox" data-change="due" ${onlyDue ? 'checked' : ''}><span>Only with a balance</span></label></header>
        <div data-list></div>
      </section>
      <section class="card">
        <header class="card__head"><h2>Latest payments</h2></header>
        ${payments.length ? html`<ul class="plist">${payments.slice(0, 10).map((p) => html`<li>
          <div><b>${money(p.amount, finances.find((f) => f.project_id === p.project_id)?.currency || 'LKR')}</b>
            <small>${store.project(p.project_id)?.name || ''} · ${LABELS.method[p.method]}</small></div>
          <time>${fmtDate(p.paid_on)}</time></li>`)}</ul>` : emptyState('No payments yet')}
      </section>
    </div>`, {
    open: (row) => ctx.go(`#/projects/${row.dataset.id}/payments`),
    due: (box) => { onlyDue = box.checked; remember('zq-pay-due', box.checked ? '1' : '0'); draw(); },
    pay: async () => { if (await paymentModal(ctx)) render(ctx); },
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click(); });
  draw();
}
