// ZenPOS Key Maker (owners and admins): licences for ZenPOS, one shop computer each. Make a licence
// and send its key, record payments, move a licence to another computer, make offline codes, cancel,
// and check bank slips and requests from the Buy ZenPOS page. The rules are in backend/core/zenpos.js.
import {
  html, icon, mount, pageHead, money, fmtDate, ago, emptyState, toast, friendly, modal, confirmDialog, copyText,
  remember, recall, val, num, today, options, LABELS,
} from '../lib.js';

const STATE = { active: 'Active', ending: 'Ending soon', grace: 'Renewal due', expired: 'Read-only', cancelled: 'Cancelled' };
const ORDER = { expired: 0, grace: 1, ending: 2, active: 3, cancelled: 4 };
const FILTERS = { all: 'All', ending: 'Ending in 30 days', grace: 'Renewal due', expired: 'Read-only', active: 'Active', cancelled: 'Cancelled' };
const statePill = (state) => html`<span class="pill is-${state}">${STATE[state] || state}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const daysSays = (l) => (l.days_left > 0 ? `${plural(l.days_left, 'day')} left` : l.days_left === 0 ? 'Ends today' : `Ended ${plural(-l.days_left, 'day')} ago`);
const flat = (s) => String(s || '').toLowerCase().replace(/[\s-]/g, '');

// The renewal rule (as in core/zenpos.js), to show where "paid until" will go before saving.
const plusYear = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y + 1, m - 1, Math.min(d, new Date(Date.UTC(y + 1, m, 0)).getUTCDate()))).toISOString().slice(0, 10);
};
const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const renewsTo = (l, day) => (day <= l.paid_until ? plusYear(l.paid_until) : dayBefore(plusYear(day)));

// WhatsApp, for Sri Lankan numbers: 077 123 4567 → 94771234567.
const waNumber = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('94') ? d : d.startsWith('0') ? `94${d.slice(1)}` : d.length === 9 ? `94${d}` : d;
};
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const hello = (l) => `Hi ${l.owner || l.shop},`;
const keyMessage = (l, key) => [
  hello(l), '', `Here's your ZenPOS licence key for ${l.shop}:`, '', key, '',
  'To activate it (internet needed once):', '1. Open ZenPOS → Subscription', '2. Paste the key and press Activate', '',
  `It's paid until ${fmtDate(l.paid_until)}. Questions? Just reply here.`, '— Zenatiq Solutions',
].join('\n');
const codeMessage = (l, device, code) => [
  hello(l), '', `Here's the offline licence code for ZenPOS on ${device} (${l.shop}):`, '', code, '',
  'In ZenPOS → Subscription → Activate, paste this code instead of the key. No internet needed.', '— Zenatiq Solutions',
].join('\n');
const reminderMessage = (l) => [
  hello(l), '', l.days_left >= 0
    ? `Your ZenPOS subscription for ${l.shop} is paid until ${fmtDate(l.paid_until)} (${daysSays(l).toLowerCase()}).`
    : `Your ZenPOS subscription for ${l.shop} ended on ${fmtDate(l.paid_until)}. ZenPOS keeps working until ${fmtDate(l.grace_until)}, then it becomes read-only until it's renewed.`,
  '', `Renew it here, online or by bank transfer (${money(l.price, l.currency)} a year):`, l.renew_url, '', '— Zenatiq Solutions',
].join('\n');

export async function render(ctx) {
  return ctx.params[0] ? detail(ctx, ctx.params[0]) : list(ctx);
}

