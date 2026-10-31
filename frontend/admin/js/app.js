// Zenatiq admin portal: start-up, sign-in, layout, page routing and live updates.
import { html, icon, avatar, friendly, toast, LABELS } from './lib.js';
import * as db from './data.js';

const root = document.getElementById('app');
// The local demo (npm run dev without a database) works on sample data. The server says when,
// along with the sample account to fill in on the sign-in page.
let demo = null;

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  projects: () => import('./views/projects.js'),
  project: () => import('./views/project.js'),
  inbox: () => import('./views/inbox.js'),
  tasks: () => import('./views/tasks.js'),
  clients: () => import('./views/clients.js'),
  team: () => import('./views/team.js'),
  payments: () => import('./views/payments.js'),
  activity: () => import('./views/activity.js'),
};

const NAV = [
  { route: 'dashboard', href: '#/', label: 'Dashboard', icon: 'a-grid' },
  { route: 'projects', href: '#/projects', label: 'Projects', icon: 'a-folder' },
  { route: 'inbox', href: '#/inbox', label: 'Contact with Zenatiq', icon: 'a-inbox', badge: true },
  { route: 'tasks', href: '#/tasks', label: 'Tasks', icon: 'a-tasks' },
  { route: 'clients', href: '#/clients', label: 'Clients', icon: 'a-building' },
  { route: 'team', href: '#/team', label: 'Team', icon: 'a-users' },
  { route: 'payments', href: '#/payments', label: 'Payments', icon: 'a-wallet', adminOnly: true },
  { route: 'activity', href: '#/activity', label: 'Activity', icon: 'clock' },
];

let me;
const current = { token: null, mod: null, ctx: null };

start().catch((err) => {
  console.error(err);
  root.innerHTML = String(html`<div class="auth"><div class="auth__card"><h1>The portal couldn't start</h1>
    <p>${friendly(err)}</p><a class="btn btn--primary" href="">Try again</a></div></div>`);
});

async function start() {
  const status = await db.request('GET', '/api/auth');
  if (!status.configured) return renderSetup(status.missing);
  demo = status.demo || null;
  if (!status.me) return renderSignIn();
  await enter(status.me);
}

// Signs in with { email, password }. A temporary password first asks for their own one.
async function signIn(body) {
  try {
    const answer = await db.request('POST', '/api/auth', { op: 'signin', ...body });
    if (answer.mustChange) return renderNewPassword(body);
    await enter(answer.me);
  } catch (err) {
    showSignInError(friendly(err));
  }
}

async function signOut() {
  await db.request('POST', '/api/auth', { op: 'signout' }).catch(() => {});
  location.reload();
}

async function enter(member) {
  root.innerHTML = '<div class="boot"><span class="spinner"></span></div>';
  me = member;
  await db.store.load();
  me = db.store.member(member.id) || member;

  renderShell();
  window.addEventListener('hashchange', route);
  await route();
  db.subscribe(onLive);
  refreshBadges();
}

const isAdmin = () => me && ['owner', 'admin'].includes(me.role);

// --- Screens before the portal ------------------------------------------------
function renderSetup(missing = []) {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>Almost there</h1>
      <p>The admin portal isn't connected to its database yet. In Vercel, add
        ${missing.map((name, i) => html`${i ? (i === missing.length - 1 ? ' and ' : ', ') : ''}<code>${name}</code>`)}
        under Settings → Environment Variables, then redeploy. The steps are in <code>ADMIN-SETUP.md</code>.</p>
    </div></div>`);
}

function renderSignIn() {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>Admin portal</h1>
      <p>Projects, tasks, payments and client messages for the Zenatiq team, all in one place.</p>
      <p class="auth__error" role="alert" hidden></p>
      <form class="auth__form" data-signin>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required maxlength="200" value="${demo?.email || ''}"></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required maxlength="200" value="${demo?.password || ''}"></label>
        <button class="btn btn--primary" type="submit">Sign in</button>
      </form>
      <p class="auth__fine">An owner or admin adds you to the team and you get your password by email. Forgot it? Ask them to send you a new one.</p>
      ${demo ? html`<p class="auth__demo">Demo mode: sample data on this computer only. The other sample people sign in with the same password.</p>` : ''}
    </div></div>`);
  whenSent(root.querySelector('[data-signin]'), (fd) => signIn({ email: fd.get('email'), password: fd.get('password') }));
}

