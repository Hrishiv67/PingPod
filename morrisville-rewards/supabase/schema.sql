-- PingPod Morrisville Rewards beta: run once in the SQL editor of a NEW Supabase project.
-- Do not run this in a database used by an unrelated application.
-- Deliberately uses a public, read-only aggregate RPC for the kiosk; private play rows
-- are not directly exposed to unauthenticated visitors.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null unique check (char_length(display_name) between 2 and 22),
  show_on_leaderboard boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes int not null default 0 check (minutes between 0 and 180),
  method text not null check (method in ('timer', 'manual')),
  status text not null check (status in ('active', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  constraint ended_when_inactive check ((status = 'active') = (ended_at is null))
);

create unique index if not exists one_active_session_per_player
  on public.play_sessions(user_id) where status = 'active';
create index if not exists play_sessions_user_time on public.play_sessions(user_id, started_at desc);
create index if not exists play_sessions_rank_time on public.play_sessions(started_at desc, status);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 3 and 26),
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint membership_time_check check (left_at is null or left_at >= joined_at)
);
create unique index if not exists one_active_team_per_player
  on public.team_memberships(user_id) where left_at is null;
create index if not exists team_memberships_team_idx on public.team_memberships(team_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.profiles enable row level security;
alter table public.play_sessions enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table private.admins enable row level security;

create policy profiles_public_or_owner on public.profiles for select
  to anon, authenticated using (show_on_leaderboard = true or (select auth.uid()) = id);
create policy profiles_insert_self on public.profiles for insert
  to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update
  to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy sessions_read_self on public.play_sessions for select
  to authenticated using ((select auth.uid()) = user_id);
-- Invite codes are visible only to active team members, not the public kiosk.
create policy teams_read_members on public.teams for select
  to authenticated using (
    owner_id = (select auth.uid()) or exists (
      select 1 from public.team_memberships m
      where m.team_id = teams.id and m.user_id = (select auth.uid()) and m.left_at is null
    )
  );
create policy membership_read_self on public.team_memberships for select
  to authenticated using ((select auth.uid()) = user_id);

-- Tables are readable only as stated above. All play/team mutations use validated RPCs.
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.play_sessions to authenticated;
grant select on public.teams to authenticated;
grant select on public.team_memberships to authenticated;
revoke all on public.play_sessions, public.teams, public.team_memberships from anon;
grant select on public.play_sessions, public.teams, public.team_memberships to authenticated;
revoke insert, update, delete on public.play_sessions, public.teams, public.team_memberships from anon, authenticated;

create or replace function public.start_session()
returns public.play_sessions
language plpgsql security definer set search_path = '' as $$
declare out_row public.play_sessions;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if not exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Choose a display name before playing';
  end if;
  insert into public.play_sessions (user_id, method, status, started_at)
  values (auth.uid(), 'timer', 'active', clock_timestamp())
  returning * into out_row;
  return out_row;
exception when unique_violation then
  raise exception 'You already have a running session';
end $$;

create or replace function public.stop_session(p_id uuid)
returns public.play_sessions
language plpgsql security definer set search_path = '' as $$
declare out_row public.play_sessions;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  update public.play_sessions
  set ended_at = clock_timestamp(),
      minutes = least(180, greatest(0, floor(extract(epoch from (clock_timestamp() - started_at)) / 60)::int)),
      status = 'pending'
  where id = p_id and user_id = auth.uid() and status = 'active'
  returning * into out_row;
  if not found then raise exception 'Active session not found'; end if;
  return out_row;
end $$;

create or replace function public.log_session(p_day date, p_minutes int)
returns public.play_sessions
language plpgsql security definer set search_path = '' as $$
declare out_row public.play_sessions;
declare session_start timestamptz;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if not exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Choose a display name before playing';
  end if;
  if p_minutes < 5 or p_minutes > 180 then raise exception 'Session must be 5–180 minutes'; end if;
  if p_day > (clock_timestamp() at time zone 'America/New_York')::date
    or p_day < (clock_timestamp() at time zone 'America/New_York')::date - 7 then
    raise exception 'Choose a date from the last 7 days';
  end if;
  -- Midday venue time: we have a date/duration, not an invented precise start time.
  session_start := (p_day::timestamp + interval '12 hours') at time zone 'America/New_York';
  insert into public.play_sessions (user_id, started_at, ended_at, minutes, method, status)
  values (auth.uid(), session_start, session_start + make_interval(mins => p_minutes), p_minutes, 'manual', 'pending')
  returning * into out_row;
  return out_row;
end $$;

create or replace function public.create_team(p_name text)
returns public.teams
language plpgsql security definer set search_path = '' as $$
declare out_team public.teams;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if length(trim(p_name)) < 3 or length(trim(p_name)) > 26 then
    raise exception 'Team name must be 3–26 characters';
  end if;
  if exists(select 1 from public.team_memberships where user_id = auth.uid() and left_at is null) then
    raise exception 'Leave your current crew first';
  end if;
  insert into public.teams (name, invite_code, owner_id)
  values (trim(p_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), auth.uid())
  returning * into out_team;
  insert into public.team_memberships (user_id, team_id) values (auth.uid(), out_team.id);
  return out_team;
end $$;

create or replace function public.join_team(p_code text)
returns public.teams
language plpgsql security definer set search_path = '' as $$
declare out_team public.teams;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists(select 1 from public.team_memberships where user_id = auth.uid() and left_at is null) then
    raise exception 'You are already in a crew';
  end if;
  select * into out_team from public.teams where invite_code = upper(trim(p_code));
  if not found then raise exception 'Invite code not found'; end if;
  if (select count(*) from public.team_memberships where team_id = out_team.id and left_at is null) >= 8 then
    raise exception 'That crew is full (8 members)';
  end if;
  insert into public.team_memberships (user_id, team_id) values (auth.uid(), out_team.id);
  return out_team;
end $$;

create or replace function public.leave_team()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from public.teams where owner_id = auth.uid()
    and id in (select team_id from public.team_memberships where user_id = auth.uid() and left_at is null)) then
    raise exception 'Crew captain cannot leave; contact the pilot administrator';
  end if;
  update public.team_memberships set left_at = clock_timestamp()
    where user_id = auth.uid() and left_at is null;