// --- Every licence, with slips and requests to deal with ------------------------------------------------
async function list(ctx) {
  const { el, db } = ctx;
  ctx.title = 'ZenPOS Key Maker';
  const { licences, requests, slips } = await db.zenpos.list();
  if (!ctx.isCurrent()) return;
  let filter = FILTERS[recall('zq-zenpos')] ? recall('zq-zenpos') : 'all';
  let query = '';
  const count = (state) => licences.filter((l) => l.state === state).length;

  const draw = () => {
    const words = flat(query);
    const rows = licences
      .filter((l) => (filter === 'all' || l.state === filter) && (!words || [l.shop, l.owner, l.phone, l.licence_id, l.device, l.key].some((v) => flat(v).includes(words))))
      .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.paid_until.localeCompare(b.paid_until));
    el.querySelector('[data-list]').innerHTML = String(rows.length ? html`
      <div class="table-wrap"><table class="table table--hover zp-table">
        <thead><tr><th>Shop</th><th>Phone</th><th>Computer ID</th><th>Paid until</th><th>Status</th><th>Last check by ZenPOS</th></tr></thead>
        <tbody>${rows.map((l) => html`<tr data-act="open" data-id="${l.id}" tabindex="0">
          <td><b>${l.shop}</b><small class="block muted">${l.licence_id} · ${l.owner || ''}</small></td>
          <td>${l.phone}</td>
          <td><code>${l.device || 'Not activated'}</code></td>
          <td>${fmtDate(l.paid_until)}<small class="block ${['grace', 'expired'].includes(l.state) ? 'is-due' : 'muted'}">${daysSays(l)}</small></td>
          <td>${statePill(l.state)}</td>
          <td>${l.last_check_at ? html`${ago(l.last_check_at)}<small class="block muted">ZenPOS ${l.version || ''}</small>` : html`<span class="muted">Never</span>`}</td>
        </tr>`)}</tbody>
      </table></div>` : emptyState(licences.length ? 'No licences match' : 'No ZenPOS licences yet',
      licences.length ? 'Try another search or filter.' : 'Choose "New licence" to make the first one.'));
    el.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-on', b.dataset.filter === filter));
  };

  mount(el, html`
    ${pageHead('ZenPOS Key Maker', 'Licences for ZenPOS, one shop computer each. Only owners and admins see this page.',
      html`<button class="btn btn--primary" type="button" data-act="new">${icon('a-plus')}New licence</button>`)}
    <section class="stats stats--4">
      <div class="stat"><span class="stat__icon">${icon('a-key')}</span><span class="stat__value">${count('active') + count('ending')}</span><span class="stat__label">Working, paid up</span></div>
      <div class="stat ${count('ending') ? 'is-alert' : ''}"><span class="stat__icon">${icon('a-renew')}</span><span class="stat__value">${count('ending')}</span><span class="stat__label">Ending in 30 days</span></div>
      <div class="stat ${count('grace') ? 'is-alert' : ''}"><span class="stat__icon">${icon('clock')}</span><span class="stat__value">${count('grace')}</span><span class="stat__label">Renewal due</span></div>
      <div class="stat"><span class="stat__icon">${icon('a-wallet')}</span><span class="stat__value">${count('expired')}</span><span class="stat__label">Read-only</span></div>
    </section>
    ${slips.length ? html`<section class="card">
      <header class="card__head"><h2>Bank slips to check (${slips.length})</h2></header>
      <ul class="plist">${slips.map((s) => html`<li><div><b>${s.shop}</b> <span class="muted">${s.licence_id}</span>
        <small>${money(s.amount, s.currency)} · ${s.reference ? `Reference ${s.reference} · ` : ''}${s.payer ? `From ${s.payer} · ` : ''}sent ${ago(s.created_at)}</small></div>
        <span class="row-actions">
          <button class="btn btn--ghost btn--sm" type="button" data-act="view-slip" data-id="${s.id}">View</button>
          <button class="btn btn--primary btn--sm" type="button" data-act="approve-slip" data-id="${s.id}">Approve</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="reject-slip" data-id="${s.id}">Reject</button>
        </span></li>`)}</ul>
    </section>` : ''}
    ${requests.length ? html`<section class="card">
      <header class="card__head"><h2>Requests from the Buy ZenPOS page (${requests.length})</h2></header>
      <ul class="plist">${requests.map((r) => html`<li><div><b>${r.shop}</b> <span class="muted">${r.name}</span>
        <small>${r.phone}${r.email ? ` · ${r.email}` : ''}${r.device ? ` · ${r.device}` : ''} · ${ago(r.created_at)}${r.note ? ` · "${r.note}"` : ''}</small></div>
        <span class="row-actions">
          <a class="btn btn--ghost btn--sm" href="${waLink(r.phone, `Hi ${r.name}, thanks for asking about ZenPOS for ${r.shop}.`)}" target="_blank" rel="noopener">${icon('i-chat')}WhatsApp</a>
          <button class="btn btn--primary btn--sm" type="button" data-act="from-request" data-id="${r.id}">Make a licence</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="dismiss" data-id="${r.id}">Dismiss</button>
        </span></li>`)}</ul>
    </section>` : ''}
    <section class="card">
      <header class="card__head"><h2>Licences</h2>
        <input class="input zp-search" type="search" data-search placeholder="Search shop, phone, key, ZL- or ZP- ID" aria-label="Search licences"></header>
      <div class="seg zp-filters">${Object.entries(FILTERS).map(([k, label]) => html`<button type="button" data-act="filter" data-filter="${k}">${label}</button>`)}</div>
      <div data-list></div>
    </section>`, {
    new: () => newLicence(ctx),
    'from-request': (btn) => newLicence(ctx, requests.find((r) => r.id === btn.dataset.id)),
    dismiss: async (btn) => {
      try { await db.zenpos.dismissRequest(btn.dataset.id); toast('Request dismissed'); render(ctx); } catch (err) { toast(friendly(err), 'error'); }
    },
    'view-slip': async (btn) => viewSlip(ctx, slips.find((s) => s.id === btn.dataset.id)),
    'approve-slip': async (btn) => approveSlip(ctx, slips.find((s) => s.id === btn.dataset.id)),
    'reject-slip': async (btn) => rejectSlip(ctx, slips.find((s) => s.id === btn.dataset.id)),
    filter: (btn) => { filter = btn.dataset.filter; remember('zq-zenpos', filter); draw(); },
    open: (row) => ctx.go(`#/zenpos/${row.dataset.id}`),
  });
  const search = el.querySelector('[data-search]');
  search.addEventListener('input', () => { query = search.value; draw(); });
  // A whole key: find its licence (keys are stored encrypted, so only the server can match one).
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || flat(search.value).length < 20) return;
    try {
      const id = await db.zenpos.findKey(search.value);
      if (id) ctx.go(`#/zenpos/${id}`); else toast('No licence has that key', 'warn');
    } catch (err) { toast(friendly(err), 'error'); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click(); });
  draw();
}

