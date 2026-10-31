// Zenatiq admin: every read and write to the database goes through here.
// Access rules live in the database (supabase/schema.sql), not in this file.

let sb;
export const setClient = (client) => { sb = client; };
export const client = () => sb;

const run = async (query) => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

// Lists that almost every page needs, loaded once and refreshed after changes.
export const store = {
  team: [],
  clients: [],
  projects: [],
  async load() {
    [this.team, this.clients, this.projects] = await Promise.all([
      run(sb.from('team_members').select('*').order('full_name')),
      run(sb.from('clients').select('*').order('name')),
      run(sb.from('projects').select('*').order('updated_at', { ascending: false })),
    ]);
  },
  member(id) { return this.team.find((m) => m.id === id); },
  client(id) { return this.clients.find((c) => c.id === id); },
  project(id) { return this.projects.find((p) => p.id === id); },
  activeTeam() { return this.team.filter((m) => m.active); },
};

export const team = {
  add: (row) => run(sb.from('team_members').insert(row).select().single()),
  update: (id, patch) => run(sb.from('team_members').update(patch).eq('id', id).select().single()),
  remove: (id) => run(sb.from('team_members').delete().eq('id', id)),
};

export const clients = {
  add: (row) => run(sb.from('clients').insert(row).select().single()),
  update: (id, patch) => run(sb.from('clients').update(patch).eq('id', id).select().single()),
  remove: (id) => run(sb.from('clients').delete().eq('id', id)),
};

export const projects = {
  get: (id) => run(sb.from('projects').select('*').eq('id', id).maybeSingle()),
  add: (row) => run(sb.from('projects').insert(row).select().single()),
  update: (id, patch) => run(sb.from('projects').update(patch).eq('id', id).select().single()),
  remove: (id) => run(sb.from('projects').delete().eq('id', id)),
  newKey: (id) => run(sb.from('projects').update({ connect_key: randomKey() }).eq('id', id).select().single()),
  members: (projectId) => run(sb.from('project_members').select('*').eq('project_id', projectId)),
  allMembers: () => run(sb.from('project_members').select('*')),
  assign: (projectId, memberId) => run(sb.from('project_members').insert({ project_id: projectId, member_id: memberId })),
  unassign: (projectId, memberId) =>
    run(sb.from('project_members').delete().eq('project_id', projectId).eq('member_id', memberId)),
};

export const tasks = {
  list: ({ projectId, assigneeId } = {}) => {
    let q = sb.from('tasks').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    if (assigneeId) q = q.eq('assignee_id', assigneeId);
    return run(q.order('position'));
  },
  add: (row) => run(sb.from('tasks').insert(row).select().single()),
  update: (id, patch) => run(sb.from('tasks').update(patch).eq('id', id).select().single()),
  remove: (id) => run(sb.from('tasks').delete().eq('id', id)),
};

export const threads = {
  list: ({ projectId } = {}) => {
    let q = sb.from('threads').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    return run(q.order('last_message_at', { ascending: false }));
  },
  get: (id) => run(sb.from('threads').select('*').eq('id', id).maybeSingle()),
  add: (row) => run(sb.from('threads').insert(row).select().single()),
  update: (id, patch) => run(sb.from('threads').update(patch).eq('id', id).select().single()),
  messages: (threadId) => run(sb.from('messages').select('*').eq('thread_id', threadId).order('created_at')),
  reply: (threadId, body) => run(sb.from('messages').insert({ thread_id: threadId, sender: 'team', body }).select().single()),
  unreadCount: async () => (await run(sb.from('threads').select('id').eq('unread_by_team', true))).length,
};

export const money = {
  finances: (projectId) => run(sb.from('project_finances').select('*').eq('project_id', projectId).maybeSingle()),
  allFinances: () => run(sb.from('project_finances').select('*')),
  setQuote: (projectId, quotedAmount, currency = 'LKR', notes = null) =>
    run(sb.from('project_finances')
      .upsert({ project_id: projectId, quoted_amount: quotedAmount, currency, notes }, { onConflict: 'project_id' })
      .select().single()),
  payments: (projectId) => {
    let q = sb.from('payments').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    return run(q.order('paid_on', { ascending: false }));
  },
  addPayment: (row) => run(sb.from('payments').insert(row).select().single()),
  removePayment: (id) => run(sb.from('payments').delete().eq('id', id)),
};

export const activity = {
  list: ({ projectId, limit = 50, before } = {}) => {
    let q = sb.from('activity').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    if (before) q = q.lt('id', before);
    return run(q.order('id', { ascending: false }).limit(limit));
  },
};

export function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Live updates (Supabase Realtime): calls onChange(table, payload) for every change.
export function subscribe(onChange) {
  const channel = sb.channel('portal');
  for (const table of ['threads', 'messages', 'tasks', 'activity']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => onChange(table, payload));
  }
  channel.subscribe();
  return () => sb.removeChannel(channel);
}

export const signOut = () => sb.auth.signOut();
