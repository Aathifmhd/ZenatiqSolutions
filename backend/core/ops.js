// Zenatiq admin: every rule for reading and changing data. The API routes (routes/portal.js and
// routes/connect.js) run it against MongoDB, and the local demo and the tests run it against
// core/memory.js, so all of them behave the same. Nothing here trusts the caller: each operation
// checks the signed-in member's role and only accepts the fields it expects.
//
// `store.col(name)` must offer this part of the MongoDB collection API: find(filter, { sort, limit }),
// findOne, insertOne, updateOne(filter, { $set }, { upsert }), updateMany, deleteOne, deleteMany and
// countDocuments. Filters use plain values, $in, $ne, $lt, $lte, $gt and $gte.
import { savePassword, temporaryPassword } from '../passwords.js';
import { passwordEmail } from '../mail.js';
import { repoFrom } from '../github.js';

export class OpError extends Error {
  constructor(message, code = 'invalid', status = 400, extra = undefined) {
    super(message);
    this.name = 'OpError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const forbidden = (message = "You don't have permission to do that.") => new OpError(message, 'forbidden', 403);
const missing = (what) => new OpError(`${what} was not found. It may have been deleted.`, 'not_found', 404);
const OWNERS_ONLY = 'Only an owner can add, change or remove an owner.';

export const LISTS = {
  role: ['owner', 'admin', 'member'],
  type: ['website', 'online_shop', 'pos', 'mobile_app', 'ui_ux', 'other'],
  status: ['lead', 'planning', 'in_progress', 'review', 'live', 'maintenance', 'on_hold', 'completed'],
  task: ['todo', 'in_progress', 'review', 'done'],
  priority: ['low', 'medium', 'high', 'urgent'],
  category: ['bug', 'update', 'question', 'other'],
  thread: ['open', 'in_progress', 'resolved'],
  method: ['cash', 'bank_transfer', 'card', 'cheque', 'online', 'other'],
};

// Words used in the activity log.
const LABEL = {
  todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done', lead: 'Lead', planning: 'Planning',
  live: 'Live', maintenance: 'Maintenance', on_hold: 'On hold', completed: 'Completed', open: 'Open', resolved: 'Resolved',
  bug: 'bug report', update: 'update request', question: 'question', other: 'message',
};
const label = (value) => LABEL[value] ?? value ?? '';
const money = (amount, currency) =>
  `${currency || 'LKR'} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- Ids and time ------------------------------------------------------------------------
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const newConnectKey = () => hex(32);
// Activity ids sort in time order, so "Show older" can page with $lt.
let sequence = 0;
export const makeActivityId = (ms = Date.now()) =>
  `${ms.toString(36).padStart(9, '0')}${(sequence++ % 1296).toString(36).padStart(2, '0')}${hex(4)}`;

// --- Checking input ------------------------------------------------------------------------
const has = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

function obj(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpError('Something was missing from the request.');
  return value;
}
// Ids must be plain strings, so nothing like {"$ne": null} ever reaches a database filter.
function idOf(value, what = 'That item') {
  if (typeof value !== 'string' || !ID.test(value)) throw missing(what);
  return value;
}
function text(value, max, name, { required = false } = {}) {
  if (value != null && typeof value !== 'string' && typeof value !== 'number') throw new OpError(`${name} must be text.`);
  const s = value == null ? '' : String(value).trim();
  if (!s) {
    if (required) throw new OpError(`${name} is required.`);
    return null;
  }
  if (s.length > max) throw new OpError(`${name} is too long. Keep it under ${max} characters.`);
  return s;
}
function pick(value, list, name, fallback) {
  if ((value == null || value === '') && fallback !== undefined) return fallback;
  if (!list.includes(value)) throw new OpError(`${name} isn't one of the options.`);
  return value;
}
function day(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new OpError(`${name} must be a date.`);
  }
  return value;
}
function flag(value, name) {
  if (typeof value !== 'boolean') throw new OpError(`${name} must be on or off.`);
  return value;
}
function amount(value, name, { allowZero }) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n >= 1e12) {
    throw new OpError(allowZero ? `${name} must be a number.` : `${name} must be more than zero.`);
  }
  return Math.round(n * 100) / 100;
}
function link(value, name) {
  const s = text(value, 2000, name);
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw new OpError(`${name} must start with http:// or https://`);
  return s;
}
function emailOf(value, name) {
  const s = text(value, 200, name, { required: true }).toLowerCase();
  if (!EMAIL.test(s)) throw new OpError(`${s} doesn't look like an email address.`);
  return s;
}
function currencyOf(value) {
  const s = text(value, 5, 'Currency');
  if (s && !/^[A-Za-z]+$/.test(s)) throw new OpError('Currency must be letters, like LKR.');
  return (s || 'LKR').toUpperCase();
}
function position(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new OpError('Position must be a number.');
  return value;
}
const changedKeys = (before, after) => Object.keys(after).filter((k) => (after[k] ?? null) !== (before[k] ?? null));