// --- One licence ---------------------------------------------------------------------------------------
async function detail(ctx, id) {
  const { el, db } = ctx;
  const { licence: l, payments, events, slips } = await db.zenpos.get(id);
  if (!ctx.isCurrent()) return;
  ctx.title = `${l.shop} · ZenPOS`;
  const due = ['ending', 'grace', 'expired'].includes(l.state);

  mount(el, html`
    <a class="crumb" href="#/zenpos">${icon('a-back')}ZenPOS Key Maker</a>
    ${pageHead(l.shop, `${l.licence_id} · ${l.package} · ${money(l.price, l.currency)} a year`, statePill(l.state))}
    <div class="zp-detail">
      <section class="card subcard">
        <header class="card__head"><h2>Licence</h2></header>
        <div class="subcard__facts">
          <div><span>Paid until</span><b>${fmtDate(l.paid_until)}</b><small class="${['grace', 'expired'].includes(l.state) ? 'is-due' : ''}">${daysSays(l)}</small></div>
          <div><span>Last day to renew</span><b>${fmtDate(l.grace_until)}</b><small>Read-only after this day</small></div>
          <div><span>Computer ID</span><b><code>${l.device || 'Not activated'}</code></b><small>${l.bound_at ? `Since ${fmtDate(l.bound_at)}` : 'Taken by the first computer that activates'}</small></div>
          <div><span>Last check by ZenPOS</span><b>${l.last_check_at ? ago(l.last_check_at) : 'Never'}</b><small>${l.version ? `ZenPOS ${l.version}` : ''}</small></div>
        </div>
        <div class="zp-key"><span>Licence key</span><code data-key>${l.key}</code>
          <button class="btn btn--ghost btn--sm" type="button" data-act="show-key">${icon('a-key')}Show</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="copy-key">${icon('copy')}Copy</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="wa-key">${icon('i-chat')}Send on WhatsApp</button></div>
        <div class="subcard__actions">
          <button class="btn btn--primary btn--sm" type="button" data-act="renew">${icon('a-renew')}Record payment / renew</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="move">Move to another computer</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="offline">Offline licence code</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="copy-renew">${icon('copy')}Copy renewal link</button>
          ${due ? html`<a class="btn btn--ghost btn--sm" href="${waLink(l.phone, reminderMessage(l))}" target="_blank" rel="noopener">${icon('i-chat')}WhatsApp a reminder</a>` : ''}
          <button class="btn btn--ghost btn--sm" type="button" data-act="edit">${icon('a-edit')}Edit details</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="cancel">${l.status === 'cancelled' ? 'Restore' : 'Cancel licence'}</button>
        </div>
      </section>
      <section class="card">
        <header class="card__head"><h2>Shop</h2></header>
        <dl class="zp-shop">
          <dt>Owner</dt><dd>${l.owner || '—'}</dd>
          <dt>Mobile / WhatsApp</dt><dd><a href="${waLink(l.phone, hello(l))}" target="_blank" rel="noopener">${l.phone}</a></dd>
          <dt>Email</dt><dd>${l.email || html`<span class="muted">None: no emailed reminders or receipts</span>`}</dd>
          <dt>Address</dt><dd>${l.address || '—'}</dd>
          ${l.notes ? html`<dt>Notes</dt><dd>${l.notes}</dd>` : ''}
          ${(l.previous_devices || []).length ? html`<dt>Earlier computers</dt><dd>${l.previous_devices.map((d) => html`<code>${d.device}</code> <small class="muted">until ${fmtDate(d.moved_at)}</small><br>`)}</dd>` : ''}
        </dl>
      </section>
      <section class="card">
        <header class="card__head"><h2>Payments</h2></header>
        ${payments.length ? html`<ul class="plist">${payments.map((p) => html`<li><div><b>${money(p.amount, p.currency)}</b>
          <small>${LABELS.method[p.method] || p.method}${p.reference ? ` · ${p.reference}` : ''} · paid until ${fmtDate(p.to_paid_until)} · ${p.recorded_by_label || ''}</small></div>
          <time>${fmtDate(p.paid_on)}</time></li>`)}</ul>` : html`<p class="small muted">No payments recorded yet.</p>`}
        ${slips.length ? html`<h3 class="zp-sub">Bank slips</h3><ul class="plist">${slips.map((s) => html`<li><div><b>${s.status === 'pending' ? 'Waiting to be checked' : s.status === 'approved' ? 'Approved' : 'Rejected'}</b>
          <small>${s.reference || 'No reference'} · ${ago(s.created_at)}${s.decided_by ? ` · ${s.decided_by}` : ''}${s.reason ? ` · ${s.reason}` : ''}</small></div>
          <button class="btn btn--ghost btn--sm" type="button" data-act="view-slip" data-id="${s.id}">View</button></li>`)}</ul>` : ''}
      </section>
      <section class="card">
        <header class="card__head"><h2>History</h2></header>
        <ul class="plist">${events.map((e) => html`<li><div><b>${e.summary}</b><small>${e.by}</small></div><time title="${fmtDate(e.at)}">${ago(e.at)}</time></li>`)}</ul>
      </section>
    </div>`, {
    'show-key': async () => {
      try { el.querySelector('[data-key]').textContent = (await db.zenpos.key(l.id)).key; } catch (err) { toast(friendly(err), 'error'); }
    },
    'copy-key': async () => { try { copyText((await db.zenpos.key(l.id)).key, 'Key copied'); } catch (err) { toast(friendly(err), 'error'); } },
    'wa-key': async () => {
      try { window.open(waLink(l.phone, keyMessage(l, (await db.zenpos.key(l.id)).key)), '_blank', 'noopener'); } catch (err) { toast(friendly(err), 'error'); }
    },
    'copy-renew': () => copyText(l.renew_url, 'Renewal link copied'),
    renew: () => renewLicence(ctx, l),
    move: () => moveLicence(ctx, l),
    offline: () => offlineCode(ctx, l),
    edit: () => editLicence(ctx, l),
    cancel: async () => {
      const cancelling = l.status !== 'cancelled';
      const ok = await confirmDialog(cancelling
        ? { title: 'Cancel this licence?', message: `ZenPOS at ${l.shop} becomes read-only at its next check. You can restore it later.`, confirmLabel: 'Cancel licence' }
        : { title: 'Restore this licence?', message: 'ZenPOS works again at its next check, until the paid-until date.', confirmLabel: 'Restore', danger: false });
      if (!ok) return;
      try { await db.zenpos.cancel(l.id, cancelling); toast(cancelling ? 'Licence cancelled' : 'Licence restored'); render(ctx); } catch (err) { toast(friendly(err), 'error'); }
    },
    'view-slip': (btn) => viewSlip(ctx, slips.find((s) => s.id === btn.dataset.id)),
  });
}

