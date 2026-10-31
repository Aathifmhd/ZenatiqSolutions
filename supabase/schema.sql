-- =====================================================================
-- Zenatiq admin portal: Supabase database
--
-- How to use: Supabase dashboard -> SQL Editor -> New query -> paste this
-- whole file -> change the owner email in section 9 -> Run.
-- Running it again later is safe: it updates the functions, triggers and
-- access rules without touching your data.
-- =====================================================================


-- 1. Tables -----------------------------------------------------------

create table if not exists public.team_members (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  full_name  text not null check (char_length(full_name) between 1 and 120),
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  job_title  text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists team_members_email_idx on public.team_members (lower(email));

create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 200),
  contact_name text,
  phone        text,
  email        text,
  address      text,
  notes        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 200),
  client_id       uuid references public.clients (id) on delete set null,
  type            text not null default 'website'
                  check (type in ('website', 'online_shop', 'pos', 'mobile_app', 'ui_ux', 'other')),
  status          text not null default 'planning'
                  check (status in ('lead', 'planning', 'in_progress', 'review', 'live', 'maintenance', 'on_hold', 'completed')),
  live_url        text,
  admin_url       text,
  repo_url        text,
  description     text,
  start_date      date,
  due_date        date,
  -- Secret key that lets the client's "Contact with Zenatiq" widget reach this project only.
  connect_key     text not null unique
                  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  connect_enabled boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id  uuid not null references public.team_members (id) on delete cascade,
  primary key (project_id, member_id)
);

