// Zenatiq admin: small helpers shared by every view.

// --- Safe HTML ---------------------------------------------------------------
// html`...` escapes every value unless it is already Html (from html`` or raw()).
export class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Html(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const out = (v) => (v == null || v === false ? '' : v instanceof Html ? v.s : Array.isArray(v) ? v.map(out).join('') : esc(v));
export const html = (strings, ...values) =>
  new Html(strings.reduce((acc, s, i) => acc + s + (i < values.length ? out(values[i]) : ''), ''));

export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`);

// Render into an element and route clicks/changes/submits to named handlers.
export function mount(el, view, handlers = {}) {
  el.innerHTML = String(view);
  const route = (type) => (e) => {
    const target = e.target.closest(`[data-${type}]`);
    if (target && el.contains(target) && handlers[target.dataset[type]]) {
      e.stopPropagation(); // a nested mount handles its own actions
      handlers[target.dataset[type]](target, e);
    }
  };
  el.onclick = route('act');
  el.onchange = route('change');
  el.oninput = route('input');
  el.onsubmit = (e) => {
    const form = e.target.closest('[data-submit]');
    if (form && handlers[form.dataset.submit]) { e.preventDefault(); handlers[form.dataset.submit](form, e); }
  };
  return el;
}

export const pageHead = (title, sub = '', actions = '') => html`
  <header class="head">
    <div class="head__text"><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>
    <div class="head__actions">${actions}</div>
  </header>`;

export const emptyState = (title, text = '', action = '') => html`
  <div class="empty">${icon('a-folder')}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;

// --- Labels -----------------------------------------------------------------
export const LABELS = {
  status: { lead: 'Lead', planning: 'Planning', in_progress: 'In progress', review: 'Review', live: 'Live', maintenance: 'Maintenance', on_hold: 'On hold', completed: 'Completed' },
  type: { website: 'Website', online_shop: 'Online shop', pos: 'POS system', mobile_app: 'Mobile app', ui_ux: 'UI/UX design', other: 'Other' },
  task: { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' },
  priority: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
  category: { bug: 'Bug', update: 'Update request', question: 'Question', other: 'Other' },
  thread: { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' },
  role: { owner: 'Owner', admin: 'Admin', member: 'Member' },
  method: { bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', cheque: 'Cheque', online: 'Online', other: 'Other' },
};
export const ACTIVE_STATUSES = ['planning', 'in_progress', 'review'];
export const TYPE_ICON = { website: 'i-web', online_shop: 'i-shop', pos: 'i-pos', mobile_app: 'i-app', ui_ux: 'i-ux', other: 'a-folder' };

export const options = (map, selected, { blank } = {}) => raw(
  (blank ? `<option value="">${esc(blank)}</option>` : '') +
  Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join(''));
export const pill = (kind, value) => html`<span class="pill pill--${kind} is-${value}">${LABELS[kind]?.[value] ?? value}</span>`;

// --- Formatting ---------------------------------------------------------------
export const money = (n, currency = 'LKR') =>
  `${currency} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const asDate = (d) => new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00` : d);
export const fmtDate = (d) => (d ? asDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtShort = (d) => (d ? asDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
export const fmtTime = (d) => (d ? asDate(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
export function ago(ts) {
  const s = (Date.now() - asDate(ts)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtShort(ts);
}
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const isOverdue = (d, done) => !!d && !done && d < today();

export const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const COLORS = ['#e10600', '#0b7a75', '#5b4bc4', '#c26b00', '#1f6feb', '#9a3c8e', '#2f7d32', '#b23a48'];
export const colorFor = (s) => COLORS[[...(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export const avatar = (member, cls = '') => member
  ? html`<span class="av ${cls}" style="background:${colorFor(member.email)}" title="${member.full_name}">${initials(member.full_name)}</span>`
  : html`<span class="av av--empty ${cls}" title="Unassigned">${icon('i-user')}</span>`;
export const firstName = (name) => (name || '').split(/\s+/)[0];

export const safeUrl = (u) => {
  if (!u) return '';
  const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try { return new URL(url).href; } catch { return ''; }
};
export const prettyUrl = (u) => (u || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');

// --- Feedback -------------------------------------------------------------------
export function toast(message, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast--${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.classList.add('is-out'), 3400);
  setTimeout(() => t.remove(), 3800);
}

export function friendly(err) {
  const m = String(err?.message || err || 'Something went wrong.');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server. Check your internet connection.';
  return m;
}

// <dialog>-based modal. Resolves with onSubmit's result, the action name, or null.
export function modal({ title, body, submitLabel = 'Save', danger = false, wide = false, onSubmit, actions = [], onAction, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = `modal${wide ? ' modal--wide' : ''}`;
    d.innerHTML = String(html`
      <form class="modal__form" novalidate>
        <header class="modal__head"><h2>${title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
        <div class="modal__body">${body}</div>
        <p class="modal__error" role="alert" hidden></p>
        <footer class="modal__foot">
          ${actions.map((a) => html`<button type="button" class="btn ${a.danger ? 'btn--danger-ghost' : 'btn--ghost'}" data-modal-act="${a.act}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`)}
          <span class="grow"></span>
          <button type="button" class="btn btn--ghost" data-close>${onSubmit ? 'Cancel' : 'Close'}</button>
          ${onSubmit ? html`<button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${submitLabel}</button>` : ''}
        </footer>
      </form>`);
    document.body.append(d);
    const form = d.querySelector('form');
    const err = d.querySelector('.modal__error');
    const finish = (value) => { d.close(); d.remove(); resolve(value); };
    const fail = (ex) => { err.textContent = friendly(ex); err.hidden = false; };
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    d.addEventListener('click', async (e) => {
      if (e.target === d || e.target.closest('[data-close]')) return finish(null);
      const act = e.target.closest('[data-modal-act]');
      if (act && onAction) {
        try { const r = await onAction(act.dataset.modalAct, form); if (r !== false) finish(act.dataset.modalAct); }
        catch (ex) { fail(ex); }
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit || !form.reportValidity()) return;
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      err.hidden = true;
      try { finish((await onSubmit(new FormData(form), form)) ?? true); }
      catch (ex) { fail(ex); btn.disabled = false; }
    });
    d.showModal();
    onOpen?.(form);
    (form.querySelector('[autofocus]') || form.querySelector('.modal__body input, .modal__body select, .modal__body textarea'))?.focus();
  });
}

export const confirmDialog = ({ title, message, confirmLabel = 'Delete', danger = true }) =>
  modal({ title, body: html`<p class="modal__text">${message}</p>`, submitLabel: confirmLabel, danger, onSubmit: async () => true });

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast('Select the text and copy it with Ctrl+C', 'warn'); }
}

// Per-tab conveniences (remembered filters). Storage can be unavailable, so never rely on it.
export const remember = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* ignore */ } };
export const recall = (key) => { try { return sessionStorage.getItem(key); } catch { return null; } };

// Form helpers: empty strings become null so optional columns stay empty.
export const val = (fd, name) => { const v = (fd.get(name) ?? '').toString().trim(); return v === '' ? null : v; };
export const num = (fd, name) => { const v = val(fd, name); return v == null ? null : Number(v.replace(/,/g, '')); };