// --- Forms ---------------------------------------------------------------------------------------------
const shopFields = (l = {}) => html`
  <div class="field-row">
    <label class="field"><span>Shop name</span><input class="input" name="shop" required maxlength="120" value="${l.shop || ''}" autofocus></label>
    <label class="field"><span>Owner's name</span><input class="input" name="owner" required maxlength="120" value="${l.owner || l.name || ''}"></label>
  </div>
  <div class="field-row">
    <label class="field"><span>Mobile / WhatsApp</span><input class="input" name="phone" required maxlength="40" inputmode="tel" value="${l.phone || ''}" placeholder="077 123 4567"></label>
    <label class="field"><span>Email <em>(optional)</em></span><input class="input" name="email" type="email" maxlength="200" value="${l.email || ''}"></label>
  </div>
  <label class="field"><span>Address <em>(optional)</em></span><input class="input" name="address" maxlength="300" value="${l.address || ''}"></label>`;
const shopRow = (fd) => ({ shop: val(fd, 'shop'), owner: val(fd, 'owner'), phone: val(fd, 'phone'), email: val(fd, 'email'), address: val(fd, 'address'), notes: val(fd, 'notes') });

async function newLicence(ctx, request = null) {
  const made = await modal({
    title: 'New ZenPOS licence',
    submitLabel: 'Make the licence',
    wide: true,
    body: html`
      ${request ? html`<p class="small muted">From ${request.name}'s request${request.device ? `, for computer ${request.device}` : ''}. ${request.device ? 'Send them the key; their computer takes it when they activate.' : ''}</p>` : ''}
      ${shopFields(request ? { shop: request.shop, name: request.name, phone: request.phone, email: request.email } : {})}
      <div class="field-row">
        <label class="field"><span>Start date</span><input class="input" type="date" name="starts_on" value="${today()}"></label>
        <label class="field"><span>Yearly price (LKR)</span><input class="input" name="price" inputmode="decimal" value="15000"></label>
      </div>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="notes" rows="2" maxlength="2000">${request?.note || ''}</textarea></label>
      <fieldset class="billing"><legend>The first year</legend>
        <label class="zp-paidnow"><input type="checkbox" name="paid" checked> Paid now</label>
        <div class="field-row" data-paid>
          <label class="field"><span>Paid by</span><select class="input" name="method">${options(LABELS.method, 'cash')}</select></label>
          <label class="field"><span>Reference <em>(optional)</em></span><input class="input" name="reference" maxlength="120"></label>
        </div>
      </fieldset>
      <small class="field__hint">Package: ZenPOS Yearly, for one computer. It's paid until a year from the start date, less a day, with 14 more days to renew.</small>`,
    onOpen: (form) => form.elements.paid.addEventListener('change', () => { form.querySelector('[data-paid]').hidden = !form.elements.paid.checked; }),
    onSubmit: async (fd) => ctx.db.zenpos.create({ ...shopRow(fd), starts_on: val(fd, 'starts_on'), price: num(fd, 'price') },
      { paid: fd.get('paid') ? { method: val(fd, 'method'), reference: val(fd, 'reference') } : null, requestId: request?.id ?? null }),
  });
  if (!made) return;
  await showKey(ctx, made.licence, made.key);
  ctx.go(`#/zenpos/${made.licence.id}`);
}