create table if not exists public.threads (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  subject          text not null check (char_length(subject) between 1 and 200),
  category         text not null default 'question' check (category in ('bug', 'update', 'question', 'other')),
  status           text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  client_name      text,
  client_contact   text,
  assignee_id      uuid references public.team_members (id) on delete set null,
  unread_by_team   boolean not null default true,
  unread_by_client boolean not null default false,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists threads_project_idx on public.threads (project_id, last_message_at desc);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.threads (id) on delete cascade,
  sender      text not null check (sender in ('client', 'team')),
  member_id   uuid references public.team_members (id) on delete set null,
  author_name text,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_thread_idx on public.messages (thread_id, created_at);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  description text,
  status      text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_id uuid references public.team_members (id) on delete set null,
  due_date    date,
  position    double precision not null default extract(epoch from now()),
  thread_id   uuid references public.threads (id) on delete set null,
  created_by  uuid references public.team_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_project_idx on public.tasks (project_id, status, position);

-- Money is visible to owners and admins only (see section 5).
create table if not exists public.project_finances (
  project_id    uuid primary key references public.projects (id) on delete cascade,
  quoted_amount numeric(12, 2) not null default 0 check (quoted_amount >= 0),
  currency      text not null default 'LKR',
  notes         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  amount      numeric(12, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default 'bank_transfer'
              check (method in ('cash', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
  reference   text,
  note        text,
  recorded_by uuid references public.team_members (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payments_project_idx on public.payments (project_id, paid_on desc);

-- Written only by the triggers below, so nobody can edit or delete history.
create table if not exists public.activity (
  id              bigint generated always as identity primary key,
  project_id      uuid references public.projects (id) on delete set null,
  actor_member_id uuid references public.team_members (id) on delete set null,
  actor_label     text not null,
  action          text not null,
  summary         text not null,
  admin_only      boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity (created_at desc);
create index if not exists activity_project_idx on public.activity (project_id, created_at desc);


-- 2. Who is signed in -------------------------------------------------
-- Someone is on the team when the verified email of their Google sign-in
-- matches an active team member.

create or replace function public.my_member_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select t.id
  from public.team_members t
  join auth.users u on lower(u.email) = lower(t.email)
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and t.active
  limit 1
$$;

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$ select t.role from public.team_members t where t.id = public.my_member_id() $$;

create or replace function public.is_team()
returns boolean language sql stable set search_path = public
as $$ select public.my_member_id() is not null $$;

create or replace function public.is_admin()
returns boolean language sql stable set search_path = public
as $$ select coalesce(public.my_role() in ('owner', 'admin'), false) $$;

create or replace function public.is_owner()
returns boolean language sql stable set search_path = public
as $$ select coalesce(public.my_role() = 'owner', false) $$;


-- 3. Activity log helpers ---------------------------------------------

create or replace function public._label(p_value text)
returns text language sql immutable
as $$
  select case p_value
    when 'todo' then 'To do'            when 'in_progress' then 'In progress'
    when 'review' then 'Review'         when 'done' then 'Done'
    when 'lead' then 'Lead'             when 'planning' then 'Planning'
    when 'live' then 'Live'             when 'maintenance' then 'Maintenance'
    when 'on_hold' then 'On hold'       when 'completed' then 'Completed'
    when 'open' then 'Open'             when 'resolved' then 'Resolved'
    when 'bug' then 'bug report'        when 'update' then 'update request'
    when 'question' then 'question'     when 'other' then 'message'
    else coalesce(p_value, '')
  end
$$;

create or replace function public._money(p_amount numeric, p_currency text)
returns text language sql immutable
as $$ select coalesce(p_currency, 'LKR') || ' ' || to_char(p_amount, 'FM999,999,999,990.00') $$;

create or replace function public._log(
  p_project uuid, p_action text, p_summary text,
  p_admin_only boolean default false, p_label text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_member uuid := public.my_member_id();
  v_label  text;
begin
  if v_member is not null then
    select full_name into v_label from public.team_members where id = v_member;
  end if;
  insert into public.activity (project_id, actor_member_id, actor_label, action, summary, admin_only)
  values (p_project, v_member, coalesce(p_label, v_label, 'System'), p_action, left(p_summary, 500), p_admin_only);
end $$;


-- 4. Triggers ---------------------------------------------------------

create or replace function public._trg_touch()
returns trigger language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public._trg_touch();
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public._trg_touch();
drop trigger if exists finances_touch on public.project_finances;
create trigger finances_touch before update on public.project_finances
  for each row execute function public._trg_touch();

-- Team: tidy emails and protect roles. Only applies to changes made from the
-- portal; the SQL editor (used to set up the first owner) is not limited.
create or replace function public._trg_team_guard()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.email := lower(trim(new.email));
  end if;

  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' and not public.is_admin()
       and (new.role is distinct from old.role
            or new.active is distinct from old.active
            or new.email is distinct from old.email) then
      raise exception 'Only owners and admins can change roles, emails or access.';
    end if;

    if (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' and not public.is_owner())
       or (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and not public.is_owner()) then
      raise exception 'Only an owner can add, change or remove an owner.';
    end if;

    if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.active
       and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
       and not exists (select 1 from public.team_members t
                       where t.role = 'owner' and t.active and t.id <> old.id) then
      raise exception 'The team needs at least one active owner.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists team_guard on public.team_members;
create trigger team_guard before insert or update or delete on public.team_members
  for each row execute function public._trg_team_guard();

create or replace function public._trg_team_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log(null, 'team.added', 'Added ' || new.full_name || ' to the team as ' || new.role);
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform public._log(null, 'team.role', 'Changed ' || new.full_name || '''s role to ' || new.role);
    end if;
    if new.active is distinct from old.active then
      perform public._log(null, 'team.access',
        case when new.active then 'Gave ' || new.full_name || ' access again'
             else 'Removed portal access for ' || new.full_name end);
    end if;
  elsif tg_op = 'DELETE' then
    perform public._log(null, 'team.removed', 'Removed ' || old.full_name || ' from the team');
  end if;
  return null;
end $$;

drop trigger if exists team_activity on public.team_members;
create trigger team_activity after insert or update or delete on public.team_members
  for each row execute function public._trg_team_activity();

create or replace function public._trg_client_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log(null, 'client.added', 'Added client ' || new.name);
  elsif tg_op = 'DELETE' then
    perform public._log(null, 'client.deleted', 'Deleted client ' || old.name);
  end if;
  return null;
end $$;

drop trigger if exists client_activity on public.clients;
create trigger client_activity after insert or delete on public.clients
  for each row execute function public._trg_client_activity();

create or replace function public._trg_project_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log(new.id, 'project.created', 'Created project ' || new.name);
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform public._log(new.id, 'project.status',
        new.name || ': ' || public._label(old.status) || ' → ' || public._label(new.status));
    elsif new.connect_key is distinct from old.connect_key then
      perform public._log(new.id, 'project.key', 'Made a new Contact with Zenatiq key for ' || new.name);
    elsif new.connect_enabled is distinct from old.connect_enabled then
      perform public._log(new.id, 'project.connect',
        case when new.connect_enabled then 'Turned on' else 'Turned off' end
        || ' Contact with Zenatiq for ' || new.name);
    elsif (new.name, new.client_id, new.type, new.live_url, new.admin_url, new.repo_url,
           new.description, new.start_date, new.due_date)
          is distinct from
          (old.name, old.client_id, old.type, old.live_url, old.admin_url, old.repo_url,
           old.description, old.start_date, old.due_date) then
      perform public._log(new.id, 'project.updated', 'Updated the details of ' || new.name);
    end if;
  elsif tg_op = 'DELETE' then
    perform public._log(null, 'project.deleted', 'Deleted project ' || old.name);
  end if;
  return null;
end $$;

drop trigger if exists project_activity on public.projects;
create trigger project_activity after insert or update or delete on public.projects
  for each row execute function public._trg_project_activity();

create or replace function public._trg_member_assign_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_member text; v_project text;
begin
  select full_name into v_member from public.team_members where id = coalesce(new.member_id, old.member_id);
  select name into v_project from public.projects where id = coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    perform public._log(new.project_id, 'project.member_added', 'Added ' || v_member || ' to ' || v_project);
  elsif v_project is not null and v_member is not null then
    perform public._log(old.project_id, 'project.member_removed', 'Took ' || v_member || ' off ' || v_project);
  end if;
  return null;
end $$;

drop trigger if exists member_assign_activity on public.project_members;
create trigger member_assign_activity after insert or delete on public.project_members
  for each row execute function public._trg_member_assign_activity();

create or replace function public._trg_task_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    perform public._log(new.project_id, 'task.created', 'Added task "' || new.title || '"');
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform public._log(new.project_id, 'task.moved', 'Moved "' || new.title || '" to ' || public._label(new.status));
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      select full_name into v_name from public.team_members where id = new.assignee_id;
      perform public._log(new.project_id, 'task.assigned',
        case when v_name is null then 'Unassigned "' || new.title || '"'
             else 'Assigned "' || new.title || '" to ' || v_name end);
    end if;
  elsif tg_op = 'DELETE' then
    -- Skip when the whole project is being deleted.
    if exists (select 1 from public.projects where id = old.project_id) then
      perform public._log(old.project_id, 'task.deleted', 'Deleted task "' || old.title || '"');
    end if;
  end if;
  return null;
end $$;

drop trigger if exists task_activity on public.tasks;
create trigger task_activity after insert or update or delete on public.tasks
  for each row execute function public._trg_task_activity();

create or replace function public._trg_money_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_project text; v_currency text;
begin
  select p.name, coalesce(f.currency, 'LKR') into v_project, v_currency
  from public.projects p left join public.project_finances f on f.project_id = p.id
  where p.id = coalesce(new.project_id, old.project_id);
  if v_project is null then
    return null;
  end if;

  if tg_table_name = 'payments' then
    if tg_op = 'INSERT' then
      perform public._log(new.project_id, 'payment.added',
        'Recorded a payment of ' || public._money(new.amount, v_currency) || ' for ' || v_project, true);
    elsif tg_op = 'DELETE' then
      perform public._log(old.project_id, 'payment.deleted',
        'Deleted a payment of ' || public._money(old.amount, v_currency) || ' for ' || v_project, true);
    end if;
  elsif tg_op = 'INSERT' or new.quoted_amount is distinct from old.quoted_amount then
    perform public._log(new.project_id, 'finance.quote',
      'Set the quote for ' || v_project || ' to ' || public._money(new.quoted_amount, new.currency), true);
  end if;
  return null;
end $$;

drop trigger if exists payment_activity on public.payments;
create trigger payment_activity after insert or delete on public.payments
  for each row execute function public._trg_money_activity();
drop trigger if exists finance_activity on public.project_finances;
create trigger finance_activity after insert or update on public.project_finances
  for each row execute function public._trg_money_activity();

-- Messages: stamp who wrote them, keep the thread's unread flags right, log replies.
create or replace function public._trg_message_author()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_member uuid;
begin
  if current_setting('zenatiq.client', true) = '1' then
    new.sender := 'client';
    new.member_id := null;
    return new;
  end if;

  v_member := public.my_member_id();
  if v_member is not null then
    new.sender := 'team';
    new.member_id := v_member;
    select full_name into new.author_name from public.team_members where id = v_member;
  end if;
  return new;
end $$;

drop trigger if exists message_author on public.messages;
create trigger message_author before insert on public.messages
  for each row execute function public._trg_message_author();

create or replace function public._trg_message_after()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_thread  public.threads;
  v_project text;
begin
  select * into v_thread from public.threads where id = new.thread_id;
  select name into v_project from public.projects where id = v_thread.project_id;

  if new.sender = 'client' then
    update public.threads
       set last_message_at = new.created_at,
           unread_by_team  = true,
           status          = case when status = 'resolved' then 'open' else status end
     where id = new.thread_id;
    -- The first message of a new conversation is logged by the thread trigger.
    if exists (select 1 from public.messages where thread_id = new.thread_id and id <> new.id) then
      perform public._log(v_thread.project_id, 'message.client',
        'Replied to "' || v_thread.subject || '" (' || v_project || ')', false,
        'Client · ' || coalesce(new.author_name, v_project));
    end if;
  else
    update public.threads
       set last_message_at  = new.created_at,
           unread_by_client = true,
           unread_by_team   = false
     where id = new.thread_id;
    perform public._log(v_thread.project_id, 'message.reply',
      'Replied to "' || v_thread.subject || '" (' || v_project || ')');
  end if;
  return null;
end $$;

drop trigger if exists message_after on public.messages;
create trigger message_after after insert on public.messages
  for each row execute function public._trg_message_after();

create or replace function public._trg_thread_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_project text; v_name text; v_by_team boolean := public.my_member_id() is not null;
begin
  select name into v_project from public.projects where id = new.project_id;
  if tg_op = 'INSERT' then
    if v_by_team then
      perform public._log(new.project_id, 'thread.created',
        'Started a conversation "' || new.subject || '" for ' || v_project);
    else
      perform public._log(new.project_id, 'message.new',
        'New ' || public._label(new.category) || ' from ' || v_project || ': "' || new.subject || '"',
        false, 'Client · ' || coalesce(new.client_name, v_project));
    end if;
  else
    if new.status is distinct from old.status then
      if v_by_team then
        perform public._log(new.project_id, 'thread.status',
          'Marked "' || new.subject || '" as ' || public._label(new.status));
      else
        perform public._log(new.project_id, 'thread.reopened',
          'Reopened "' || new.subject || '" after a new client message');
      end if;
    end if;
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
      select full_name into v_name from public.team_members where id = new.assignee_id;
      perform public._log(new.project_id, 'thread.assigned', 'Assigned "' || new.subject || '" to ' || v_name);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists thread_activity on public.threads;
create trigger thread_activity after insert or update on public.threads
  for each row execute function public._trg_thread_activity();


-- 5. Access rules (row level security) -------------------------------

alter table public.team_members     enable row level security;
alter table public.clients          enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.threads          enable row level security;
alter table public.messages         enable row level security;
alter table public.tasks            enable row level security;
alter table public.project_finances enable row level security;
alter table public.payments         enable row level security;
alter table public.activity         enable row level security;

drop policy if exists "team reads team" on public.team_members;
create policy "team reads team" on public.team_members
  for select to authenticated using ((select public.is_team()));
drop policy if exists "admins add members" on public.team_members;
create policy "admins add members" on public.team_members
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "admins or the member edit a member" on public.team_members;
create policy "admins or the member edit a member" on public.team_members
  for update to authenticated
  using ((select public.is_admin()) or id = (select public.my_member_id()))
  with check ((select public.is_admin()) or id = (select public.my_member_id()));
drop policy if exists "admins remove members" on public.team_members;
create policy "admins remove members" on public.team_members
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "team reads clients" on public.clients;
create policy "team reads clients" on public.clients
  for select to authenticated using ((select public.is_team()));
drop policy if exists "team adds clients" on public.clients;
create policy "team adds clients" on public.clients
  for insert to authenticated with check ((select public.is_team()));
drop policy if exists "team edits clients" on public.clients;
create policy "team edits clients" on public.clients
  for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));
drop policy if exists "admins delete clients" on public.clients;
create policy "admins delete clients" on public.clients
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "team reads projects" on public.projects;
create policy "team reads projects" on public.projects
  for select to authenticated using ((select public.is_team()));
drop policy if exists "team adds projects" on public.projects;
create policy "team adds projects" on public.projects
  for insert to authenticated with check ((select public.is_team()));
drop policy if exists "team edits projects" on public.projects;
create policy "team edits projects" on public.projects
  for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));
drop policy if exists "admins delete projects" on public.projects;
create policy "admins delete projects" on public.projects
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "team reads project members" on public.project_members;
create policy "team reads project members" on public.project_members
  for select to authenticated using ((select public.is_team()));
drop policy if exists "team assigns project members" on public.project_members;
create policy "team assigns project members" on public.project_members
  for insert to authenticated with check ((select public.is_team()));
drop policy if exists "team unassigns project members" on public.project_members;
create policy "team unassigns project members" on public.project_members
  for delete to authenticated using ((select public.is_team()));

drop policy if exists "team reads threads" on public.threads;
create policy "team reads threads" on public.threads
  for select to authenticated using ((select public.is_team()));
drop policy if exists "team starts threads" on public.threads;
create policy "team starts threads" on public.threads
  for insert to authenticated with check ((select public.is_team()));
drop policy if exists "team updates threads" on public.threads;
create policy "team updates threads" on public.threads
  for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));
drop policy if exists "admins delete threads" on public.threads;
create policy "admins delete threads" on public.threads
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "team reads messages" on public.messages;
create policy "team reads messages" on public.messages
  for select to authenticated using ((select public.is_team()));
drop policy if exists "team replies" on public.messages;
create policy "team replies" on public.messages
  for insert to authenticated with check ((select public.is_team()) and sender = 'team');
drop policy if exists "admins delete messages" on public.messages;
create policy "admins delete messages" on public.messages
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "team manages tasks" on public.tasks;
create policy "team manages tasks" on public.tasks
  for all to authenticated using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "admins manage finances" on public.project_finances;
create policy "admins manage finances" on public.project_finances
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "admins manage payments" on public.payments;
create policy "admins manage payments" on public.payments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "team reads activity" on public.activity;
create policy "team reads activity" on public.activity
  for select to authenticated
  using ((select public.is_team()) and (not admin_only or (select public.is_admin())));


-- 6. Contact with Zenatiq: functions the client widget calls ---------
-- The widget holds a project's secret connect_key. These functions only
-- ever touch that one project, and visitors get no other database access.

create or replace function public._connect_project(p_key text)
returns public.projects
language plpgsql stable security definer set search_path = public
as $$
declare v public.projects;
begin
  if p_key is not null and char_length(p_key) >= 32 then
    select * into v from public.projects p where p.connect_key = p_key and p.connect_enabled;
  end if;
  if v.id is null then
    raise exception 'This Contact with Zenatiq link is not valid.' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function public._connect_guard(p_project uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('zenatiq.client', '1', true);
  if (select count(*) from public.messages m join public.threads t on t.id = m.thread_id
      where t.project_id = p_project and m.sender = 'client'
        and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many messages in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;
end $$;

create or replace function public.connect_info(p_key text)
returns table (project_name text, client_name text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v public.projects := public._connect_project(p_key);
begin
  return query
    select v.name, (select c.name from public.clients c where c.id = v.client_id);
end $$;

create or replace function public.connect_threads(p_key text)
returns table (id uuid, subject text, category text, status text, unread boolean,
               last_message_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v public.projects := public._connect_project(p_key);
begin
  return query
    select t.id, t.subject, t.category, t.status, t.unread_by_client, t.last_message_at, t.created_at
    from public.threads t
    where t.project_id = v.id
    order by t.last_message_at desc
    limit 100;
end $$;

create or replace function public.connect_messages(p_key text, p_thread uuid)
returns table (id uuid, sender text, author_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare v public.projects := public._connect_project(p_key);
begin
  if not exists (select 1 from public.threads t where t.id = p_thread and t.project_id = v.id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  update public.threads set unread_by_client = false where id = p_thread and unread_by_client;
  return query
    select m.id, m.sender,
           case when m.sender = 'team' then coalesce(m.author_name, 'Zenatiq') else m.author_name end,
           m.body, m.created_at
    from public.messages m
    where m.thread_id = p_thread
    order by m.created_at;
end $$;

create or replace function public.connect_new_thread(
  p_key text, p_subject text, p_body text,
  p_category text default 'question', p_name text default null, p_contact text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v        public.projects := public._connect_project(p_key);
  v_name   text := nullif(trim(left(coalesce(p_name, ''), 120)), '');
  v_thread uuid;
begin
  perform public._connect_guard(v.id);
  if char_length(trim(coalesce(p_subject, ''))) = 0 then
    raise exception 'Please add a short subject.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Please write your message.' using errcode = '22023';
  end if;

  insert into public.threads (project_id, subject, category, client_name, client_contact)
  values (v.id, left(trim(p_subject), 200),
          case when p_category in ('bug', 'update', 'question', 'other') then p_category else 'other' end,
          v_name, nullif(trim(left(coalesce(p_contact, ''), 200)), ''))
  returning id into v_thread;

  insert into public.messages (thread_id, sender, author_name, body)
  values (v_thread, 'client', v_name, left(trim(p_body), 5000));

  return v_thread;
end $$;

create or replace function public.connect_reply(p_key text, p_thread uuid, p_body text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v    public.projects := public._connect_project(p_key);
  v_id uuid;
begin
  perform public._connect_guard(v.id);
  if not exists (select 1 from public.threads t where t.id = p_thread and t.project_id = v.id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Please write your message.' using errcode = '22023';
  end if;

  insert into public.messages (thread_id, sender, author_name, body)
  values (p_thread, 'client', nullif(trim(left(coalesce(p_name, ''), 120)), ''), left(trim(p_body), 5000))
  returning id into v_id;
  return v_id;
end $$;


-- 7. Permissions ------------------------------------------------------

-- Visitors (the "anon" role) never touch tables directly.
revoke all on table public.team_members, public.clients, public.projects, public.project_members,
  public.threads, public.messages, public.tasks, public.project_finances, public.payments,
  public.activity from anon;

-- History and messages can't be rewritten from the portal.
revoke insert, update, delete on table public.activity from authenticated;
revoke update on table public.messages from authenticated;

-- Internal helpers can't be called from the outside.
revoke execute on function
  public._label(text), public._money(numeric, text),
  public._log(uuid, text, text, boolean, text),
  public._connect_project(text), public._connect_guard(uuid),
  public._trg_touch(), public._trg_team_guard(), public._trg_team_activity(),
  public._trg_client_activity(), public._trg_project_activity(),
  public._trg_member_assign_activity(), public._trg_task_activity(),
  public._trg_money_activity(), public._trg_message_author(),
  public._trg_message_after(), public._trg_thread_activity()
from public, anon, authenticated;

revoke execute on function
  public.my_member_id(), public.my_role(), public.is_team(), public.is_admin(), public.is_owner()
from public, anon;
grant execute on function
  public.my_member_id(), public.my_role(), public.is_team(), public.is_admin(), public.is_owner()
to authenticated;

revoke execute on function
  public.connect_info(text), public.connect_threads(text), public.connect_messages(text, uuid),
  public.connect_new_thread(text, text, text, text, text, text),
  public.connect_reply(text, uuid, text, text)
from public;
grant execute on function
  public.connect_info(text), public.connect_threads(text), public.connect_messages(text, uuid),
  public.connect_new_thread(text, text, text, text, text, text),
  public.connect_reply(text, uuid, text, text)
to anon, authenticated;


-- 8. Live updates for the portal --------------------------------------

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['threads', 'messages', 'tasks', 'activity'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      exception when duplicate_object then
        null;
      end;
    end loop;
  end if;
end $$;


-- 9. The first owner --------------------------------------------------
-- Change the email to the Google account you'll sign in with, then run.

insert into public.team_members (email, full_name, role, job_title)
values ('change-me@gmail.com', 'Mohamed Aathif', 'owner', 'Founder')
on conflict do nothing;