// --- Writing history -------------------------------------------------------------------------
function writers(store) {
  const col = (name) => store.col(name);
  return {
    // The activity log: written here only, never edited.
    log(me, projectId, action, summary, { adminOnly = false, by = null } = {}) {
      return col('activity').insertOne({
        id: makeActivityId(), project_id: projectId ?? null, actor_member_id: me?.id ?? null,
        actor_label: by || me?.full_name || 'System', action, summary: summary.slice(0, 500),
        admin_only: adminOnly, created_at: now(),
      });
    },
    // A short note of what changed, so open portals can refresh themselves (see "poll").
    changed(table, projectId, row = {}, op = 'UPDATE') {
      return col('changes').insertOne({ id: uuid(), at: now(), table, op, project_id: projectId ?? null, row });
    },
  };
}

// Who backend/member.js acts as: it runs on a computer with the database password, needs no
// sign-in, and is how the first owners get in. The API never acts as SYSTEM.
export const SYSTEM = Object.freeze({ id: null, role: 'owner', full_name: 'System', active: true });

const isAdmin = (me) => me.role === 'owner' || me.role === 'admin';
function needAdmin(me) {
  if (!isAdmin(me)) throw forbidden();
}

const CLIENT_FIELDS = {
  name: [200, 'Business name', true], contact_name: [120, 'Contact person'], phone: [40, 'Phone'],
  email: [200, 'Email'], address: [300, 'Address'], notes: [5000, 'Notes'],
};
const PROJECT_DETAILS = ['name', 'client_id', 'type', 'live_url', 'admin_url', 'repo_url', 'description', 'start_date', 'due_date'];