// The new key, once, ready to send.
function showKey(ctx, l, key) {
  return modal({
    title: 'Licence made',
    body: html`
      <p class="modal__text">${l.licence_id} for <b>${l.shop}</b>, paid until ${fmtDate(l.paid_until)}. Send the key to the shop:</p>
      <div class="code"><pre>${key}</pre></div>
      <p class="small muted">The shop pastes it in ZenPOS → Subscription → Activate (internet needed once). You can show the key again on the licence's page.</p>
      <a class="btn btn--primary" href="${waLink(l.phone, keyMessage(l, key))}" target="_blank" rel="noopener">${icon('i-chat')}Send on WhatsApp</a>`,
    actions: [{ act: 'copy', label: 'Copy key', icon: 'copy' }],
    onAction: async () => { await copyText(key, 'Key copied'); return false; },
  });
}

async function renewLicence(ctx, l) {
  const done = await modal({
    title: `Record payment: ${l.shop}`,
    submitLabel: 'Record and renew',
    body: html`
      <div class="field-row">
        <label class="field"><span>Amount (LKR)</span><input class="input" name="amount" inputmode="decimal" required value="${l.price}"></label>
        <label class="field"><span>Paid on</span><input class="input" type="date" name="paid_on" required value="${today()}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Paid by</span><select class="input" name="method">${options(LABELS.method, 'bank_transfer')}</select></label>
        <label class="field"><span>Reference <em>(optional)</em></span><input class="input" name="reference" maxlength="120"></label>
      </div>
      <p class="zp-preview" data-preview></p>`,
    onOpen: (form) => {
      const preview = () => {
        const day = form.elements.paid_on.value || today();
        form.querySelector('[data-preview]').textContent = `Paid until moves from ${fmtDate(l.paid_until)} to ${fmtDate(renewsTo(l, day))}, with 14 more days to renew. ${day <= l.paid_until ? 'Paid early, so the new year comes after the current one.' : 'Paid after the paid-until date, so the year starts on the payment day.'}`;
      };
      form.elements.paid_on.addEventListener('input', preview);
      preview();
    },
    onSubmit: async (fd) => ctx.db.zenpos.renew(l.id, { amount: num(fd, 'amount'), method: val(fd, 'method'), reference: val(fd, 'reference'), paid_on: val(fd, 'paid_on') }),
  });
  if (!done) return;
  toast(`Renewed until ${fmtDate(done.licence.paid_until)}${done.emailed ? '. Receipt emailed.' : ''}`);
  render(ctx);
}

