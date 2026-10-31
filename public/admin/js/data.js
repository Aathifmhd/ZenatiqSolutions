// Zenatiq admin: every read and write goes through here. The live portal sends each operation to
// the portal API (api/portal.js, backed by MongoDB); demo mode runs the same operations in this
// browser. The rules about who may do what live in core/ops.js, not in this file.

let send;
export const setTransport = (fn) => { send = fn; };
const call = (op, args = {}) => send(op, args);

// Lists that almost every page needs, loaded once and refreshed after changes.
export const store = {
  team: [],
  clients: [],
  projects: [],
  async load() {
    ({ team: this.team, clients: this.clients, projects: this.projects } = await call('load'));
  },
  member(id) { return this.team.find((m) => m.id === id); },
  client(id) { return this.clients.find((c) => c.id === id); },
  project(id) { return this.projects.find((p) => p.id === id); },
  activeTeam() { return this.team.filter((m) => m.active); },
};

export const team = {
  add: (row) => call('team.add', { row }),
  update: (id, patch) => call('team.update', { id, patch }),
  remove: (id) => call('team.remove', { id }),
};

export const clients = {
  add: (row) => call('clients.add', { row }),
  update: (id, patch) => call('clients.update', { id, patch }),
  remove: (id) => call('clients.remove', { id }),
};

export const projects = {
  get: (id) => call('projects.get', { id }),
  add: (row) => call('projects.add', { row }),
  update: (id, patch) => call('projects.update', { id, patch }),
  remove: (id) => call('projects.remove', { id }),
  newKey: (id) => call('projects.newKey', { id }),
  members: (projectId) => call('projects.members', { projectId }),
  allMembers: () => call('projects.allMembers'),
  assign: (projectId, memberId) => call('projects.assign', { projectId, memberId }),
  unassign: (projectId, memberId) => call('projects.unassign', { projectId, memberId }),
};

export const tasks = {
  list: ({ projectId, assigneeId } = {}) => call('tasks.list', { projectId, assigneeId }),
  add: (row) => call('tasks.add', { row }),
  update: (id, patch) => call('tasks.update', { id, patch }),
  remove: (id) => call('tasks.remove', { id }),
};

export const threads = {
  list: ({ projectId } = {}) => call('threads.list', { projectId }),
  get: (id) => call('threads.get', { id }),
  add: (row) => call('threads.add', { row }),
  update: (id, patch) => call('threads.update', { id, patch }),
  messages: (threadId) => call('threads.messages', { threadId }),
  reply: (threadId, body) => call('threads.reply', { threadId, body }),
  unreadCount: () => call('threads.unreadCount'),
};

export const money = {
  finances: (projectId) => call('money.finances', { projectId }),
  allFinances: () => call('money.allFinances'),
  setQuote: (projectId, quotedAmount, currency = 'LKR', notes = null) =>
    call('money.setQuote', { projectId, quotedAmount, currency, notes }),
  payments: (projectId) => call('money.payments', { projectId }),
  addPayment: (row) => call('money.addPayment', { row }),
  removePayment: (id) => call('money.removePayment', { id }),
};

export const activity = {
  list: ({ projectId, limit = 50, before } = {}) => call('activity.list', { projectId, limit, before }),
};

// Demo mode only: pretend a client wrote through the Contact with Zenatiq widget.
export const simulateClientMessage = (projectId, fields) => call('demo.clientMessage', { projectId, ...fields });

// Live updates: asks what changed every 12 seconds (every minute in a background tab) and calls
// onChange(table, payload) once for each change, the way the pages expect.
let checkNow = () => {};
export const pollNow = () => checkNow();
export function subscribe(onChange) {
  let since = null;
  let timer;
  let busy = false;
  const seen = new Set();
  const tick = async () => {
    clearTimeout(timer);
    if (busy) return;
    busy = true;
    try {
      const { now, changes } = await call('poll', { since });
      let any = false;
      for (const c of changes) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        // The first check only learns what already happened.
        if (since) {
          any = true;
          onChange(c.table, { eventType: c.op, new: { ...c.row, project_id: c.project_id }, old: { project_id: c.project_id } });
        }
      }
      if (any) onChange('activity', {});
      since = now;
      if (seen.size > 3000) [...seen].slice(0, 1500).forEach((id) => seen.delete(id));
    } catch { /* try again next time */ }
    busy = false;
    timer = setTimeout(tick, document.hidden ? 60000 : 12000);
  };
  checkNow = tick;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
}