// --- The admin portal ------------------------------------------------------------------------------
// mailer sends one email (see mail.js); adding someone or sending a new password uses it.
// github reads commit histories (see github.js) for the projects' Activity tabs.
export function createPortal(store, { mailer, github } = {}) {
  const col = (name) => store.col(name);
  const find = (name, filter = {}, options = {}) => col(name).find(filter, options);
  const one = (name, filter) => col(name).findOne(filter);
  const { log, changed } = writers(store);

  // Gives a member a new temporary password and emails it to them. The password is only saved
  // once the email has gone, so a failed email never locks anyone out.
  // Returns { emailed: true }, or { emailed: false } when the email was only printed (on your computer).
  async function issuePassword(member, me, { welcome }) {
    if (!mailer) throw new OpError("Email isn't set up, so the password can't be sent.", 'email_not_configured', 503);
    const password = temporaryPassword();
    const { sent } = await mailer(passwordEmail({ member, password, by: me.id ? me.full_name : null, welcome }));
    await savePassword(store, member.id, password, { temporary: true });
    return { emailed: sent };
  }

  async function need(name, id, what) {
    const doc = await one(name, { id: idOf(id, what) });
    if (!doc) throw missing(what);
    return doc;
  }
  async function optionalRef(name, id, what) {
    if (id == null || id === '') return null;
    return (await need(name, id, what)).id;
  }
  const otherOwner = (id) => one('team_members', { role: 'owner', active: true, id: { $ne: id } });
  const byName = (key) => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));

  function clientFields(r, creating) {
    const out = {};
    for (const [key, [max, name, required]] of Object.entries(CLIENT_FIELDS)) {
      if (creating || has(r, key)) out[key] = text(r[key], max, name, { required });
    }
    if (out.email && !EMAIL.test(out.email)) throw new OpError(`${out.email} doesn't look like an email address.`);
    return out;
  }

  async function projectFields(r, creating) {
    const out = {};
    const set = (key, check) => { if (creating || has(r, key)) out[key] = check(r[key]); };
    set('name', (v) => text(v, 200, 'Project name', { required: true }));
    set('type', (v) => pick(v, LISTS.type, 'Type', 'website'));
    set('status', (v) => pick(v, LISTS.status, 'Stage', 'planning'));
    set('live_url', (v) => link(v, 'Live website'));
    set('admin_url', (v) => link(v, "Client's admin panel"));
    set('repo_url', (v) => link(v, 'Code repository'));
    set('description', (v) => text(v, 5000, 'Notes'));
    set('start_date', (v) => day(v, 'Start date'));
    set('due_date', (v) => day(v, 'Due date'));
    if (creating || has(r, 'client_id')) out.client_id = await optionalRef('clients', r.client_id, 'That client');
    if (!creating && has(r, 'connect_enabled')) out.connect_enabled = flag(r.connect_enabled, 'Contact with Zenatiq');
    return out;
  }

  async function taskFields(r, creating) {
    const out = {};
    const set = (key, check) => { if (creating || has(r, key)) out[key] = check(r[key]); };
    set('title', (v) => text(v, 300, 'Task', { required: true }));
    set('description', (v) => text(v, 5000, 'Details'));
    set('status', (v) => pick(v, LISTS.task, 'Status', 'todo'));
    set('priority', (v) => pick(v, LISTS.priority, 'Priority', 'medium'));
    set('due_date', (v) => day(v, 'Due date'));
    if (has(r, 'position')) out.position = position(r.position);
    if (creating || has(r, 'assignee_id')) out.assignee_id = await optionalRef('team_members', r.assignee_id, 'That team member');
    return out;
  }

  const ops = {
    // Lists almost every page needs.
    async load() {
      const [team, clients, projects] = await Promise.all([
        find('team_members'), find('clients'), find('projects', {}, { sort: { updated_at: -1 } }),
      ]);
      return { team: team.sort(byName('full_name')), clients: clients.sort(byName('name')), projects };
    },

    // --- Team ---
    // Adds someone and emails them their username and a temporary password. If the email fails,
    // they're still added and invite.problem says why; "Send a new temporary password" tries again.
    async 'team.add'(me, { row }) {
      needAdmin(me);
      const r = obj(row);
      const doc = {
        id: uuid(), email: emailOf(r.email, 'Email'), full_name: text(r.full_name, 120, 'Full name', { required: true }),
        role: pick(r.role, LISTS.role, 'Role', 'member'), job_title: text(r.job_title, 80, 'Job title'),
        phone: text(r.phone, 40, 'Phone'), active: true, created_at: now(),
      };
      if (doc.role === 'owner' && me.role !== 'owner') throw forbidden(OWNERS_ONLY);
      if (await one('team_members', { email: doc.email })) throw new OpError('That email is already on the team.', 'duplicate', 409);
      await col('team_members').insertOne(doc);
      await log(me, null, 'team.added', `Added ${doc.full_name} to the team as ${doc.role}`);
      let invite;
      try {
        invite = await issuePassword(doc, me, { welcome: true });
      } catch (err) {
        invite = { emailed: false, problem: err.message };
      }
      return { ...doc, invite };
    },
    // A new temporary password, emailed to them. Their old password and sessions stop working.
    async 'team.sendPassword'(me, { id }) {
      needAdmin(me);
      const member = await need('team_members', id, 'That team member');
      if (member.role === 'owner' && me.role !== 'owner') throw forbidden(OWNERS_ONLY);
      if (member.id === me.id) throw new OpError('To change your own password, use "Change my password".');
      if (!member.active) throw new OpError(`${member.full_name} has no access. Give them access again first.`);
      const result = await issuePassword(member, me, { welcome: false });
      await col('sessions').deleteMany({ member_id: member.id });
      await log(me, null, 'team.password', `Sent ${member.full_name} a new temporary password`);
      return result;
    },
    async 'team.update'(me, { id, patch }) {
      const old = await need('team_members', id, 'That team member');
      const p = obj(patch);
      const next = { ...old };
      if (has(p, 'full_name')) next.full_name = text(p.full_name, 120, 'Full name', { required: true });
      if (has(p, 'job_title')) next.job_title = text(p.job_title, 80, 'Job title');
      if (has(p, 'phone')) next.phone = text(p.phone, 40, 'Phone');
      if (has(p, 'email')) next.email = emailOf(p.email, 'Email');
      if (has(p, 'role')) next.role = pick(p.role, LISTS.role, 'Role');
      if (has(p, 'active')) next.active = flag(p.active, 'Access');
      if (!isAdmin(me)) {
        if (old.id !== me.id) throw forbidden();
        if (next.role !== old.role || next.active !== old.active || next.email !== old.email) {
          throw forbidden('Only owners and admins can change roles, emails or access.');
        }
      }
      if ((next.role === 'owner' || old.role === 'owner') && me.role !== 'owner') throw forbidden(OWNERS_ONLY);
      if (old.role === 'owner' && old.active && (next.role !== 'owner' || !next.active) && !(await otherOwner(old.id))) {
        throw new OpError('The team needs at least one active owner.', 'last_owner', 409);
      }
      if (next.email !== old.email && (await one('team_members', { email: next.email }))) {
        throw new OpError('That email is already on the team.', 'duplicate', 409);
      }
      const keys = changedKeys(old, next);
      if (keys.length) await col('team_members').updateOne({ id: old.id }, { $set: Object.fromEntries(keys.map((k) => [k, next[k]])) });
      if (next.role !== old.role) await log(me, null, 'team.role', `Changed ${next.full_name}'s role to ${next.role}`);
      if (next.active !== old.active) {
        await log(me, null, 'team.access', next.active ? `Gave ${next.full_name} access again` : `Removed portal access for ${next.full_name}`);
      }
      return next;
    },
    async 'team.remove'(me, { id }) {
      needAdmin(me);
      const old = await need('team_members', id, 'That team member');
      if (old.role === 'owner' && me.role !== 'owner') throw forbidden(OWNERS_ONLY);
      if (old.role === 'owner' && old.active && !(await otherOwner(old.id))) {
        throw new OpError('The team needs at least one active owner.', 'last_owner', 409);
      }
      await col('team_members').deleteOne({ id: old.id });
      const clear = (name, field) => col(name).updateMany({ [field]: old.id }, { $set: { [field]: null } });
      await Promise.all([
        col('project_members').deleteMany({ member_id: old.id }),
        col('sessions').deleteMany({ member_id: old.id }),
        col('credentials').deleteMany({ member_id: old.id }),
        clear('tasks', 'assignee_id'), clear('tasks', 'created_by'), clear('threads', 'assignee_id'),
        clear('messages', 'member_id'), clear('payments', 'recorded_by'), clear('activity', 'actor_member_id'),
      ]);
      await log(me, null, 'team.removed', `Removed ${old.full_name} from the team`);
      return null;
    },

    // --- Clients ---
    async 'clients.add'(me, { row }) {
      const doc = { id: uuid(), ...clientFields(obj(row), true), created_at: now() };
      await col('clients').insertOne(doc);
      await log(me, null, 'client.added', `Added client ${doc.name}`);
      return doc;
    },
    async 'clients.update'(me, { id, patch }) {
      const old = await need('clients', id, 'That client');
      const fields = clientFields(obj(patch), false);
      if (Object.keys(fields).length) await col('clients').updateOne({ id: old.id }, { $set: fields });
      return { ...old, ...fields };
    },
    async 'clients.remove'(me, { id }) {
      needAdmin(me);
      const old = await need('clients', id, 'That client');
      await col('clients').deleteOne({ id: old.id });
      await col('projects').updateMany({ client_id: old.id }, { $set: { client_id: null } });
      await log(me, null, 'client.deleted', `Deleted client ${old.name}`);
      return null;
    },

    // --- Projects ---
    async 'projects.get'(me, { id }) {
      return (await one('projects', { id: idOf(id, 'That project') })) || null;
    },
    async 'projects.add'(me, { row }) {
      const fields = await projectFields(obj(row), true);
      const t = now();
      const doc = { id: uuid(), ...fields, connect_key: newConnectKey(), connect_enabled: true, created_at: t, updated_at: t };
      await col('projects').insertOne(doc);
      await log(me, doc.id, 'project.created', `Created project ${doc.name}`);
      return doc;
    },
    async 'projects.update'(me, { id, patch }) {
      const old = await need('projects', id, 'That project');
      const fields = await projectFields(obj(patch), false);
      const next = { ...old, ...fields, updated_at: now() };
      await col('projects').updateOne({ id: old.id }, { $set: { ...fields, updated_at: next.updated_at } });
      if (next.status !== old.status) {
        await log(me, old.id, 'project.status', `${next.name}: ${label(old.status)} → ${label(next.status)}`);
      } else if (next.connect_enabled !== old.connect_enabled) {
        await log(me, old.id, 'project.connect', `${next.connect_enabled ? 'Turned on' : 'Turned off'} Contact with Zenatiq for ${next.name}`);
      } else if (changedKeys(old, Object.fromEntries(PROJECT_DETAILS.map((k) => [k, next[k]]))).length) {
        await log(me, old.id, 'project.updated', `Updated the details of ${next.name}`);
      }
      return next;
    },
    async 'projects.newKey'(me, { id }) {
      const old = await need('projects', id, 'That project');
      const next = { ...old, connect_key: newConnectKey(), updated_at: now() };
      await col('projects').updateOne({ id: old.id }, { $set: { connect_key: next.connect_key, updated_at: next.updated_at } });
      await log(me, old.id, 'project.key', `Made a new Contact with Zenatiq key for ${old.name}`);
      return next;
    },
    async 'projects.remove'(me, { id }) {
      needAdmin(me);
      const old = await need('projects', id, 'That project');
      await col('projects').deleteOne({ id: old.id });
      await Promise.all([
        ...['project_members', 'threads', 'messages', 'tasks', 'project_finances', 'payments']
          .map((name) => col(name).deleteMany({ project_id: old.id })),
        col('activity').updateMany({ project_id: old.id }, { $set: { project_id: null } }),
      ]);
      await log(me, null, 'project.deleted', `Deleted project ${old.name}`);
      await changed('threads', old.id, {}, 'DELETE');
      await changed('tasks', old.id, {}, 'DELETE');
      return null;
    },
    async 'projects.members'(me, { projectId }) {
      return find('project_members', { project_id: idOf(projectId, 'That project') });
    },
    async 'projects.allMembers'() {
      return find('project_members');
    },
    async 'projects.assign'(me, { projectId, memberId }) {
      const project = await need('projects', projectId, 'That project');
      const member = await need('team_members', memberId, 'That team member');
      if (await one('project_members', { project_id: project.id, member_id: member.id })) {
        throw new OpError('This person is already on the project.', 'duplicate', 409);
      }
      await col('project_members').insertOne({ project_id: project.id, member_id: member.id });
      await log(me, project.id, 'project.member_added', `Added ${member.full_name} to ${project.name}`);
      return null;
    },
    async 'projects.unassign'(me, { projectId, memberId }) {
      const filter = { project_id: idOf(projectId, 'That project'), member_id: idOf(memberId, 'That team member') };
      const { deletedCount } = await col('project_members').deleteOne(filter);
      if (deletedCount) {
        const [project, member] = await Promise.all([one('projects', { id: filter.project_id }), one('team_members', { id: filter.member_id })]);
        if (project && member) await log(me, project.id, 'project.member_removed', `Took ${member.full_name} off ${project.name}`);
      }
      return null;
    },

    // --- Tasks ---
    async 'tasks.list'(me, { projectId, assigneeId } = {}) {
      const filter = {};
      if (projectId != null) filter.project_id = idOf(projectId, 'That project');
      if (assigneeId != null) filter.assignee_id = idOf(assigneeId, 'That team member');
      return find('tasks', filter, { sort: { position: 1 } });
    },
    async 'tasks.add'(me, { row }) {
      const r = obj(row);
      const project = await need('projects', r.project_id, 'That project');
      const fields = await taskFields(r, true);
      const threadId = r.thread_id == null || r.thread_id === '' ? null : (await need('threads', r.thread_id, 'That conversation')).id;
      const t = now();
      const doc = {
        id: uuid(), project_id: project.id, ...fields, position: fields.position ?? Date.now() / 1000,
        thread_id: threadId, created_by: me.id, created_at: t, updated_at: t,
      };
      await col('tasks').insertOne(doc);
      await log(me, project.id, 'task.created', `Added task "${doc.title}"`);
      await changed('tasks', project.id, { id: doc.id }, 'INSERT');
      return doc;
    },
    async 'tasks.update'(me, { id, patch }) {
      const old = await need('tasks', id, 'That task');
      const fields = { ...(await taskFields(obj(patch), false)), updated_at: now() };
      const next = { ...old, ...fields };
      await col('tasks').updateOne({ id: old.id }, { $set: fields });
      if (next.status !== old.status) await log(me, old.project_id, 'task.moved', `Moved "${next.title}" to ${label(next.status)}`);
      if (next.assignee_id !== old.assignee_id) {
        const who = next.assignee_id ? await one('team_members', { id: next.assignee_id }) : null;
        await log(me, old.project_id, 'task.assigned', who ? `Assigned "${next.title}" to ${who.full_name}` : `Unassigned "${next.title}"`);
      }
      await changed('tasks', old.project_id, { id: old.id });
      return next;
    },
    async 'tasks.remove'(me, { id }) {
      const old = await need('tasks', id, 'That task');
      await col('tasks').deleteOne({ id: old.id });
      await log(me, old.project_id, 'task.deleted', `Deleted task "${old.title}"`);
      await changed('tasks', old.project_id, { id: old.id }, 'DELETE');
      return null;
    },

    // --- Client conversations (Contact with Zenatiq) ---
    async 'threads.list'(me, { projectId } = {}) {
      const filter = projectId != null ? { project_id: idOf(projectId, 'That project') } : {};
      return find('threads', filter, { sort: { last_message_at: -1 } });
    },
    async 'threads.get'(me, { id }) {
      return (await one('threads', { id: idOf(id, 'That conversation') })) || null;
    },
    async 'threads.add'(me, { row }) {
      const r = obj(row);
      const project = await need('projects', r.project_id, 'That project');
      const t = now();
      const doc = {
        id: uuid(), project_id: project.id, subject: text(r.subject, 200, 'Subject', { required: true }),
        category: pick(r.category, LISTS.category, 'Type', 'question'), status: 'open', client_name: null, client_contact: null,
        assignee_id: null, unread_by_team: has(r, 'unread_by_team') ? flag(r.unread_by_team, 'Unread') : true,
        unread_by_client: false, last_message_at: t, created_at: t,
      };
      await col('threads').insertOne(doc);
      await log(me, project.id, 'thread.created', `Started a conversation "${doc.subject}" for ${project.name}`);
      await changed('threads', project.id, { id: doc.id }, 'INSERT');
      return doc;
    },
    async 'threads.update'(me, { id, patch }) {
      const old = await need('threads', id, 'That conversation');
      const p = obj(patch);
      const fields = {};
      if (has(p, 'status')) fields.status = pick(p.status, LISTS.thread, 'Status');
      if (has(p, 'assignee_id')) fields.assignee_id = await optionalRef('team_members', p.assignee_id, 'That team member');
      if (has(p, 'unread_by_team')) fields.unread_by_team = flag(p.unread_by_team, 'Unread');
      const next = { ...old, ...fields };
      if (Object.keys(fields).length) await col('threads').updateOne({ id: old.id }, { $set: fields });
      if (next.status !== old.status) await log(me, old.project_id, 'thread.status', `Marked "${next.subject}" as ${label(next.status)}`);
      if (next.assignee_id && next.assignee_id !== old.assignee_id) {
        const who = await one('team_members', { id: next.assignee_id });
        await log(me, old.project_id, 'thread.assigned', `Assigned "${next.subject}" to ${who?.full_name || 'a team member'}`);
      }
      await changed('threads', old.project_id, { id: old.id });
      return next;
    },
    async 'threads.messages'(me, { threadId }) {
      return find('messages', { thread_id: idOf(threadId, 'That conversation') }, { sort: { created_at: 1 } });
    },
    async 'threads.reply'(me, { threadId, body }) {
      const thread = await need('threads', threadId, 'That conversation');
      const project = await one('projects', { id: thread.project_id });
      const msg = {
        id: uuid(), thread_id: thread.id, project_id: thread.project_id, sender: 'team', member_id: me.id,
        author_name: me.full_name, body: text(body, 5000, 'Reply', { required: true }), created_at: now(),
      };
      await col('messages').insertOne(msg);
      await col('threads').updateOne({ id: thread.id }, { $set: { last_message_at: msg.created_at, unread_by_client: true, unread_by_team: false } });
      await log(me, thread.project_id, 'message.reply', `Replied to "${thread.subject}" (${project?.name || 'a project'})`);
      await changed('messages', thread.project_id, { id: msg.id, thread_id: thread.id, sender: 'team', body: msg.body.slice(0, 140) }, 'INSERT');
      return msg;
    },
    async 'threads.unreadCount'() {
      return col('threads').countDocuments({ unread_by_team: true });
    },

    // --- Money (owners and admins only) ---
    async 'money.finances'(me, { projectId }) {
      needAdmin(me);
      return (await one('project_finances', { project_id: idOf(projectId, 'That project') })) || null;
    },
    async 'money.allFinances'(me) {
      needAdmin(me);
      return find('project_finances');
    },
    async 'money.setQuote'(me, { projectId, quotedAmount, currency, notes }) {
      needAdmin(me);
      const project = await need('projects', projectId, 'That project');
      const old = await one('project_finances', { project_id: project.id });
      const doc = {
        project_id: project.id, quoted_amount: amount(quotedAmount, 'Quoted price', { allowZero: true }),
        currency: currencyOf(currency), notes: text(notes, 5000, 'Notes'), updated_at: now(),
      };
      await col('project_finances').updateOne({ project_id: project.id }, { $set: doc }, { upsert: true });
      if (!old || old.quoted_amount !== doc.quoted_amount) {
        await log(me, project.id, 'finance.quote', `Set the quote for ${project.name} to ${money(doc.quoted_amount, doc.currency)}`, { adminOnly: true });
      }
      return doc;
    },
    async 'money.payments'(me, { projectId } = {}) {
      needAdmin(me);
      const filter = projectId != null ? { project_id: idOf(projectId, 'That project') } : {};
      return find('payments', filter, { sort: { paid_on: -1, created_at: -1 } });
    },
    async 'money.addPayment'(me, { row }) {
      needAdmin(me);
      const r = obj(row);
      const project = await need('projects', r.project_id, 'That project');
      const doc = {
        id: uuid(), project_id: project.id, amount: amount(r.amount, 'Amount', { allowZero: false }),
        paid_on: day(r.paid_on, 'Paid on') || now().slice(0, 10), method: pick(r.method, LISTS.method, 'Method', 'bank_transfer'),
        reference: text(r.reference, 120, 'Reference'), note: text(r.note, 300, 'Note'), recorded_by: me.id, created_at: now(),
      };
      await col('payments').insertOne(doc);
      const finances = await one('project_finances', { project_id: project.id });
      await log(me, project.id, 'payment.added', `Recorded a payment of ${money(doc.amount, finances?.currency)} for ${project.name}`, { adminOnly: true });
      return doc;
    },
    async 'money.removePayment'(me, { id }) {
      needAdmin(me);
      const old = await need('payments', id, 'That payment');
      await col('payments').deleteOne({ id: old.id });
      const [project, finances] = await Promise.all([one('projects', { id: old.project_id }), one('project_finances', { project_id: old.project_id })]);
      if (project) {
        await log(me, project.id, 'payment.deleted', `Deleted a payment of ${money(old.amount, finances?.currency)} for ${project.name}`, { adminOnly: true });
      }
      return null;
    },

    // --- History ---
    async 'activity.list'(me, { projectId, limit = 50, before } = {}) {
      const filter = {};
      if (!isAdmin(me)) filter.admin_only = false;
      if (projectId != null) filter.project_id = idOf(projectId, 'That project');
      if (before != null) filter.id = { $lt: idOf(before) };
      const max = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100);
      return find('activity', filter, { sort: { id: -1 }, limit: max });
    },

    // --- GitHub ---
    // The commits of the project's GitHub repository, newest first, a page at a time.
    // branch: a branch name, or nothing for the repository's default branch.
    async 'github.commits'(me, { projectId, branch, page = 1 }) {
      const project = await need('projects', projectId, 'That project');
      const repo = repoFrom(project.repo_url);
      if (!repo) {
        throw new OpError(project.repo_url
          ? "Commits can only be shown for GitHub repositories, and this project's code repository isn't on github.com."
          : 'This project has no GitHub repository yet. Add its address under Edit → Code repository.', 'no_repo', 400);
      }
      if (!github) throw new OpError("GitHub isn't connected here.", 'github_off', 503);
      const n = Number(page);
      if (!Number.isInteger(n) || n < 1 || n > 2000) throw new OpError('Page must be a whole number.');
      return github.commits(repo, { branch: text(branch, 250, 'Branch'), page: n });
    },

    // What changed recently, for live updates. The window overlaps the last check by 15 seconds
    // so nothing slips between two checks; the portal skips changes it has already seen.
    async poll(me, { since } = {}) {
      const at = now();
      const from = typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : Date.parse(at);
      const changes = await find('changes', { at: { $gt: new Date(from - 15000).toISOString() } }, { sort: { at: 1 }, limit: 300 });
      return { now: at, changes };
    },
  };

  return {
    // Runs one operation for a signed-in team member (or SYSTEM).
    async run(me, op, args = {}) {
      if (!me || !me.active) throw new OpError('Please sign in again.', 'signed_out', 401);
      if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(ops, op)) throw new OpError('Unknown request.', 'unknown_op', 404);
      return ops[op](me, obj(args));
    },
  };
}