async function moveLicence(ctx, l) {
  const moved = await modal({
    title: 'Move to another computer',
    submitLabel: 'Move the licence',
    body: html`
      <p class="modal__text">The licence is on <code>${l.device || 'no computer yet'}</code>. After the move, that computer becomes read-only at its next check.</p>
      <label class="field"><span>New Computer ID <em>(optional)</em></span><input class="input" name="device" maxlength="40" placeholder="ZP-XXXX-XXXX-XXXX" autofocus>
        <small class="field__hint">The shop finds it in ZenPOS → Subscription. Leave it empty to free the licence: the next computer that activates with the key takes it.</small></label>`,
    onSubmit: async (fd) => ctx.db.zenpos.move(l.id, val(fd, 'device')),
  });
  if (!moved) return;
  toast(moved.device ? `Moved to ${moved.device}` : 'Freed for the next computer that activates');
  render(ctx);
}

async function offlineCode(ctx, l) {
  const made = await modal({
    title: 'Offline licence code',
    submitLabel: 'Make the code',
    body: html`
      <p class="modal__text">For a shop without internet: ZenPOS takes this signed code instead of the key, for one computer only.</p>
      <label class="field"><span>Computer ID</span><input class="input" name="device" required maxlength="40" value="${l.device || ''}" placeholder="ZP-XXXX-XXXX-XXXX" autofocus></label>`,
    onSubmit: async (fd) => ctx.db.zenpos.offlineCode(l.id, val(fd, 'device')),
  });
  if (!made) return;
  await modal({
    title: `Offline code for ${made.device}`,
    body: html`
      <div class="code zp-code"><pre>${made.code}</pre></div>
      <p class="small muted">The shop pastes it in ZenPOS → Subscription → Activate. It works until ${fmtDate(l.grace_until)} unless renewed.</p>
      <a class="btn btn--primary" href="${waLink(l.phone, codeMessage(l, made.device, made.code))}" target="_blank" rel="noopener">${icon('i-chat')}Send on WhatsApp</a>`,
    actions: [{ act: 'copy', label: 'Copy code', icon: 'copy' }],
    onAction: async () => { await copyText(made.code, 'Code copied'); return false; },
  });
  render(ctx);
}

