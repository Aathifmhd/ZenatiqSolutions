/*!
 * Contact with Zenatiq
 * Lets a Zenatiq client report bugs, ask for changes and read replies from inside
 * their own website's admin panel. Messages arrive in the Zenatiq admin portal.
 *
 * Floating button:   <script src="https://www.zenatiqsolutions.com/connect/widget.js" data-key="PROJECT_KEY" defer></script>
 * Inside a page:     <div id="zenatiq-connect"></div> + the script tag with data-mode="inline"
 * Optional:          data-position="left" puts the floating button on the left.
 */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || window.__zenatiqConnect) return;
  window.__zenatiqConnect = true;

  const base = new URL(script.src, location.href).origin;
  const key = script.dataset.key || new URLSearchParams(location.search).get('key') || '';
  const target = document.getElementById('zenatiq-connect');
  const mode = script.dataset.mode || (target ? 'inline' : 'floating');
  const side = script.dataset.position === 'left' ? 'left' : 'right';
  const WHATSAPP = 'https://wa.me/94758112170';

  const CATEGORIES = [['bug', 'Something is broken'], ['update', 'I need a change'], ['question', 'A question'], ['other', 'Something else']];
  const CATEGORY = { bug: 'Bug', update: 'Update request', question: 'Question', other: 'Other' };
  const STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

  const saved = {
    get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not important */ } },
  };

  // Builds elements without ever treating text as HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const icon = (d) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    return svg;
  };
  const I = {
    back: 'M15 5.5 8.5 12l6.5 6.5', close: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14',
    send: 'M20.5 3.5 3.5 10.6l6.6 2.8 2.8 6.6zM10.1 13.4l4.4-4.4', chat: 'M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z',
  };
  const ago = (ts) => {
    const s = (Date.now() - new Date(ts)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const time = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // --- Talking to Zenatiq --------------------------------------------------------
  // Sent as text/plain so browsers don't need an extra permission check (CORS preflight) first.
  async function api(op, args = {}) {
    let res;
    try {
      res = await fetch(`${base}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ...args, op, key }),
      });
    } catch {
      throw new Error('No connection. Check your internet and try again.');
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      const err = new Error(json?.error?.message || 'Something went wrong. Please try again.');
      err.code = json?.error?.code;
      throw err;
    }
    return json.data;
  }
  const BAD_KEY = 'This Contact with Zenatiq link is not set up correctly. Please let Zenatiq know.';

  // --- Layout ------------------------------------------------------------------------
  const host = h('div', { 'data-zenatiq-connect': '' });
  (mode === 'inline' && target ? target : document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', {}, css()));

  const state = { open: mode !== 'floating', view: 'list', threads: [], thread: null, messages: [], project: '', unread: 0, error: '' };
  const body = h('div', { class: 'body', 'aria-live': 'polite' });
  const titleSub = h('span', { class: 'sub' }, '');
  const closeBtn = h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => toggle(false) }, icon(I.close));
  const panel = h('section', { class: 'panel', role: mode === 'floating' ? 'dialog' : 'region', 'aria-label': 'Contact with Zenatiq', hidden: !state.open },
    h('header', { class: 'top' },
      h('img', { class: 'logo', src: `${base}/assets/zenatiq-icon-192.png`, alt: '', width: '36', height: '36' }),
      h('div', { class: 'title' }, h('b', {}, 'Contact with Zenatiq'), titleSub),
      mode === 'floating' ? closeBtn : null),
    body,
    h('footer', { class: 'foot' }, 'Powered by ', h('a', { href: 'https://www.zenatiqsolutions.com', target: '_blank', rel: 'noopener' }, 'Zenatiq Solutions')));
  const badge = h('span', { class: 'count', hidden: true }, '0');
  const launcher = h('button', { class: 'launcher', type: 'button', 'aria-expanded': 'false', onclick: () => toggle() },
    h('img', { src: `${base}/assets/zenatiq-icon-192.png`, alt: '', width: '28', height: '28' }), h('span', {}, 'Contact with Zenatiq'), badge);
  const wrap = h('div', { class: `wrap ${mode} ${side}` }, panel, mode === 'floating' ? launcher : null);
  shadow.append(wrap);

  function toggle(force) {
    state.open = force ?? !state.open;
    panel.hidden = !state.open;
    wrap.classList.toggle('is-open', state.open);
    launcher.setAttribute('aria-expanded', String(state.open));
    if (state.open) { refresh(); panel.querySelector('button, input, textarea')?.focus(); }
    else launcher.focus();
    schedule();
  }
  shadow.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode === 'floating' && state.open) toggle(false); });

  // --- Views ---------------------------------------------------------------------------
  function render() {
    body.replaceChildren();
    if (state.error) return body.append(errorView());
    if (state.view === 'new') return body.append(newView());
    if (state.view === 'thread' && state.thread) return body.append(threadView());
    body.append(listView());
  }

  function errorView() {
    return h('div', { class: 'empty' }, icon(I.chat), h('p', { class: 'strong' }, state.error),
      h('p', {}, 'You can also reach Zenatiq on ', h('a', { href: WHATSAPP, target: '_blank', rel: 'noopener' }, 'WhatsApp'), '.'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { state.error = ''; refresh(); } }, 'Try again'));
  }

  function listView() {
    const list = state.threads;
    return h('div', { class: 'list' },
      h('div', { class: 'intro' },
        h('p', {}, `Found a problem or need a change${state.project ? ` on ${state.project}` : ''}? Send it to the Zenatiq team and follow the replies here.`),
        h('button', { class: 'btn', type: 'button', onclick: () => go('new') }, icon(I.plus), 'New message')),
      list.length
        ? h('ul', { class: 'threads' }, list.map((t) => h('li', {},
            h('button', { class: `thread ${t.unread ? 'unread' : ''}`, type: 'button', onclick: () => openThread(t) },
              h('span', { class: 'row' }, h('b', {}, t.subject), h('time', {}, ago(t.last_message_at))),
              h('span', { class: 'row tags' },
                h('span', { class: `pill ${t.category}` }, CATEGORY[t.category] || t.category),
                h('span', { class: `pill status ${t.status}` }, STATUS[t.status] || t.status),
                t.unread ? h('span', { class: 'new' }, 'New reply') : null)))))
        : h('div', { class: 'empty small' }, h('p', {}, 'No messages yet. Your conversations with Zenatiq will appear here.')));
  }

  function newView() {
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const subject = String(f.get('subject') || '').trim();
      const text = String(f.get('body') || '').trim();
      if (!subject || !text) { err.textContent = 'Please add a subject and your message.'; err.hidden = false; return; }
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      err.hidden = true;
      saved.set('zq-connect-name', String(f.get('name') || '').trim());
      saved.set('zq-connect-contact', String(f.get('contact') || '').trim());
      try {
        const id = await api('start', {
          subject, body: text, category: f.get('category') || 'question',
          name: f.get('name') || null, contact: f.get('contact') || null,
        });
        await loadThreads();
        const thread = state.threads.find((t) => t.id === id);
        if (thread) await openThread(thread, { sent: true }); else go('list');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        button.disabled = false;
      }
    } },
      h('fieldset', { class: 'cats' }, h('legend', {}, 'What is it about?'),
        CATEGORIES.map(([value, label], i) => h('label', { class: 'cat' },
          h('input', { type: 'radio', name: 'category', value, checked: i === 0 }), h('span', {}, label)))),
      field('Subject', h('input', { name: 'subject', maxlength: '200', required: true, placeholder: 'e.g. The checkout button does nothing' })),
      field('Message', h('textarea', { name: 'body', rows: '5', maxlength: '5000', required: true, placeholder: 'Tell us what happened, on which page, and what you expected.' })),
      h('div', { class: 'two' },
        field('Your name', h('input', { name: 'name', maxlength: '120', value: saved.get('zq-connect-name'), autocomplete: 'name' })),
        field('Phone or email', h('input', { name: 'contact', maxlength: '200', value: saved.get('zq-connect-contact'), placeholder: 'Optional' }))),
      err,
      h('button', { class: 'btn wide', type: 'submit' }, icon(I.send), 'Send to Zenatiq'));
    return h('div', { class: 'pane' }, backBar('New message'), form);
  }

  function threadView() {
    const t = state.thread;
    const msgs = h('div', { class: 'msgs' }, state.messages.map((m) => h('div', { class: `msg ${m.sender}` },
      h('div', { class: 'meta' }, h('b', {}, m.sender === 'team' ? `${m.author_name || 'Zenatiq'} · Zenatiq` : m.author_name || 'You'), h('time', {}, time(m.created_at))),
      h('p', { class: 'bubble' }, m.body))));
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const textarea = h('textarea', { name: 'body', rows: '2', maxlength: '5000', placeholder: t.status === 'resolved' ? 'Reply to reopen this conversation…' : 'Write a reply…', 'aria-label': 'Reply' });
    const form = h('form', { class: 'reply', onsubmit: async (e) => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      const button = form.querySelector('button');
      button.disabled = true;
      err.hidden = true;
      try {
        await api('reply', { thread: t.id, body: text, name: saved.get('zq-connect-name') || null });
        textarea.value = '';
        await openThread(t);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        button.disabled = false;
      }
    } }, textarea, h('button', { class: 'btn icon', type: 'submit', 'aria-label': 'Send reply' }, icon(I.send)));
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
    const pane = h('div', { class: 'pane thread-pane' },
      backBar(t.subject, h('span', { class: `pill status ${t.status}` }, STATUS[t.status] || t.status)),
      state.sent ? h('p', { class: 'notice' }, 'Sent! The Zenatiq team will reply here. You can close this and come back any time.') : null,
      msgs, err, form);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
    return pane;
  }

  function backBar(title, extra) {
    return h('div', { class: 'bar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to all messages', onclick: () => { go('list'); refresh(); } }, icon(I.back)),
      h('b', { class: 'bar-title' }, title), extra || null);
  }
  function field(label, input) { return h('label', { class: 'field' }, h('span', {}, label), input); }
  function go(view) { state.view = view; state.sent = false; render(); schedule(); }

  // --- Data -----------------------------------------------------------------------------
  async function loadThreads() {
    state.threads = (await api('threads')) || [];
    state.unread = state.threads.filter((t) => t.unread).length;
    badge.textContent = String(state.unread);
    badge.hidden = state.unread === 0;
  }
  async function openThread(t, { sent = false } = {}) {
    state.thread = t;
    state.messages = (await api('messages', { thread: t.id })) || [];
    state.view = 'thread';
    state.sent = sent;
    const fresh = state.threads.find((x) => x.id === t.id);
    if (fresh) fresh.unread = false;
    state.unread = state.threads.filter((x) => x.unread).length;
    badge.textContent = String(state.unread);
    badge.hidden = state.unread === 0;
    render();
    schedule();
  }
  async function refresh() {
    try {
      if (state.view === 'thread' && state.thread) {
        const msgs = (await api('messages', { thread: state.thread.id })) || [];
        if (msgs.length !== state.messages.length) { state.messages = msgs; render(); }
        await loadThreads();
        const current = state.threads.find((t) => t.id === state.thread.id);
        if (current && current.status !== state.thread.status) { state.thread = current; render(); }
      } else if (state.view === 'list') {
        await loadThreads();
        render();
      }
    } catch (ex) {
      state.error = ex.code === 'bad_key' ? BAD_KEY : ex.message;
      render();
    }
  }

  // Check for replies: often while open, rarely while closed, never in a hidden tab.
  let timer;
  function schedule() {
    clearTimeout(timer);
    const wait = !state.open ? 60000 : state.view === 'thread' ? 8000 : state.view === 'list' ? 15000 : 0;
    if (wait) timer = setTimeout(async () => { if (!document.hidden && !state.error) await refresh(); schedule(); }, wait);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.open) refresh(); });

  // --- Start -----------------------------------------------------------------------------
  (async () => {
    render();
    body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      if (!key) throw Object.assign(new Error('This Contact with Zenatiq link is missing its key. Please let Zenatiq know.'), { code: 'nokey' });
      const info = await api('info');
      state.project = info?.project_name || '';
      titleSub.textContent = state.project ? `For ${state.project}` : 'We usually reply within a day';
      await loadThreads();
    } catch (ex) {
      state.error = ex.code === 'bad_key' ? BAD_KEY : ex.message;
    }
    render();
    schedule();
  })();

  function css() {
    return `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
[hidden]{display:none!important}
svg{width:18px;height:18px;flex:none}
a{color:#b00500}
button{font:inherit;cursor:pointer}
.wrap{color:#18181b;font-size:14px;line-height:1.5}
.launcher{position:fixed;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;padding:8px 16px 8px 8px;border:0;border-radius:999px;background:#0d0d0f;color:#fff;font-weight:600;font-size:14px;box-shadow:0 14px 34px -12px rgba(0,0,0,.5);transition:transform .15s}
.launcher:hover{transform:translateY(-2px)}
.launcher img{width:30px;height:30px;border-radius:9px}
.right .launcher,.right .panel{right:20px}
.left .launcher,.left .panel{left:20px}
.count{min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#e10600;color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center}
.panel{display:flex;flex-direction:column;overflow:hidden;background:#fff}
.floating .panel{position:fixed;bottom:84px;z-index:2147483000;width:390px;max-width:calc(100vw - 24px);height:620px;max-height:calc(100vh - 110px);border-radius:18px;box-shadow:0 30px 80px -20px rgba(0,0,0,.45)}
.inline .panel{height:640px;border:1px solid #e6e1d8;border-radius:16px}
.page .panel{width:min(760px,calc(100vw - 24px));height:calc(100vh - 48px);margin:24px auto;border:1px solid #e6e1d8;border-radius:18px;box-shadow:0 30px 80px -40px rgba(0,0,0,.35)}
.top{display:flex;align-items:center;gap:12px;padding:16px 18px;background:#0d0d0f;color:#fff;border-bottom:3px solid #e10600}
.logo{width:36px;height:36px;border-radius:10px}
.title{display:grid;flex:1;min-width:0}
.title b{font-size:16px}
.sub{color:#b5b0a7;font-size:12.5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.icon-btn{display:inline-grid;place-items:center;width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:inherit}
.icon-btn:hover{background:rgba(127,127,127,.15)}
.icon-btn:focus-visible,.btn:focus-visible,.thread:focus-visible,input:focus-visible,textarea:focus-visible,.cat input:focus-visible+span{outline:3px solid #e10600;outline-offset:2px}
.body{flex:1;min-height:0;overflow-y:auto;background:#f7f5f1}
.foot{padding:8px 12px;border-top:1px solid #e6e1d8;background:#fff;color:#6a655e;font-size:12px;text-align:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border:0;border-radius:10px;background:#e10600;color:#fff;font-weight:600}
.btn:hover{background:#b00500}
.btn:disabled{opacity:.6;cursor:not-allowed}
.btn.ghost{background:#fff;color:#18181b;border:1px solid #d9d2c6}
.btn.wide{width:100%}
.btn.icon{width:44px;padding:0;flex:none}
.intro{display:grid;gap:12px;padding:18px;background:#fff;border-bottom:1px solid #e6e1d8}
.intro p{color:#3d3a36}
.intro .btn{justify-self:start}
.threads{list-style:none;padding:10px}
.thread{display:grid;gap:6px;width:100%;padding:12px 14px;margin-bottom:8px;border:1px solid #e6e1d8;border-radius:12px;background:#fff;color:inherit;text-align:left}
.thread:hover{border-color:#d9d2c6}
.thread.unread{border-color:#f3c3bf;box-shadow:inset 3px 0 0 #e10600}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.row b{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row time{flex:none;color:#6a655e;font-size:12px}
.tags{justify-content:flex-start;flex-wrap:wrap}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;background:#efeef2;color:#55555f;font-size:11.5px;font-weight:700}
.pill.bug,.pill.open{background:#fde4e2;color:#b00500}
.pill.update{background:#e6effc;color:#1f5fbf}
.pill.question,.pill.in_progress{background:#fdf1dc;color:#9a5b00}
.pill.resolved{background:#e2f5e9;color:#13753a}
.new{color:#e10600;font-size:12px;font-weight:700}
.empty{display:grid;justify-items:center;gap:10px;padding:40px 24px;color:#6a655e;text-align:center}
.empty svg{width:32px;height:32px;color:#d9d2c6}
.empty.small{padding:28px 20px}
.strong{color:#18181b;font-weight:600}
.pane{display:flex;flex-direction:column;min-height:100%}
.bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-bottom:1px solid #e6e1d8}
.bar-title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:15px}
.form{display:grid;gap:14px;padding:16px 18px 20px}
.cats{display:grid;grid-template-columns:1fr 1fr;gap:8px;border:0}
.cats legend{margin-bottom:8px;font-weight:600;font-size:13px}
.cat{position:relative;display:flex}
.cat input{position:absolute;opacity:0;inset:0;cursor:pointer}
.cat span{flex:1;padding:9px 10px;border:1.5px solid #e6e1d8;border-radius:10px;background:#fff;font-size:13px;font-weight:600;text-align:center}
.cat input:checked+span{border-color:#0d0d0f;background:#0d0d0f;color:#fff}
.field{display:grid;gap:5px}
.field span{font-weight:600;font-size:13px}
input,textarea{width:100%;padding:10px 12px;border:1px solid #d9d2c6;border-radius:10px;background:#fff;color:#18181b;font-size:14px;line-height:1.45}
textarea{resize:vertical}
input:focus,textarea:focus{outline:none;border-color:#0d0d0f}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.error{padding:9px 12px;border-radius:10px;background:#fde4e2;color:#b00500;font-weight:600;font-size:13px;margin:0 12px}
.form .error{margin:0}
.notice{margin:12px 12px 0;padding:10px 12px;border-radius:10px;background:#e2f5e9;color:#13753a;font-size:13px;font-weight:600}
.thread-pane{height:100%}
.msgs{display:grid;align-content:start;gap:12px;flex:1;min-height:0;padding:16px 14px;overflow-y:auto}
.msg{display:grid;gap:4px;max-width:85%}
.msg.client{justify-self:end}
.meta{display:flex;flex-wrap:wrap;gap:8px;color:#6a655e;font-size:11.5px}
.msg.client .meta{justify-content:flex-end}
.meta b{color:#18181b}
.bubble{padding:10px 13px;border-radius:4px 14px 14px 14px;background:#0d0d0f;color:#f3f1ed;white-space:pre-wrap;word-wrap:break-word}
.msg.client .bubble{border:1px solid #e6e1d8;border-radius:14px 4px 14px 14px;background:#fff;color:#18181b}
.reply{position:sticky;bottom:0;display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e6e1d8}
.reply textarea{min-height:44px;max-height:140px}
.spinner{width:28px;height:28px;border:3px solid #e6e1d8;border-top-color:#e10600;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:480px){
  .floating .panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}
  .launcher span:not(.count){display:none}
  .launcher{padding:8px}
  .is-open .launcher{display:none}
  .two,.cats{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;
  }
})();