// --- Contact with Zenatiq: what the widget on a client's admin panel can do -----------------
// Every call carries a project's secret key and only ever reaches that one project.
export function createConnect(store) {
  const col = (name) => store.col(name);
  const one = (name, filter) => col(name).findOne(filter);
  const { log, changed } = writers(store);
  const badKey = () => new OpError('This Contact with Zenatiq link is not valid.', 'bad_key', 403);
  const notFound = () => new OpError('Conversation not found.', 'not_found', 404);
  const cut = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max).trim() : '') || null;

  async function projectFor(key) {
    if (typeof key !== 'string' || !/^[0-9a-f]{32,128}$/i.test(key)) throw badKey();
    const project = await one('projects', { connect_key: key, connect_enabled: true });
    if (!project) throw badKey();
    return project;
  }
  async function guard(project) {
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const recent = await col('messages').countDocuments({ project_id: project.id, sender: 'client', created_at: { $gt: hourAgo } });
    if (recent >= 30) throw new OpError('Too many messages in the last hour. Please try again a little later.', 'rate_limited', 429);
  }
  async function threadFor(project, id) {
    const thread = typeof id === 'string' && ID.test(id) ? await one('threads', { id, project_id: project.id }) : null;
    if (!thread) throw notFound();
    return thread;
  }
  const clientMessage = (thread, who, body) => ({
    id: uuid(), thread_id: thread.id, project_id: thread.project_id, sender: 'client', member_id: null,
    author_name: who, body, created_at: now(),
  });
  const announce = (msg) =>
    changed('messages', msg.project_id, { id: msg.id, thread_id: msg.thread_id, sender: 'client', body: msg.body.slice(0, 140) }, 'INSERT');

  const ops = {
    async info(project) {
      const client = project.client_id ? await one('clients', { id: project.client_id }) : null;
      return { project_name: project.name, client_name: client?.name || null };
    },
    async threads(project) {
      const list = await col('threads').find({ project_id: project.id }, { sort: { last_message_at: -1 }, limit: 100 });
      return list.map((t) => ({
        id: t.id, subject: t.subject, category: t.category, status: t.status, unread: t.unread_by_client,
        last_message_at: t.last_message_at, created_at: t.created_at,
      }));
    },
    async messages(project, { thread }) {
      const t = await threadFor(project, thread);
      if (t.unread_by_client) await col('threads').updateOne({ id: t.id }, { $set: { unread_by_client: false } });
      const list = await col('messages').find({ thread_id: t.id }, { sort: { created_at: 1 } });
      return list.map((m) => ({
        id: m.id, sender: m.sender, author_name: m.sender === 'team' ? m.author_name || 'Zenatiq' : m.author_name,
        body: m.body, created_at: m.created_at,
      }));
    },
    async start(project, { subject, body, category, name, contact }) {
      await guard(project);
      const s = cut(subject, 200);
      const b = cut(body, 5000);
      if (!s) throw new OpError('Please add a short subject.');
      if (!b) throw new OpError('Please write your message.');
      const who = cut(name, 120);
      const t = now();
      const thread = {
        id: uuid(), project_id: project.id, subject: s, category: LISTS.category.includes(category) ? category : 'other',
        status: 'open', client_name: who, client_contact: cut(contact, 200), assignee_id: null,
        unread_by_team: true, unread_by_client: false, last_message_at: t, created_at: t,
      };
      await col('threads').insertOne(thread);
      await log(null, project.id, 'message.new', `New ${label(thread.category)} from ${project.name}: "${s}"`, { by: `Client · ${who || project.name}` });
      const msg = { ...clientMessage(thread, who, b), created_at: t };
      await col('messages').insertOne(msg);
      await changed('threads', project.id, { id: thread.id }, 'INSERT');
      await announce(msg);
      return thread.id;
    },
    async reply(project, { thread, body, name }) {
      await guard(project);
      const t = await threadFor(project, thread);
      const b = cut(body, 5000);
      if (!b) throw new OpError('Please write your message.');
      const who = cut(name, 120);
      const msg = clientMessage(t, who, b);
      await col('messages').insertOne(msg);
      const reopen = t.status === 'resolved';
      await col('threads').updateOne({ id: t.id }, { $set: { last_message_at: msg.created_at, unread_by_team: true, ...(reopen ? { status: 'open' } : {}) } });
      if (reopen) await log(null, project.id, 'thread.reopened', `Reopened "${t.subject}" after a new client message`);
      await log(null, project.id, 'message.client', `Replied to "${t.subject}" (${project.name})`, { by: `Client · ${who || project.name}` });
      await changed('threads', project.id, { id: t.id });
      await announce(msg);
      return msg.id;
    },
  };

  return {
    async run(op, args = {}) {
      if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(ops, op)) throw new OpError('Unknown request.', 'unknown_op', 404);
      const a = obj(args);
      return ops[op](await projectFor(a.key), a);
    },
  };
}