async function editLicence(ctx, l) {
  const saved = await modal({
    title: 'Edit details',
    wide: true,
    body: html`${shopFields(l)}
      <div class="field-row">
        <label class="field"><span>Yearly price (LKR)</span><input class="input" name="price" inputmode="decimal" value="${l.price}"></label>
        <span></span>
      </div>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="notes" rows="2" maxlength="2000">${l.notes || ''}</textarea></label>`,
    onSubmit: async (fd) => ctx.db.zenpos.update(l.id, { ...shopRow(fd), price: num(fd, 'price') }),
  });
  if (saved) { toast('Details saved'); render(ctx); }
}

// --- Bank slips ------------------------------------------------------------------------------------------
async function viewSlip(ctx, s) {
  try {
    const image = await ctx.db.zenpos.slip(s.id);
    await modal({ title: `Bank slip: ${s.shop}`, wide: true, body: html`<img class="zp-slip" src="${image}" alt="Bank slip from ${s.shop}">
      <p class="small muted">${s.reference ? `Reference ${s.reference}. ` : ''}${s.payer ? `From ${s.payer}. ` : ''}Sent ${ago(s.created_at)}.</p>` });
  } catch (err) { toast(friendly(err), 'error'); }
}
async function approveSlip(ctx, s) {
  const done = await modal({
    title: `Approve the slip: ${s.shop}`,
    submitLabel: 'Approve and renew',
    body: html`<p class="modal__text">Check the money is in the bank first. Approving records the payment and renews ${s.licence_id} for a year.</p>
      <div class="field-row">
        <label class="field"><span>Amount (LKR)</span><input class="input" name="amount" inputmode="decimal" value="${s.amount}"></label>
        <label class="field"><span>Reference</span><input class="input" name="reference" maxlength="120" value="${s.reference || ''}"></label>
      </div>`,
    onSubmit: async (fd) => ctx.db.zenpos.approveSlip(s.id, { amount: num(fd, 'amount'), reference: val(fd, 'reference') }),
  });
  if (!done) return;
  toast(`Renewed until ${fmtDate(done.licence.paid_until)}${done.emailed ? '. Receipt emailed.' : ''}`);
  render(ctx);
}
async function rejectSlip(ctx, s) {
  const done = await modal({
    title: 'Reject the slip?',
    submitLabel: 'Reject',
    danger: true,
    body: html`<label class="field"><span>Why <em>(optional, for the history)</em></span><input class="input" name="reason" maxlength="300" autofocus></label>`,
    onSubmit: async (fd) => { await ctx.db.zenpos.rejectSlip(s.id, val(fd, 'reason')); return true; },
  });
  if (done) { toast('Slip rejected'); render(ctx); }
}
