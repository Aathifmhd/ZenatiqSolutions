// Zenatiq admin portal: start-up, sign-in, layout, page routing and live updates.
import { html, raw, icon, avatar, friendly, toast, LABELS } from './lib.js';
import * as db from './data.js';

const cfg = window.ZENATIQ_CONFIG || {};
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
// Demo mode (sample data in this browser only) is limited to local previews.
const demo = isLocal && (new URLSearchParams(location.search).has('demo') || !configured);
const root = document.getElementById('app');

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

const GOOGLE_G = raw(`<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`);

let sb;
let me;
const current = { token: null, mod: null, ctx: null };

start().catch((err) => {
  console.error(err);
  root.innerHTML = String(html`<div class="auth"><div class="auth__card"><h1>The portal couldn't start</h1>
    <p>${friendly(err)}</p><a class="btn btn--primary" href="">Try again</a></div></div>`);
});

async function start() {
  if (!configured && !demo) return renderSetup();

  if (demo) {
    const { createDemoClient } = await import('./demo.js');
    sb = createDemoClient();
  } else {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  db.setClient(sb);

  const url = new URL(location.href);
  const oauthError = url.searchParams.get('error_description');
  const { data: { session } } = await sb.auth.getSession();
  if (url.searchParams.has('code') || url.searchParams.has('error')) {
    ['code', 'error', 'error_code', 'error_description', 'state'].forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  if (!session) return renderSignIn(oauthError);

  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });
  await enter(session);
}

async function enter(session) {
  root.innerHTML = '<div class="boot"><span class="spinner"></span></div>';
  await db.store.load();
  const email = (session.user.email || '').toLowerCase();
  me = db.store.team.find((m) => m.email === email && m.active);
  if (!me) return renderNoAccess(email);

  renderShell();
  window.addEventListener('hashchange', route);
  await route();
  db.subscribe(onLive);
  refreshBadges();
}

const isAdmin = () => me && ['owner', 'admin'].includes(me.role);

// --- Screens before the portal ------------------------------------------------
function renderSetup() {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>Almost there</h1>
      <p>The admin portal isn't connected to its database yet. Add your Supabase project URL and anon key to
        <code>public/connect/config.js</code>, then deploy. The steps are in <code>ADMIN-SETUP.md</code>.</p>
    </div></div>`);
}

function renderSignIn(error) {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>Admin portal</h1>
      <p>Projects, tasks, payments and client messages for the Zenatiq team, all in one place.</p>
      ${error ? html`<p class="auth__error" role="alert">${error}</p>` : ''}
      <button class="btn btn--google" type="button" data-shell="google">${GOOGLE_G}<span>Continue with Google</span></button>
      <p class="auth__fine">Only people an owner or admin has added to the team can get in.</p>
      ${demo ? html`<p class="auth__demo">Demo mode: sample data, stored only in this browser.</p>` : ''}
    </div></div>`);
  const button = root.querySelector('[data-shell="google"]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const redirectTo = location.origin + location.pathname + (demo ? '?demo' : '');
    const { error: err } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (err) { toast(friendly(err), 'error'); button.disabled = false; }
  });
}

function renderNoAccess(email) {
  root.innerHTML = String(html`
    <div class="auth"><div class="auth__card">
      <img class="auth__logo" src="/assets/zenatiq-logo.png" alt="Zenatiq Solutions" width="519" height="150">
      <h1>You're not on the team yet</h1>
      <p>You're signed in as <b>${email}</b>, but this Google account isn't on the Zenatiq team.
        Ask an owner or admin to add it on the Team page, then sign in again.</p>
      <button class="btn btn--primary" type="button" data-shell="signout">${icon('a-logout')}Sign out</button>
    </div></div>`);
  root.querySelector('[data-shell="signout"]').addEventListener('click', () => db.signOut());
}

// --- Portal layout --------------------------------------------------------------
function renderShell() {
  root.innerHTML = String(html`
    ${demo ? html`<div class="demo-bar">Demo mode · sample data saved in this browser only ·
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
    if (action === 'signout') db.signOut();
    if (action === 'open-nav') document.body.classList.add('nav-open');
    if (action === 'close-nav') closeNav();
    if (action === 'reset-demo') { localStorage.removeItem('zenatiq-demo-db'); location.reload(); }
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