end $$;

create or replace function public.get_leaderboard(p_period text default 'week')
returns table(id uuid, display_name text, minutes bigint, sessions bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, coalesce(sum(s.minutes),0)::bigint, count(s.id)::bigint
  from public.profiles p
  join public.play_sessions s on s.user_id = p.id and s.status in ('pending', 'approved')
  where p.show_on_leaderboard = true and
    (p_period = 'all' or s.started_at >= case p_period
      when 'month' then date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'
      else date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York'
    end)
  group by p.id, p.display_name
  order by 3 desc, 4 desc, p.display_name asc
  limit 50;
$$;

create or replace function public.get_team_leaderboard(p_period text default 'week')
returns table(id uuid, name text, minutes bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, coalesce(sum(s.minutes),0)::bigint,
    (select count(*) from public.team_memberships m2 where m2.team_id = t.id and m2.left_at is null)::bigint
  from public.teams t
  left join public.team_memberships m on m.team_id = t.id
  left join public.profiles p on p.id = m.user_id and p.show_on_leaderboard = true
  left join public.play_sessions s on s.user_id = p.id and s.status in ('pending','approved')
    and s.started_at >= m.joined_at and (m.left_at is null or s.started_at < m.left_at)
    and (p_period = 'all' or s.started_at >= case p_period
      when 'month' then date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'
      else date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York'
    end)
  group by t.id, t.name
  order by 3 desc, 4 desc, t.name asc
  limit 50;
$$;

create or replace function public.is_pilot_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from private.admins where user_id = auth.uid());
$$;

create or replace function public.admin_pending_sessions()
returns table(id uuid, display_name text, minutes int, started_at timestamptz, method text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_pilot_admin() then raise exception 'Not authorized'; end if;
  return query select s.id, p.display_name, s.minutes, s.started_at, s.method
    from public.play_sessions s join public.profiles p on p.id = s.user_id
    where s.status = 'pending' order by s.created_at desc limit 100;
end $$;

create or replace function public.review_session(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_pilot_admin() then raise exception 'Not authorized'; end if;
  update public.play_sessions set status = case when p_approve then 'approved' else 'rejected' end
    where id = p_id and status = 'pending';
  if not found then raise exception 'Pending session not found'; end if;
end $$;

-- Postgres grants execute to PUBLIC by default; remove then allow only exact callers.
revoke all on function public.start_session() from public;
revoke all on function public.stop_session(uuid) from public;
revoke all on function public.log_session(date,int) from public;
revoke all on function public.create_team(text) from public;
revoke all on function public.join_team(text) from public;
revoke all on function public.leave_team() from public;
revoke all on function public.get_leaderboard(text) from public;
revoke all on function public.get_team_leaderboard(text) from public;
revoke all on function public.is_pilot_admin() from public;
revoke all on function public.admin_pending_sessions() from public;
revoke all on function public.review_session(uuid,boolean) from public;
grant execute on function public.start_session(), public.stop_session(uuid), public.log_session(date,int),
  public.create_team(text), public.join_team(text), public.leave_team(),
  public.is_pilot_admin(), public.admin_pending_sessions(), public.review_session(uuid,boolean)
  to authenticated;
grant execute on function public.get_leaderboard(text), public.get_team_leaderboard(text) to anon, authenticated;

-- After Joe registers, grant admin access by running manually (substitute his auth UUID):
-- insert into private.admins(user_id) values ('AUTH-USER-UUID-HERE');