// First sign-in with a temporary password: they choose their own before going in.
function renderNewPassword({ email, password }) {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>Choose your password</h1>
      <p>You signed in with a temporary password. Choose your own to finish. Use at least 10 characters.</p>
      <p class="auth__error" role="alert" hidden></p>
      <form class="auth__form" data-new-password>
        <input name="email" type="email" autocomplete="username" value="${email}" hidden>
        <label class="field"><span>New password</span><input class="input" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
        <label class="field"><span>New password again</span><input class="input" name="again" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
        <button class="btn btn--primary" type="submit">Save and sign in</button>
      </form>
    </div></div>`);
  whenSent(root.querySelector('[data-new-password]'), (fd) => {
    if (fd.get('newPassword') !== fd.get('again')) return showSignInError("The two passwords don't match.");
    return signIn({ email, password, newPassword: fd.get('newPassword') });
  });
}

// Runs send(formData) when the form is sent, with its button off until that's done.
function whenSent(form, send) {
  ([...form.querySelectorAll('input:not([hidden])')].find((input) => !input.value) || form.querySelector('[type=submit]')).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try { await send(new FormData(form)); } finally { button.disabled = false; }
  });
}

const showSignInError = (message) => {
  const box = root.querySelector('.auth__error');
  if (box) Object.assign(box, { textContent: message, hidden: false });
};

// --- Portal layout --------------------------------------------------------------
function renderShell() {
  root.innerHTML = String(html`
    ${demo ? html`<div class="demo-bar">Demo mode · sample data on this computer only ·
      <button type="button" data-shell="reset-demo">Reset sample data</button></div>` : ''}
    <div class="app">
      <aside class="side" id="side" aria-label="Portal">
        <a class="side__brand" href="#/"><img src="/assets/zenatiq-logo-light.png" alt="Zenatiq Solutions" width="519" height="150"><span>Admin</span></a>
        <nav class="side__nav">
          ${NAV.filter((n) => !n.adminOnly || isAdmin()).map((n) => html`
            <a href="${n.href}" data-route="${n.route}">${icon(n.icon)}<span>${n.label}</span>
              ${n.badge ? html`<b class="badge" data-badge hidden>0</b>` : ''}</a>`)}
        </nav>
        <div class="side__foot">
          <button type="button" class="side__alerts" data-shell="alerts">${icon('a-bell')}<span data-alerts-label>Desktop alerts</span></button>
          <div class="side__me">
            ${avatar(me)}
            <div class="side__who"><b>${me.full_name}</b><small>${LABELS.role[me.role]}</small></div>
            <button class="icon-btn icon-btn--dark" type="button" data-shell="signout" aria-label="Sign out" title="Sign out">${icon('a-logout')}</button>
          </div>
        </div>
      </aside>
      <div class="scrim" data-shell="close-nav"></div>
      <div class="main">
        <div class="mtop">
          <button class="icon-btn" type="button" data-shell="open-nav" aria-label="Open menu">${icon('menu')}</button>
          <a href="#/"><img src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150"></a>
          <b class="badge" data-badge hidden>0</b>
        </div>
        <main class="view" id="view" tabindex="-1"></main>
      </div>
    </div>`);

  updateAlertsLabel();
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-shell]');
    if (!btn) return;
    const action = btn.dataset.shell;
    if (action === 'signout') signOut();
    if (action === 'open-nav') document.body.classList.add('nav-open');
    if (action === 'close-nav') closeNav();
    if (action === 'reset-demo') {
      try { await db.resetDemo(); location.reload(); } catch (err) { toast(friendly(err), 'error'); }
    }
    if (action === 'alerts') {
      if (!('Notification' in window)) return toast('This browser does not support desktop alerts.', 'warn');
      const result = await Notification.requestPermission();
      toast(result === 'granted' ? "You'll get a desktop alert for new client messages." : 'Desktop alerts are blocked in this browser.');
      updateAlertsLabel();
    }
  });
}

const closeNav = () => document.body.classList.remove('nav-open');
function updateAlertsLabel() {
  const label = root.querySelector('[data-alerts-label]');
  if (label && 'Notification' in window) label.textContent = Notification.permission === 'granted' ? 'Desktop alerts on' : 'Turn on desktop alerts';
}

// --- Routing ------------------------------------------------------------------------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  let name = parts[0] || 'dashboard';
  let params = parts.slice(1);
  if (name === 'projects' && params[0] && params[0] !== 'new') name = 'project';
  if (!VIEWS[name] || (name === 'payments' && !isAdmin())) { name = 'dashboard'; params = []; }

  const navName = name === 'project' ? 'projects' : name;
  root.querySelectorAll('.side__nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.route === navName));
  closeNav();

  const view = document.getElementById('view');
  const token = Symbol(name);
  const sameView = current.ctx && current.ctx.name === name && current.ctx.params[0] === params[0];
  current.token = token;
  if (!sameView) view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const mod = await VIEWS[name]();
    if (current.token !== token) return;
    const ctx = {
      name, params, el: view, me, demo,
      isAdmin: isAdmin(),
      store: db.store,
      db,
      title: 'Admin',
      go: (hash) => { location.hash = hash; },
      refreshBadges,
      isCurrent: () => current.token === token,
    };
    current.mod = mod;
    current.ctx = ctx;
    await mod.render(ctx);
    if (current.token !== token) return;
    document.title = `${ctx.title} · Zenatiq Admin`;
    if (!sameView) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
  } catch (err) {
    console.error(err);
    if (current.token !== token) return;
    view.innerHTML = String(html`<div class="empty">${icon('a-folder')}<h3>This page couldn't load</h3><p>${friendly(err)}</p>
      <a class="btn btn--primary" href="">Reload</a></div>`);
  }
}

// --- Live updates ------------------------------------------------------------------
let badgeTimer;
async function refreshBadges() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    try {
      const n = await db.threads.unreadCount();
      root.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = n; b.hidden = n === 0; });
    } catch { /* badge is best-effort */ }
  }, 150);
}

async function onLive(table, payload) {
  if (table === 'threads' || table === 'messages') refreshBadges();
  if (table === 'messages' && payload.eventType === 'INSERT' && payload.new?.sender === 'client') {
    try {
      const thread = await db.threads.get(payload.new.thread_id);
      const project = thread && db.store.project(thread.project_id);
      const title = `New message · ${project?.name || 'a client'}`;
      toast(`${title}: ${thread?.subject || ''}`, 'info');
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, { body: payload.new.body.slice(0, 140), icon: '/assets/zenatiq-icon-192.png', tag: payload.new.thread_id });
        n.onclick = () => { window.focus(); location.hash = `#/inbox/${payload.new.thread_id}`; };
      }
    } catch { /* alerts are best-effort */ }
  }
  if (current.mod?.onLive && current.ctx) current.mod.onLive(current.ctx, table, payload);
}
