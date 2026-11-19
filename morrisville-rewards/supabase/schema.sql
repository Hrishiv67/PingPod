-- PingPod Morrisville Rewards — full schema, generated from supabase/migrations (in order).
-- For a brand-new project you can run this file once in the SQL editor.
-- Source of truth: the numbered files in supabase/migrations. Regenerate with: npm run db:schema

-- ════════ 20261119000100_core.sql ════════
-- PingPod Morrisville Rewards · 001 core tables, row-level security, helpers.
-- Every write goes through SECURITY DEFINER functions (see later migrations).
-- Clients (web + iOS) only get SELECT on their own rows plus public settings.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ── Venue + pilot settings ─────────────────────────────────────────────
create table public.venues (
  id text primary key,
  name text not null,
  timezone text not null
);
insert into public.venues values ('morrisville', 'PingPod Morrisville', 'America/New_York');

create table public.pilot_settings (
  id int primary key default 1 check (id = 1),
  venue_name text not null default 'PingPod Morrisville',
  public_app_url text not null default 'https://pingpod-morrisville-rewards.vercel.app'
    check (public_app_url ~ '^https?://'),
  pilot_start date,
  pilot_end date,
  max_session_minutes int not null default 180 check (max_session_minutes between 30 and 480),
  checkin_reminder_minutes int not null default 90 check (checkin_reminder_minutes between 15 and 240),
  manual_min_minutes int not null default 5 check (manual_min_minutes between 1 and 60),
  manual_max_minutes int not null default 180 check (manual_max_minutes between 15 and 480),
  backdate_days int not null default 7 check (backdate_days between 0 and 60),
  daily_minutes_cap int not null default 300 check (daily_minutes_cap between 30 and 720),
  crew_min_size int not null default 2 check (crew_min_size between 1 and 10),
  crew_max_size int not null default 8 check (crew_max_size between 2 and 30),
  auto_approve_timer boolean not null default false,
  default_board_scope text not null default 'verified' check (default_board_scope in ('verified', 'community')),
  display_scope text not null default 'verified' check (display_scope in ('verified', 'community')),
  display_rotation_seconds int not null default 15 check (display_rotation_seconds between 8 and 60),
  display_slides text[] not null default '{minutes,streaks,crews,highlights}'
    check (display_slides <@ array['minutes', 'streaks', 'crews', 'highlights', 'longest']::text[]
      and cardinality(display_slides) > 0),
  boards_enabled text[] not null default '{minutes,streaks,longest,spindex,crews}'
    check (boards_enabled <@ array['minutes', 'streaks', 'longest', 'spindex', 'crews']::text[]),
  rewards_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint crew_size_order check (crew_min_size <= crew_max_size),
  constraint manual_range_order check (manual_min_minutes < manual_max_minutes)
);
insert into public.pilot_settings default values;

-- ── Players ────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,19}$'),
  avatar_color text not null default 'pink'
    check (avatar_color in ('pink', 'white', 'blue', 'green', 'orange', 'purple')),
  show_on_leaderboard boolean not null default true,
  show_spindex boolean not null default true,
  hidden_by_admin boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_display_name_ci on public.profiles (lower(display_name));

-- ── Playing sessions ───────────────────────────────────────────────────
-- Times are server clock (timestamptz). played_on is the Morrisville calendar date.
create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null default 'morrisville' references public.venues(id),
  method text not null check (method in ('timer', 'manual')),
  status text not null check (status in ('active', 'pending', 'approved', 'rejected', 'cancelled')),
  started_at timestamptz not null,
  ended_at timestamptz,
  played_on date not null,
  minutes int not null default 0 check (minutes between 0 and 720),
  submitted_minutes int,
  note text check (char_length(note) <= 280),
  client_request_id uuid,
  last_checkin_at timestamptz,
  auto_closed boolean not null default false,
  flags text[] not null default '{}',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_has_no_end check ((status = 'active') = (ended_at is null)),
  constraint end_after_start check (ended_at is null or ended_at >= started_at)
);
create unique index play_sessions_one_active on public.play_sessions (user_id) where status = 'active';
create unique index play_sessions_client_request on public.play_sessions (user_id, client_request_id)
  where client_request_id is not null;
create index play_sessions_user_day on public.play_sessions (user_id, played_on desc);
create index play_sessions_status_day on public.play_sessions (status, played_on);

-- ── Crews ──────────────────────────────────────────────────────────────
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 24),
  invite_code text not null unique,
  owner_id uuid references auth.users(id) on delete set null,
  hidden_by_admin boolean not null default false,
  hidden_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crews_name_ci on public.crews (lower(name)) where archived_at is null;

-- Membership history is kept forever; crew totals only count play while a member.
create table public.crew_memberships (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason text,
  constraint membership_order check (left_at is null or left_at >= joined_at)
);
create unique index crew_memberships_one_active on public.crew_memberships (user_id) where left_at is null;
create index crew_memberships_crew on public.crew_memberships (crew_id);

-- ── SPINDEX (self-reported unless staff verify it; never calculated here) ──
create table public.spindex_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating int not null check (rating between 0 and 3000),
  source text not null default 'self_reported'
    check (source in ('self_reported', 'staff_verified', 'official_integration')),
  status text not null default 'unverified'
    check (status in ('unverified', 'verified', 'rejected', 'superseded')),
  player_note text check (char_length(player_note) <= 200),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verification_source text,
  created_at timestamptz not null default now()
);
create index spindex_user on public.spindex_ratings (user_id, created_at desc);

-- ── Player requests (corrections, privacy, deletion, other) ────────────
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('correction', 'privacy', 'deletion', 'other')),
  session_id uuid references public.play_sessions(id) on delete set null,
  message text not null check (char_length(message) between 1 and 600),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  admin_response text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Physical rewards: off until the franchisee approves terms ─────────
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 60),
  description text check (char_length(description) <= 300),
  criteria text check (char_length(criteria) <= 300),
  enabled boolean not null default false,
  approval_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enabled_needs_approval check (not enabled or char_length(coalesce(approval_note, '')) >= 5)
);

-- ── Private (not exposed through the API) ─────────────────────────────
create table private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  added_by uuid,
  added_at timestamptz not null default now()
);
create table private.admin_claim_codes (
  code_hash text primary key,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  expires_at timestamptz not null,
  used_by uuid,
  used_at timestamptz
);
create table private.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_time on private.audit_log (created_at desc);
create table private.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on private.rate_events (user_id, action, at desc);
create table private.blocked_terms (term text primary key);
insert into private.blocked_terms values
  ('fuck'), ('shit'), ('bitch'), ('cunt'), ('pussy'), ('nigger'), ('nigga'), ('faggot'),
  ('retard'), ('whore'), ('slut'), ('porn'), ('nazi'), ('hitler'), ('pingpodstaff');

-- ── Row-level security: own rows only; everything else via functions ──
alter table public.venues enable row level security;
alter table public.pilot_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.play_sessions enable row level security;
alter table public.crews enable row level security;
alter table public.crew_memberships enable row level security;
alter table public.spindex_ratings enable row level security;
alter table public.support_requests enable row level security;
alter table public.rewards enable row level security;
alter table private.admins enable row level security;
alter table private.admin_claim_codes enable row level security;
alter table private.audit_log enable row level security;
alter table private.rate_events enable row level security;
alter table private.blocked_terms enable row level security;

create policy venues_read on public.venues for select to anon, authenticated using (true);
create policy settings_read on public.pilot_settings for select to anon, authenticated using (true);
create policy profiles_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy sessions_own on public.play_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy memberships_own on public.crew_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy crews_member on public.crews for select to authenticated using (
  exists (select 1 from public.crew_memberships m
          where m.crew_id = crews.id and m.user_id = (select auth.uid()) and m.left_at is null));
create policy spindex_own on public.spindex_ratings for select to authenticated using (user_id = (select auth.uid()));
create policy requests_own on public.support_requests for select to authenticated using (user_id = (select auth.uid()));
create policy rewards_live on public.rewards for select to anon, authenticated using (
  enabled and (select s.rewards_enabled from public.pilot_settings s where s.id = 1));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.venues, public.pilot_settings, public.rewards to anon, authenticated;
grant select on public.profiles, public.play_sessions, public.crews, public.crew_memberships,
  public.spindex_ratings, public.support_requests to authenticated;

-- ── Helpers (private schema: callable only from definer functions) ────
create function private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch before update on public.profiles for each row execute function private.touch();
create trigger touch before update on public.play_sessions for each row execute function private.touch();
create trigger touch before update on public.crews for each row execute function private.touch();
create trigger touch before update on public.rewards for each row execute function private.touch();
create trigger touch before update on public.pilot_settings for each row execute function private.touch();

-- Timer sessions belong to the Morrisville calendar day they started on.
create function private.set_played_on() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.method = 'timer' then
    new.played_on := (new.started_at at time zone 'America/New_York')::date;
  end if;
  return new;
end $$;
create trigger set_played_on before insert or update of started_at on public.play_sessions
  for each row execute function private.set_played_on();

create function private.today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/New_York')::date $$;

create function private.week_start(p_day date) returns date language sql immutable set search_path = '' as $$
  select date_trunc('week', p_day::timestamp)::date $$;

create function private.period_start(p_period text) returns date language plpgsql stable set search_path = '' as $$
begin
  return case p_period
    when 'week' then private.week_start(private.today())
    when 'month' then date_trunc('month', private.today()::timestamp)::date
    when 'all' then date '2000-01-01'
    else null end;
end $$;

create function private.statuses(p_scope text) returns text[] language sql immutable set search_path = '' as $$
  select case when p_scope = 'community' then array['approved', 'pending'] else array['approved'] end $$;

create function private.settings() returns public.pilot_settings language sql stable set search_path = '' as $$
  select * from public.pilot_settings where id = 1 $$;

create function private.clean_text(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '') $$;

create function private.has_blocked_term(p text) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.blocked_terms t
    where position(t.term in regexp_replace(lower(coalesce(p, '')), '[^a-z]', '', 'g')) > 0) $$;

create function private.require_user() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Please sign in first.'; end if;
  return v;
end $$;

create function private.require_profile() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not exists (select 1 from public.profiles where id = v) then
    raise exception 'Choose a nickname first.';
  end if;
  return v;
end $$;

create function private.is_admin(p uuid) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = p) $$;

create function private.require_admin() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.is_admin(v) then raise exception 'Staff access only.'; end if;
  return v;
end $$;

create function private.require_owner() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not exists (select 1 from private.admins where user_id = v and role = 'owner') then
    raise exception 'Only the pilot owner can change this.';
  end if;
  return v;
end $$;

create function private.rate_limit(p_action text, p_max int, p_window interval)
returns void language plpgsql set search_path = '' as $$
declare v uuid := auth.uid(); n int;
begin
  select count(*) into n from private.rate_events
    where user_id = v and action = p_action and at > now() - p_window;
  if n >= p_max then raise exception 'You''ve done that a lot recently. Try again later.'; end if;
  insert into private.rate_events (user_id, action) values (v, p_action);
end $$;

create function private.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}')
returns void language sql set search_path = '' as $$
  insert into private.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}')) $$;

-- Unambiguous invite codes: no 0/O/1/I.
create function private.new_code(p_len int default 8) returns text language plpgsql volatile set search_path = '' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(p_len); out text := '';
begin
  for i in 0 .. p_len - 1 loop
    out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- Abandoned timers stop at the configured maximum and are flagged for staff.
create function private.close_stale_sessions(p_user uuid default null)
returns int language plpgsql set search_path = '' as $$
declare v_max int := (select max_session_minutes from public.pilot_settings where id = 1); n int;
begin
  update public.play_sessions
     set status = 'pending',
         ended_at = started_at + make_interval(mins => v_max),
         minutes = v_max,
         submitted_minutes = v_max,
         auto_closed = true,
         flags = array_append(flags, 'auto_closed')
   where status = 'active'
     and started_at < now() - make_interval(mins => v_max)
     and (p_user is null or user_id = p_user);
  get diagnostics n = row_count;
  return n;
end $$;

-- Tell listening displays that standings may have changed (no data in the payload).
create function private.notify_boards() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'changed', 'leaderboard', false);
  exception when others then null;
  end;
  return null;
end $$;
create trigger notify_boards after insert or update or delete on public.play_sessions
  for each statement execute function private.notify_boards();
create trigger notify_boards after insert or update or delete on public.profiles
  for each statement execute function private.notify_boards();
create trigger notify_boards after insert or update or delete on public.crews
  for each statement execute function private.notify_boards();
create trigger notify_boards after insert or update or delete on public.crew_memberships
  for each statement execute function private.notify_boards();
create trigger notify_boards after insert or update or delete on public.spindex_ratings
  for each statement execute function private.notify_boards();

-- ════════ 20261119000200_player_functions.sql ════════
-- PingPod Morrisville Rewards · 002 player functions (profile, timer, manual log, crews, SPINDEX, requests).
-- All validation happens here so the web app and the iOS app enforce identical rules.

-- ── Profile ────────────────────────────────────────────────────────────
create function public.save_profile(
  p_display_name text,
  p_avatar_color text default 'pink',
  p_show_on_leaderboard boolean default true,
  p_show_spindex boolean default true
) returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_name text := private.clean_text(p_display_name);
        r public.profiles; v_old text;
begin
  if v_name is null or v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,19}$' then
    raise exception 'Nicknames are 2–20 characters: letters, numbers, spaces, _ . or -';
  end if;
  if private.has_blocked_term(v_name) then raise exception 'Please choose a different nickname.'; end if;
  if exists (select 1 from public.profiles where lower(display_name) = lower(v_name) and id <> v_uid) then
    raise exception 'That nickname is taken. Try another.';
  end if;
  select display_name into v_old from public.profiles where id = v_uid;
  if v_old is not null and v_old <> v_name then perform private.rate_limit('rename', 5, interval '1 day'); end if;
  insert into public.profiles (id, display_name, avatar_color, show_on_leaderboard, show_spindex)
  values (v_uid, v_name,
          case when p_avatar_color in ('pink', 'white', 'blue', 'green', 'orange', 'purple') then p_avatar_color else 'pink' end,
          coalesce(p_show_on_leaderboard, true), coalesce(p_show_spindex, true))
  on conflict (id) do update set display_name = excluded.display_name, avatar_color = excluded.avatar_color,
    show_on_leaderboard = excluded.show_on_leaderboard, show_spindex = excluded.show_spindex
  returning * into r;
  return r;
exception when unique_violation then
  raise exception 'That nickname is taken. Try another.';
end $$;

-- ── Timer ──────────────────────────────────────────────────────────────
create function public.start_session(p_client_request_id uuid default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.play_sessions;
begin
  perform private.close_stale_sessions(v_uid);
  if p_client_request_id is not null then
    select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
    if found then return r; end if;
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and status = 'active') then
    raise exception 'You already have a session running.';
  end if;
  perform private.rate_limit('start', 12, interval '1 hour');
  insert into public.play_sessions (user_id, method, status, started_at, played_on, client_request_id)
  values (v_uid, 'timer', 'active', clock_timestamp(), private.today(), p_client_request_id)
  returning * into r;
  return r;
exception when unique_violation then
  raise exception 'You already have a session running.';
end $$;

create function public.checkin_session(p_id uuid)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.play_sessions;
begin
  update public.play_sessions set last_checkin_at = clock_timestamp()
   where id = p_id and user_id = v_uid and status = 'active' returning * into r;
  if not found then raise exception 'That session already ended.'; end if;
  return r;
end $$;

-- Idempotent: stopping an already-stopped session returns it unchanged (no double counting).
-- p_ended_at lets a phone that lost signal report when the player tapped Finish;
-- the server only accepts it within the last 30 minutes and never in the future.
create function public.stop_session(p_id uuid, p_ended_at timestamptz default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.play_sessions; s public.pilot_settings := private.settings();
        v_now timestamptz := clock_timestamp(); v_end timestamptz; v_min int;
begin
  select * into r from public.play_sessions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Session not found.'; end if;
  if r.status <> 'active' then return r; end if;
  v_end := least(v_now, coalesce(p_ended_at, v_now));
  v_end := greatest(v_end, v_now - interval '30 minutes', r.started_at);
  v_end := least(v_end, r.started_at + make_interval(mins => s.max_session_minutes));
  v_min := floor(extract(epoch from (v_end - r.started_at)) / 60)::int;
  if v_min < s.manual_min_minutes then
    update public.play_sessions set status = 'cancelled', ended_at = v_end, minutes = 0, submitted_minutes = v_min,
      flags = array_append(flags, 'too_short')
     where id = p_id returning * into r;
    return r;
  end if;
  update public.play_sessions
     set ended_at = v_end, minutes = v_min, submitted_minutes = v_min,
         status = case when s.auto_approve_timer then 'approved' else 'pending' end,
         reviewed_at = case when s.auto_approve_timer then v_now end,
         review_reason = case when s.auto_approve_timer then 'Auto-approved timer session' end,
         flags = case when v_min >= s.max_session_minutes then array_append(flags, 'hit_max') else flags end
   where id = p_id returning * into r;
  return r;
end $$;

create function public.cancel_session(p_id uuid)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.play_sessions;
begin
  select * into r from public.play_sessions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Session not found.'; end if;
  if r.status = 'cancelled' then return r; end if;
  if r.status <> 'active' then raise exception 'That session already ended.'; end if;
  update public.play_sessions set status = 'cancelled', ended_at = clock_timestamp(), minutes = 0
   where id = p_id returning * into r;
  return r;
end $$;

-- ── Log past play ──────────────────────────────────────────────────────
create function public.log_session(
  p_played_on date, p_minutes int, p_note text default null, p_client_request_id uuid default null
) returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); s public.pilot_settings := private.settings();
        v_today date := private.today(); r public.play_sessions; v_total int; v_flags text[] := '{}';
        v_note text := private.clean_text(p_note); v_start timestamptz;
begin
  if p_client_request_id is not null then
    select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
    if found then return r; end if;
  end if;
  if p_minutes is null or p_minutes < s.manual_min_minutes or p_minutes > s.manual_max_minutes then
    raise exception 'Enter between % and % minutes.', s.manual_min_minutes, s.manual_max_minutes;
  end if;
  if p_played_on is null or p_played_on > v_today then raise exception 'That date is in the future.'; end if;
  if p_played_on < v_today - s.backdate_days then
    raise exception 'You can log play from the last % days. Ask staff for anything older.', s.backdate_days;
  end if;
  if char_length(v_note) > 280 then raise exception 'Keep notes under 280 characters.'; end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and status = 'active') then
    raise exception 'Finish your running session first.';
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'manual'
             and played_on = p_played_on and minutes = p_minutes and status in ('pending', 'approved')) then
    raise exception 'You already logged % minutes on that day.', p_minutes;
  end if;
  select coalesce(sum(minutes), 0) into v_total from public.play_sessions
   where user_id = v_uid and played_on = p_played_on and status in ('pending', 'approved');
  if v_total + p_minutes > s.daily_minutes_cap then
    raise exception 'That would be more than % minutes in one day. Ask staff if that''s right.', s.daily_minutes_cap;
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'timer'
             and played_on = p_played_on and status in ('pending', 'approved')) then
    v_flags := array_append(v_flags, 'same_day_as_timer');
  end if;
  perform private.rate_limit('manual_log', 6, interval '1 hour');
  if p_played_on = v_today then
    v_start := greatest(p_played_on::timestamp at time zone 'America/New_York',
                        clock_timestamp() - make_interval(mins => p_minutes));
  else
    v_start := (p_played_on::timestamp + interval '12 hours') at time zone 'America/New_York';
  end if;
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes,
                                    submitted_minutes, note, client_request_id, flags)
  values (v_uid, 'manual', 'pending', v_start, v_start + make_interval(mins => p_minutes), p_played_on,
          p_minutes, p_minutes, v_note, p_client_request_id, v_flags)
  returning * into r;
  return r;
exception when unique_violation then
  select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
  if found then return r; end if;
  raise;
end $$;

-- ── Crews ──────────────────────────────────────────────────────────────
create function private.valid_crew_name(p text) returns text language plpgsql stable set search_path = '' as $$
declare v text := private.clean_text(p);
begin
  if v is null or char_length(v) < 3 or char_length(v) > 24 or v !~ '^[A-Za-z0-9][A-Za-z0-9 _.''&!\-]*$' then
    raise exception 'Crew names are 3–24 characters: letters, numbers, spaces and - _ . '' & !';
  end if;
  if private.has_blocked_term(v) then raise exception 'Please choose a different crew name.'; end if;
  return v;
end $$;

create function private.active_crew(p_uid uuid) returns uuid language sql stable set search_path = '' as $$
  select m.crew_id from public.crew_memberships m join public.crews c on c.id = m.crew_id
   where m.user_id = p_uid and m.left_at is null and c.archived_at is null limit 1 $$;

create function public.create_crew(p_name text)
returns public.crews language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); v_name text := private.valid_crew_name(p_name); c public.crews;
begin
  if private.active_crew(v_uid) is not null then raise exception 'Leave your current crew first.'; end if;
  if exists (select 1 from public.crews where lower(name) = lower(v_name) and archived_at is null) then
    raise exception 'That crew name is taken.';
  end if;
  perform private.rate_limit('create_crew', 3, interval '1 day');
  insert into public.crews (name, invite_code, owner_id) values (v_name, private.new_code(8), v_uid) returning * into c;
  insert into public.crew_memberships (crew_id, user_id) values (c.id, v_uid);
  return c;
exception when unique_violation then
  raise exception 'That crew name is taken.';
end $$;

-- Lets the invite page show the crew before someone signs up.
create function public.preview_crew(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name,
           'members', (select count(*) from public.crew_memberships m where m.crew_id = c.id and m.left_at is null),
           'max_members', (select crew_max_size from public.pilot_settings where id = 1))
    from public.crews c
   where c.invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and c.archived_at is null and not c.hidden_by_admin $$;

create function public.join_crew(p_code text)
returns public.crews language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); c public.crews; v_current uuid; v_count int;
        v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  select * into c from public.crews where invite_code = v_code and archived_at is null for update;
  if not found then raise exception 'That invite code didn''t work. Check it and try again.'; end if;
  v_current := private.active_crew(v_uid);
  if v_current = c.id then return c; end if;
  if v_current is not null then raise exception 'You''re already in a crew. Leave it first to join another.'; end if;
  select count(*) into v_count from public.crew_memberships where crew_id = c.id and left_at is null;
  if v_count >= (select crew_max_size from public.pilot_settings where id = 1) then
    raise exception 'That crew is full.';
  end if;
  perform private.rate_limit('join_crew', 6, interval '1 day');
  insert into public.crew_memberships (crew_id, user_id) values (c.id, v_uid);
  return c;
exception when unique_violation then
  raise exception 'You''re already in a crew.';
end $$;

-- Leaving keeps history. If the owner leaves, the longest-standing member takes over;
-- if nobody is left, the crew is archived.
create function private.leave_crew_for(p_uid uuid, p_reason text) returns void
language plpgsql set search_path = '' as $$
declare v_crew uuid := private.active_crew(p_uid); v_owner uuid; v_next uuid;
begin
  if v_crew is null then return; end if;
  select owner_id into v_owner from public.crews where id = v_crew for update;
  update public.crew_memberships set left_at = clock_timestamp(), left_reason = p_reason
   where user_id = p_uid and crew_id = v_crew and left_at is null;
  if v_owner = p_uid or v_owner is null then
    select user_id into v_next from public.crew_memberships
     where crew_id = v_crew and left_at is null order by joined_at limit 1;
    if v_next is null then
      update public.crews set archived_at = clock_timestamp() where id = v_crew;
    else
      update public.crews set owner_id = v_next where id = v_crew;
    end if;
  end if;
end $$;

create function public.leave_crew() returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if private.active_crew(v_uid) is null then raise exception 'You''re not in a crew.'; end if;
  perform private.leave_crew_for(v_uid, 'left');
end $$;

create function private.require_crew_owner(p_uid uuid) returns uuid language plpgsql stable set search_path = '' as $$
declare v_crew uuid := private.active_crew(p_uid);
begin
  if v_crew is null or not exists (select 1 from public.crews where id = v_crew and owner_id = p_uid) then
    raise exception 'Only the crew owner can do that.';
  end if;
  return v_crew;
end $$;

create function public.rename_crew(p_name text)
returns public.crews language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.require_crew_owner(v_uid);
        v_name text := private.valid_crew_name(p_name); c public.crews;
begin
  if exists (select 1 from public.crews where lower(name) = lower(v_name) and archived_at is null and id <> v_crew) then
    raise exception 'That crew name is taken.';
  end if;
  perform private.rate_limit('rename_crew', 5, interval '1 day');
  update public.crews set name = v_name where id = v_crew returning * into c;
  return c;
exception when unique_violation then
  raise exception 'That crew name is taken.';
end $$;

create function public.regenerate_crew_code()
returns public.crews language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.require_crew_owner(v_uid); c public.crews;
begin
  update public.crews set invite_code = private.new_code(8) where id = v_crew returning * into c;
  return c;
end $$;

create function public.transfer_crew(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.require_crew_owner(v_uid);
begin
  if not exists (select 1 from public.crew_memberships where crew_id = v_crew and user_id = p_user_id and left_at is null) then
    raise exception 'That player isn''t in your crew.';
  end if;
  update public.crews set owner_id = p_user_id where id = v_crew;
end $$;

create function public.remove_crew_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.require_crew_owner(v_uid);
begin
  if p_user_id = v_uid then raise exception 'Use Leave crew instead.'; end if;
  update public.crew_memberships set left_at = clock_timestamp(), left_reason = 'removed_by_owner'
   where crew_id = v_crew and user_id = p_user_id and left_at is null;
  if not found then raise exception 'That player isn''t in your crew.'; end if;
end $$;

-- ── SPINDEX: one current claim per player; staff can verify it ────────
create function public.submit_spindex(p_rating int, p_note text default null)
returns public.spindex_ratings language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.spindex_ratings; v_note text := private.clean_text(p_note);
begin
  if p_rating is null or p_rating < 0 or p_rating > 3000 then
    raise exception 'SPINDEX ratings run from 0 to 3000.';
  end if;
  if char_length(v_note) > 200 then raise exception 'Keep the note under 200 characters.'; end if;
  perform private.rate_limit('spindex', 5, interval '1 day');
  update public.spindex_ratings set status = 'superseded'
   where user_id = v_uid and status in ('unverified', 'verified');
  insert into public.spindex_ratings (user_id, rating, player_note) values (v_uid, p_rating, v_note) returning * into r;
  return r;
end $$;

create function public.remove_spindex() returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  update public.spindex_ratings set status = 'superseded' where user_id = v_uid and status in ('unverified', 'verified');
end $$;

-- ── Requests to staff (corrections, privacy, deletion) ────────────────
create function public.submit_request(p_kind text, p_message text, p_session_id uuid default null)
returns public.support_requests language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.support_requests; v_msg text := private.clean_text(p_message);
begin
  if p_kind not in ('correction', 'privacy', 'deletion', 'other') then raise exception 'Unknown request type.'; end if;
  if v_msg is null or char_length(v_msg) > 600 then raise exception 'Write a short message (up to 600 characters).'; end if;
  if p_session_id is not null and not exists (select 1 from public.play_sessions where id = p_session_id and user_id = v_uid) then
    raise exception 'Session not found.';
  end if;
  perform private.rate_limit('request', 5, interval '1 day');
  insert into public.support_requests (user_id, kind, session_id, message) values (v_uid, p_kind, p_session_id, v_msg)
  returning * into r;
  return r;
end $$;

-- Permanently removes the player's account, sessions, memberships and ratings.
create function public.delete_my_account() returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.leave_crew_for(v_uid, 'account_deleted');
  perform private.audit('account.deleted_by_player', 'user', v_uid::text, '{}');
  delete from auth.users where id = v_uid;
end $$;

-- ════════ 20261119000300_boards_and_stats.sql ════════
-- PingPod Morrisville Rewards · 003 leaderboards, streaks, stats, achievements, display feed.
-- Scope 'verified' = staff-approved sessions only (default, prize-eligible).
-- Scope 'community' = approved + pending (self-reported) sessions; always labeled as such in the UI.
-- Weeks start Monday in America/New_York. Tie-breaks are deterministic:
--   minutes  → value desc, whoever reached it first (earlier last counted session), nickname, id
--   longest  → value desc, earlier session, nickname, id
--   streaks  → current desc, longest desc, total minutes desc, nickname, id
--   spindex  → rating desc, verified before self-reported, earlier claim, nickname, id
--   crews    → minutes desc, whoever reached it first, crew name, id

create function private.streaks_all(p_statuses text[], p_user uuid default null)
returns table (uid uuid, cur int, longest int, weeks int, mins int)
language sql stable set search_path = '' as $$
  with q as (
    select s.user_id, s.played_on, s.minutes from public.play_sessions s
     where s.status = any (p_statuses) and (p_user is null or s.user_id = p_user)),
  wk as (select distinct q.user_id, private.week_start(q.played_on) w from q),
  isl as (select wk.user_id, wk.w, wk.w - (7 * row_number() over (partition by wk.user_id order by wk.w))::int g from wk),
  runs as (select isl.user_id, count(*)::int len, max(isl.w) last_w from isl group by isl.user_id, isl.g)
  select r.user_id,
         coalesce(max(r.len) filter (where r.last_w >= private.week_start(private.today()) - 7), 0)::int,
         max(r.len)::int,
         (select count(*) from wk where wk.user_id = r.user_id)::int,
         (select coalesce(sum(q.minutes), 0) from q where q.user_id = r.user_id)::int
    from runs r group by r.user_id $$;

create function private.board(p_metric text, p_period text, p_scope text)
returns table (user_id uuid, display_name text, avatar_color text, value int, secondary int,
               sessions int, detail text, rank int)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare v_st text[] := private.statuses(p_scope); v_start date := private.period_start(p_period);
begin
  if p_scope is null or p_scope not in ('verified', 'community') then raise exception 'Unknown scope.'; end if;
  if v_start is null then raise exception 'Unknown period.'; end if;
  if p_metric = 'minutes' then
    return query
    with agg as (
      select s.user_id uid, sum(s.minutes)::int v, count(*)::int n, max(s.ended_at) last_at
        from public.play_sessions s where s.status = any (v_st) and s.played_on >= v_start group by s.user_id)
    select a.uid, p.display_name, p.avatar_color, a.v, null::int, a.n, null::text,
           (row_number() over (order by a.v desc, a.last_at, lower(p.display_name), a.uid))::int
      from agg a join public.profiles p on p.id = a.uid
     where a.v > 0 and p.show_on_leaderboard and not p.hidden_by_admin;
  elsif p_metric = 'longest' then
    return query
    with best as (
      select distinct on (s.user_id) s.user_id uid, s.minutes v, s.ended_at fin, s.played_on d
        from public.play_sessions s where s.status = any (v_st) and s.played_on >= v_start
       order by s.user_id, s.minutes desc, s.ended_at),
    cnt as (
      select s.user_id uid, count(*)::int n from public.play_sessions s
       where s.status = any (v_st) and s.played_on >= v_start group by s.user_id)
    select b.uid, p.display_name, p.avatar_color, b.v, null::int, c.n, to_char(b.d, 'YYYY-MM-DD'),
           (row_number() over (order by b.v desc, b.fin, lower(p.display_name), b.uid))::int
      from best b join cnt c on c.uid = b.uid join public.profiles p on p.id = b.uid
     where b.v > 0 and p.show_on_leaderboard and not p.hidden_by_admin;
  elsif p_metric = 'streaks' then
    return query
    select st.uid, p.display_name, p.avatar_color, st.cur, st.longest, st.weeks, null::text,
           (row_number() over (order by st.cur desc, st.longest desc, st.mins desc, lower(p.display_name), st.uid))::int
      from private.streaks_all(v_st) st join public.profiles p on p.id = st.uid
     where st.cur > 0 and p.show_on_leaderboard and not p.hidden_by_admin;
  elsif p_metric = 'spindex' then
    return query
    with cur as (
      select distinct on (r.user_id) r.user_id uid, r.rating v, r.status st, coalesce(r.verified_at, r.created_at) ts
        from public.spindex_ratings r where r.status in ('unverified', 'verified')
       order by r.user_id, r.created_at desc)
    select c.uid, p.display_name, p.avatar_color, c.v, null::int, null::int,
           case when c.st = 'verified' then 'verified' else 'self_reported' end,
           (row_number() over (order by c.v desc, (c.st = 'verified') desc, c.ts, lower(p.display_name), c.uid))::int
      from cur c join public.profiles p on p.id = c.uid
     where (p_scope = 'community' or c.st = 'verified')
       and p.show_spindex and p.show_on_leaderboard and not p.hidden_by_admin;
  else
    raise exception 'Unknown leaderboard.';
  end if;
end $$;

-- Crew totals only include play while each person was a member (membership history).
create function private.crew_board(p_period text, p_scope text)
returns table (crew_id uuid, name text, minutes int, members int, contributors int, avg_minutes int, rank int)
language sql stable set search_path = '' as $$
  with cfg as (
    select private.statuses(p_scope) st, private.period_start(p_period) d,
           (select crew_min_size from public.pilot_settings where id = 1) min_size),
  am as (select m.crew_id cid, count(*)::int n from public.crew_memberships m where m.left_at is null group by m.crew_id),
  contrib as (
    select m.crew_id cid, s.user_id uid, s.minutes, s.ended_at
      from cfg, public.crew_memberships m
      join public.play_sessions s on s.user_id = m.user_id and s.started_at >= m.joined_at
                                  and (m.left_at is null or s.started_at < m.left_at)
     where s.status = any (cfg.st) and s.played_on >= cfg.d),
  agg as (select cid, sum(minutes)::int mins, count(distinct uid)::int contributors, max(ended_at) last_at
            from contrib group by cid)
  select c.id, c.name, coalesce(a.mins, 0), am.n, coalesce(a.contributors, 0), (coalesce(a.mins, 0) / am.n)::int,
         (row_number() over (order by coalesce(a.mins, 0) desc, a.last_at nulls last, lower(c.name), c.id))::int
    from public.crews c join am on am.cid = c.id left join agg a on a.cid = c.id
   where c.archived_at is null and not c.hidden_by_admin and am.n >= (select min_size from cfg)
     and (select d from cfg) is not null $$;

create function public.get_leaderboard(
  p_metric text default 'minutes', p_period text default 'week', p_scope text default 'verified', p_limit int default 50)
returns table (rank int, user_id uuid, display_name text, avatar_color text, value int, secondary int,
               sessions int, detail text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select b.rank, b.user_id, b.display_name, b.avatar_color, b.value, b.secondary, b.sessions, b.detail,
         coalesce(b.user_id = auth.uid(), false)
    from private.board(p_metric, p_period, p_scope) b
   where b.rank <= least(greatest(coalesce(p_limit, 50), 1), 200) or b.user_id = auth.uid()
   order by b.rank $$;

create function public.get_crew_leaderboard(
  p_period text default 'week', p_scope text default 'verified', p_limit int default 50)
returns table (rank int, crew_id uuid, name text, minutes int, members int, contributors int,
               avg_minutes int, is_mine boolean)
language sql stable security definer set search_path = '' as $$
  select b.rank, b.crew_id, b.name, b.minutes, b.members, b.contributors, b.avg_minutes,
         coalesce(b.crew_id = private.active_crew(auth.uid()), false)
    from private.crew_board(p_period, p_scope) b
   where b.rank <= least(greatest(coalesce(p_limit, 50), 1), 200)
      or b.crew_id = private.active_crew(auth.uid())
   order by b.rank $$;

-- Player's own crew: members, contributions while a member, rank.
create function public.get_my_crew(p_period text default 'week', p_scope text default 'verified')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.active_crew(v_uid); c public.crews;
        v_st text[] := private.statuses(p_scope); v_start date := private.period_start(p_period);
        s public.pilot_settings := private.settings();
begin
  if v_crew is null then return null; end if;
  if v_start is null or p_scope not in ('verified', 'community') then raise exception 'Unknown period or scope.'; end if;
  select * into c from public.crews where id = v_crew;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'invite_code', c.invite_code, 'is_owner', c.owner_id = v_uid,
    'created_at', c.created_at, 'hidden_by_admin', c.hidden_by_admin,
    'min_members', s.crew_min_size, 'max_members', s.crew_max_size,
    'rank', (select b.rank from private.crew_board(p_period, p_scope) b where b.crew_id = v_crew),
    'crews_ranked', (select count(*) from private.crew_board(p_period, p_scope)),
    'total_minutes', (
      select coalesce(sum(x.minutes), 0) from public.crew_memberships m
        join public.play_sessions x on x.user_id = m.user_id and x.started_at >= m.joined_at
                                    and (m.left_at is null or x.started_at < m.left_at)
       where m.crew_id = v_crew and x.status = any (v_st) and x.played_on >= v_start),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'display_name', p.display_name, 'avatar_color', p.avatar_color,
               'is_owner', m.user_id = c.owner_id, 'is_me', m.user_id = v_uid, 'joined_at', m.joined_at,
               'minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                            where x.user_id = m.user_id and x.started_at >= m.joined_at
                              and x.status = any (v_st) and x.played_on >= v_start))
             order by m.joined_at), '[]')
        from public.crew_memberships m join public.profiles p on p.id = m.user_id
       where m.crew_id = v_crew and m.left_at is null));
end $$;

create function private.user_stats(p_uid uuid) returns jsonb language sql stable set search_path = '' as $$
  with q as (select * from public.play_sessions s where s.user_id = p_uid and s.status in ('approved', 'pending')),
  w as (select private.week_start(private.today()) wk, date_trunc('month', private.today()::timestamp)::date mo),
  st as (select * from private.streaks_all(array['approved', 'pending'], p_uid))
  select jsonb_build_object(
    'week_verified', coalesce(sum(q.minutes) filter (where q.status = 'approved' and q.played_on >= (select wk from w)), 0),
    'week_pending', coalesce(sum(q.minutes) filter (where q.status = 'pending' and q.played_on >= (select wk from w)), 0),
    'month_verified', coalesce(sum(q.minutes) filter (where q.status = 'approved' and q.played_on >= (select mo from w)), 0),
    'month_pending', coalesce(sum(q.minutes) filter (where q.status = 'pending' and q.played_on >= (select mo from w)), 0),
    'total_verified', coalesce(sum(q.minutes) filter (where q.status = 'approved'), 0),
    'total_pending', coalesce(sum(q.minutes) filter (where q.status = 'pending'), 0),
    'sessions', count(q.id),
    'pending_sessions', count(q.id) filter (where q.status = 'pending'),
    'longest_session', coalesce(max(q.minutes), 0),
    'current_streak', coalesce((select cur from st), 0),
    'longest_streak', coalesce((select longest from st), 0),
    'rank_week_verified', (select b.rank from private.board('minutes', 'week', 'verified') b where b.user_id = p_uid),
    'rank_week_community', (select b.rank from private.board('minutes', 'week', 'community') b where b.user_id = p_uid),
    'ranked_week_verified', (select count(*) from private.board('minutes', 'week', 'verified')),
    'ranked_week_community', (select count(*) from private.board('minutes', 'week', 'community')))
  from q $$;

-- One call to load the app: profile, running timer, crew, SPINDEX, stats, settings, server clock.
create function public.get_me() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); p public.profiles; a public.play_sessions; v_crew jsonb; v_spindex jsonb;
begin
  perform private.close_stale_sessions(v_uid);
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('server_now', clock_timestamp(), 'profile', null, 'settings', to_jsonb(private.settings()));
  end if;
  select * into a from public.play_sessions where user_id = v_uid and status = 'active';
  select jsonb_build_object('id', c.id, 'name', c.name, 'invite_code', c.invite_code, 'is_owner', c.owner_id = v_uid)
    into v_crew from public.crews c where c.id = private.active_crew(v_uid);
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'status', r.status, 'source', r.source,
                            'verified_at', r.verified_at, 'created_at', r.created_at)
    into v_spindex from public.spindex_ratings r
   where r.user_id = v_uid and r.status in ('unverified', 'verified') order by r.created_at desc limit 1;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'profile', to_jsonb(p) - 'hidden_reason',
    'admin_role', (select role from private.admins where user_id = v_uid),
    'active_session', case when a.id is null then null else to_jsonb(a) end,
    'crew', v_crew,
    'spindex', v_spindex,
    'stats', private.user_stats(v_uid),
    'settings', to_jsonb(private.settings()));
end $$;

-- Achievements are derived from real activity every time (never stored, never awarded by hand).
-- Rejected sessions don't count, so an achievement can disappear if staff reject the time behind it.
create function public.get_my_achievements()
returns table (code text, title text, description text, target int, progress int, earned_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_user();
  v_total int; v_sessions int; v_first timestamptz; v_longest int; v_long_at timestamptz;
  v_t60 timestamptz; v_t300 timestamptz; v_t600 timestamptz; v_t1200 timestamptz;
  v_streak int; v_streak_day date; v_crew_at timestamptz; v_verified_at timestamptz; v_top5_day date;
begin
  select coalesce(sum(s.minutes), 0), count(*), min(s.ended_at), coalesce(max(s.minutes), 0)
    into v_total, v_sessions, v_first, v_longest
    from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending');
  select min(c.ended_at) filter (where c.cum >= 60), min(c.ended_at) filter (where c.cum >= 300),
         min(c.ended_at) filter (where c.cum >= 600), min(c.ended_at) filter (where c.cum >= 1200)
    into v_t60, v_t300, v_t600, v_t1200
    from (select s.ended_at, sum(s.minutes) over (order by s.ended_at, s.id) cum
            from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending')) c;
  select min(s.ended_at) into v_long_at from public.play_sessions s
   where s.user_id = v_uid and s.status in ('approved', 'pending') and s.minutes >= 120;
  with wk as (select distinct private.week_start(s.played_on) w from public.play_sessions s
               where s.user_id = v_uid and s.status in ('approved', 'pending')),
       isl as (select wk.w, wk.w - (7 * row_number() over (order by wk.w))::int g from wk),
       pos as (select isl.w, row_number() over (partition by isl.g order by isl.w) p,
                      count(*) over (partition by isl.g) len from isl)
  select max(pos.len)::int, min(pos.w) filter (where pos.p = 3) into v_streak, v_streak_day from pos;
  select min(m.joined_at) into v_crew_at from public.crew_memberships m where m.user_id = v_uid;
  select min(coalesce(s.reviewed_at, s.ended_at)) into v_verified_at from public.play_sessions s
   where s.user_id = v_uid and s.status = 'approved';
  with weekly as (
    select private.week_start(s.played_on) w, s.user_id u, sum(s.minutes) m
      from public.play_sessions s join public.profiles p on p.id = s.user_id
     where s.status = 'approved' and not p.hidden_by_admin
       and private.week_start(s.played_on) < private.week_start(private.today())
     group by 1, 2),
  ranked as (select weekly.w, weekly.u, rank() over (partition by weekly.w order by weekly.m desc) r from weekly)
  select min(ranked.w) into v_top5_day from ranked where ranked.u = v_uid and ranked.r <= 5;
  return query select * from (values
    ('first_session', 'First session', 'Finish your first playing session.', 1, least(v_sessions, 1), v_first),
    ('first_hour', 'First hour', 'Play 60 minutes in total.', 60, least(v_total, 60), v_t60),
    ('minutes_300', '300 club', 'Reach 300 total minutes.', 300, least(v_total, 300), v_t300),
    ('minutes_600', '600 club', 'Reach 600 total minutes.', 600, least(v_total, 600), v_t600),
    ('minutes_1200', 'Twenty hours', 'Reach 1,200 total minutes.', 1200, least(v_total, 1200), v_t1200),
    ('long_session', 'Long rally', 'Play one session of 2 hours or more.', 120, least(v_longest, 120), v_long_at),
    ('streak_3', 'Three-week streak', 'Play at least once in three weeks in a row.', 3, least(coalesce(v_streak, 0), 3),
       v_streak_day::timestamp at time zone 'America/New_York'),
    ('crew_joined', 'Crew up', 'Create or join a crew.', 1, case when v_crew_at is null then 0 else 1 end, v_crew_at),
    ('first_verified', 'Verified', 'Have a session approved by PingPod staff.', 1,
       case when v_verified_at is null then 0 else 1 end, v_verified_at),
    ('weekly_top5', 'Top five', 'Finish a week in the top five for verified minutes.', 1,
       case when v_top5_day is null then 0 else 1 end, (v_top5_day + 7)::timestamp at time zone 'America/New_York')
  ) as t(code, title, description, target, progress, earned_at);
end $$;

-- Everything the in-venue iPad needs, in one public call. Only public nicknames and approved
-- crew names; no ids, emails, notes, or hidden players.
create function public.get_display_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings(); v_scope text := s.display_scope;
        v_week date := private.week_start(private.today()); v_st text[] := private.statuses(s.display_scope);
begin
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'scope', v_scope,
    'rotation_seconds', s.display_rotation_seconds,
    'slides', to_jsonb(s.display_slides),
    'public_app_url', s.public_app_url,
    'venue_name', s.venue_name,
    'week_start', v_week,
    'minutes', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'sessions', b.sessions) order by b.rank)
               from private.board('minutes', 'week', v_scope) b where b.rank <= 8), '[]'),
    'longest', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'detail', b.detail) order by b.rank)
               from private.board('longest', 'week', v_scope) b where b.rank <= 8), '[]'),
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'secondary', b.secondary) order by b.rank)
               from private.board('streaks', 'all', v_scope) b where b.rank <= 8), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('rank', c.rank, 'name', c.name, 'minutes', c.minutes,
                 'members', c.members, 'avg_minutes', c.avg_minutes) order by c.rank)
               from private.crew_board('week', v_scope) c where c.rank <= 6 and c.minutes > 0), '[]'),
    'highlights', jsonb_build_object(
      'players', (select count(distinct x.user_id) from public.play_sessions x
                   where x.status = any (v_st) and x.played_on >= v_week),
      'minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                   where x.status = any (v_st) and x.played_on >= v_week),
      'sessions', (select count(*) from public.play_sessions x where x.status = any (v_st) and x.played_on >= v_week),
      'new_players', (select count(*) from public.profiles p
                       where p.created_at >= v_week::timestamp at time zone 'America/New_York'),
      'longest', (select jsonb_build_object('display_name', b.display_name, 'minutes', b.value)
                    from private.board('longest', 'week', v_scope) b where b.rank = 1),
      'most_sessions', (select jsonb_build_object('display_name', b.display_name, 'sessions', b.sessions)
                          from private.board('minutes', 'week', v_scope) b order by b.sessions desc, b.rank limit 1),
      'top_crew', (select jsonb_build_object('name', c.name, 'minutes', c.minutes)
                     from private.crew_board('week', v_scope) c where c.rank = 1 and c.minutes > 0),
      'active_crews', (select count(*) from private.crew_board('week', v_scope) c where c.minutes > 0)));
end $$;

-- ════════ 20261119000400_admin.sql ════════
-- PingPod Morrisville Rewards · 004 staff tools, analytics, permissions, scheduled cleanup.
-- Staff rights live in private.admins (not editable by players). Every staff change is audited.
-- Roles: owner (settings, rewards, staff, deletions) and staff (reviews and moderation).

-- One-time staff codes (stored hashed) let the first owner claim access without editing SQL.
create function public.admin_claim(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r private.admin_claim_codes;
begin
  select * into r from private.admin_claim_codes
   where code_hash = encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    perform pg_sleep(1);
    raise exception 'That staff code didn''t work.';
  end if;
  insert into private.admins (user_id, role, added_by) values (v_uid, r.role, v_uid)
  on conflict (user_id) do update set role = case when excluded.role = 'owner' then 'owner' else private.admins.role end;
  update private.admin_claim_codes set used_by = v_uid, used_at = now() where code_hash = r.code_hash;
  perform private.audit('staff.claimed', 'user', v_uid::text, jsonb_build_object('role', r.role));
  return jsonb_build_object('role', r.role);
end $$;

-- ── Session review ─────────────────────────────────────────────────────
create function public.admin_list_sessions(p_status text default 'pending', p_search text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select s.id, s.user_id, p.display_name, s.method, s.status, s.minutes, s.submitted_minutes, s.played_on,
           s.started_at, s.ended_at, s.note, s.flags, s.auto_closed, s.last_checkin_at, s.created_at,
           s.reviewed_at, s.review_reason, rp.display_name as reviewed_by_name, s.user_id = v_uid as is_own,
           (select count(*) from public.play_sessions s2 where s2.user_id = s.user_id and s2.status in ('pending', 'approved')) as player_sessions,
           (select count(*) from public.play_sessions s3 where s3.user_id = s.user_id and s3.status = 'rejected') as player_rejections
      from public.play_sessions s join public.profiles p on p.id = s.user_id
      left join public.profiles rp on rp.id = s.reviewed_by
     where ((coalesce(p_status, 'all') = 'all' and s.status <> 'active') or s.status = p_status)
       and (private.clean_text(p_search) is null or p.display_name ilike '%' || private.clean_text(p_search) || '%')
     order by s.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]');
end $$;

create function public.admin_review_session(p_id uuid, p_action text, p_minutes int default null, p_reason text default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); o public.play_sessions; r public.play_sessions;
        v_reason text := private.clean_text(p_reason); s public.pilot_settings := private.settings();
        v_max int := greatest(s.max_session_minutes, s.manual_max_minutes);
begin
  select * into o from public.play_sessions where id = p_id for update;
  if not found then raise exception 'Session not found.'; end if;
  if o.user_id = v_uid then raise exception 'You can''t review your own session. Ask another staff member.'; end if;
  if o.status in ('active', 'cancelled') then raise exception 'Only finished sessions can be reviewed.'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > v_max) then
    raise exception 'Minutes must be between 1 and %.', v_max;
  end if;
  if p_action = 'approve' then
    if o.status = 'approved' then raise exception 'Already approved.'; end if;
    if o.status <> 'pending' then raise exception 'Reopen this session before approving it.'; end if;
    if p_minutes is not null and p_minutes <> o.minutes and v_reason is null then
      raise exception 'Add a reason when changing the minutes.';
    end if;
    update public.play_sessions set status = 'approved', minutes = coalesce(p_minutes, minutes),
           reviewed_by = v_uid, reviewed_at = clock_timestamp(), review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'reject' then
    if o.status = 'rejected' then raise exception 'Already rejected.'; end if;
    if o.status = 'approved' and v_reason is null then raise exception 'Add a reason when rejecting an approved session.'; end if;
    update public.play_sessions set status = 'rejected', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'adjust' then
    if p_minutes is null or v_reason is null then raise exception 'Enter the corrected minutes and a reason.'; end if;
    if o.status = 'rejected' then raise exception 'Reopen this session first.'; end if;
    update public.play_sessions set minutes = p_minutes, reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'reopen' then
    if o.status = 'pending' then raise exception 'Already pending.'; end if;
    if v_reason is null then raise exception 'Add a reason.'; end if;
    update public.play_sessions set status = 'pending', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('session.' || p_action, 'session', p_id::text, jsonb_build_object(
    'player', o.user_id, 'reason', v_reason,
    'before', jsonb_build_object('status', o.status, 'minutes', o.minutes),
    'after', jsonb_build_object('status', r.status, 'minutes', r.minutes)));
  return r;
end $$;

create function public.admin_bulk_approve(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_ids uuid[]; n int;
begin
  with u as (
    update public.play_sessions set status = 'approved', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = 'Approved in bulk'
     where id = any (p_ids) and status = 'pending' and user_id <> v_uid
    returning id)
  select array_agg(id), count(*) into v_ids, n from u;
  if n > 0 then
    perform private.audit('session.bulk_approve', 'session', null, jsonb_build_object('ids', to_jsonb(v_ids), 'count', n));
  end if;
  return n;
end $$;

-- ── Players ────────────────────────────────────────────────────────────
create function public.admin_list_players(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_q text := private.clean_text(p_search);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select u.id, p.display_name, u.email::text as email, u.created_at, u.last_sign_in_at, p.avatar_color,
           p.show_on_leaderboard, p.hidden_by_admin, p.hidden_reason, a.role as admin_role,
           (select count(*) from public.play_sessions s where s.user_id = u.id and s.status in ('pending', 'approved')) as sessions,
           (select coalesce(sum(s.minutes), 0) from public.play_sessions s where s.user_id = u.id and s.status = 'approved') as approved_minutes,
           (select coalesce(sum(s.minutes), 0) from public.play_sessions s where s.user_id = u.id and s.status = 'pending') as pending_minutes,
           (select c.name from public.crews c where c.id = private.active_crew(u.id)) as crew_name,
           (select jsonb_build_object('rating', r.rating, 'status', r.status) from public.spindex_ratings r
             where r.user_id = u.id and r.status in ('unverified', 'verified') order by r.created_at desc limit 1) as spindex
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join private.admins a on a.user_id = u.id
     where v_q is null or p.display_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%'
     order by u.created_at desc limit 500) x), '[]');
end $$;

create function public.admin_moderate_player(p_user_id uuid, p_action text, p_value text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_reason text := private.clean_text(p_reason); v_name text;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Player not found.'; end if;
  if p_action = 'hide' then
    update public.profiles set hidden_by_admin = true, hidden_reason = v_reason where id = p_user_id;
  elsif p_action = 'unhide' then
    update public.profiles set hidden_by_admin = false, hidden_reason = null where id = p_user_id;
  elsif p_action = 'rename' then
    v_name := private.clean_text(p_value);
    if v_name is null or v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,19}$' then
      raise exception 'Nicknames are 2–20 characters: letters, numbers, spaces, _ . or -';
    end if;
    if exists (select 1 from public.profiles where lower(display_name) = lower(v_name) and id <> p_user_id) then
      raise exception 'That nickname is taken.';
    end if;
    update public.profiles set display_name = v_name where id = p_user_id;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('player.' || p_action, 'user', p_user_id::text,
                        jsonb_build_object('value', p_value, 'reason', v_reason));
end $$;

create function public.admin_delete_player(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner();
begin
  if p_user_id = v_uid then raise exception 'Use Delete account on your own profile instead.'; end if;
  if private.is_admin(p_user_id) then raise exception 'Remove their staff access first.'; end if;
  if private.clean_text(p_reason) is null then raise exception 'Add a reason (for example, the player''s request).'; end if;
  perform private.leave_crew_for(p_user_id, 'account_deleted');
  perform private.audit('account.deleted_by_staff', 'user', p_user_id::text, jsonb_build_object('reason', p_reason));
  delete from auth.users where id = p_user_id;
  if not found then raise exception 'Player not found.'; end if;
end $$;

-- ── Crews ──────────────────────────────────────────────────────────────
create function public.admin_list_crews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.archived_at nulls first, x.created_at desc) from (
    select c.id, c.name, c.invite_code, c.created_at, c.archived_at, c.hidden_by_admin, c.hidden_reason,
           c.owner_id, op.display_name as owner_name,
           (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                    'joined_at', m.joined_at) order by m.joined_at), '[]')
              from public.crew_memberships m join public.profiles p on p.id = m.user_id
             where m.crew_id = c.id and m.left_at is null) as members,
           (select count(*) from public.crew_memberships m where m.crew_id = c.id and m.left_at is not null) as past_members,
           (select b.minutes from private.crew_board('week', 'verified') b where b.crew_id = c.id) as week_verified_minutes
      from public.crews c left join public.profiles op on op.id = c.owner_id) x), '[]');
end $$;

create function public.admin_moderate_crew(p_crew_id uuid, p_action text, p_value text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_reason text := private.clean_text(p_reason); v_name text; v_target uuid;
begin
  if not exists (select 1 from public.crews where id = p_crew_id) then raise exception 'Crew not found.'; end if;
  if p_action = 'rename' then
    v_name := private.valid_crew_name(p_value);
    if exists (select 1 from public.crews where lower(name) = lower(v_name) and archived_at is null and id <> p_crew_id) then
      raise exception 'That crew name is taken.';
    end if;
    update public.crews set name = v_name where id = p_crew_id;
  elsif p_action = 'hide' then
    update public.crews set hidden_by_admin = true, hidden_reason = v_reason where id = p_crew_id;
  elsif p_action = 'unhide' then
    update public.crews set hidden_by_admin = false, hidden_reason = null where id = p_crew_id;
  elsif p_action = 'archive' then
    update public.crew_memberships set left_at = clock_timestamp(), left_reason = 'crew_archived'
     where crew_id = p_crew_id and left_at is null;
    update public.crews set archived_at = clock_timestamp() where id = p_crew_id and archived_at is null;
  elsif p_action in ('transfer', 'remove_member') then
    v_target := p_value::uuid;
    if not exists (select 1 from public.crew_memberships where crew_id = p_crew_id and user_id = v_target and left_at is null) then
      raise exception 'That player isn''t in this crew.';
    end if;
    if p_action = 'transfer' then
      update public.crews set owner_id = v_target where id = p_crew_id;
    else
      perform private.leave_crew_for(v_target, 'removed_by_staff');
    end if;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('crew.' || p_action, 'crew', p_crew_id::text, jsonb_build_object('value', p_value, 'reason', v_reason));
end $$;

-- ── SPINDEX verification ───────────────────────────────────────────────
create function public.admin_list_spindex(p_status text default 'unverified') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select r.id, r.user_id, p.display_name, r.rating, r.status, r.source, r.player_note, r.created_at,
           r.verified_at, r.verification_source, vp.display_name as verified_by_name
      from public.spindex_ratings r join public.profiles p on p.id = r.user_id
      left join public.profiles vp on vp.id = r.verified_by
     where (coalesce(p_status, 'all') = 'all' and r.status <> 'superseded') or r.status = p_status
     order by r.created_at desc limit 300) x), '[]');
end $$;

create function public.admin_review_spindex(p_id uuid, p_action text, p_source text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); r public.spindex_ratings; v_source text := private.clean_text(p_source);
begin
  select * into r from public.spindex_ratings where id = p_id for update;
  if not found or r.status not in ('unverified', 'verified') then raise exception 'That rating is no longer current.'; end if;
  if r.user_id = v_uid then raise exception 'Ask another staff member to verify your own rating.'; end if;
  if p_action = 'verify' then
    if v_source is null then raise exception 'Say how you verified it (for example, "Saw SPINDEX app in person").'; end if;
    update public.spindex_ratings set status = 'verified', source = 'staff_verified', verified_by = v_uid,
           verified_at = clock_timestamp(), verification_source = v_source where id = p_id;
  elsif p_action = 'reject' then
    update public.spindex_ratings set status = 'rejected', verified_by = v_uid, verified_at = clock_timestamp(),
           verification_source = v_source where id = p_id;
  elsif p_action = 'unverify' then
    update public.spindex_ratings set status = 'unverified', source = 'self_reported', verified_by = null,
           verified_at = null, verification_source = null where id = p_id;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('spindex.' || p_action, 'spindex', p_id::text,
                        jsonb_build_object('player', r.user_id, 'rating', r.rating, 'source', v_source));
end $$;

-- ── Player requests ────────────────────────────────────────────────────
create function public.admin_list_requests(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select q.id, q.kind, q.message, q.status, q.created_at, q.admin_response, q.resolved_at, q.user_id,
           p.display_name, q.session_id,
           (select jsonb_build_object('played_on', s.played_on, 'minutes', s.minutes, 'status', s.status, 'method', s.method)
              from public.play_sessions s where s.id = q.session_id) as session
      from public.support_requests q left join public.profiles p on p.id = q.user_id
     where coalesce(p_status, 'all') = 'all' or q.status = p_status
     order by q.created_at desc limit 300) x), '[]');
end $$;

create function public.admin_resolve_request(p_id uuid, p_status text, p_response text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  if p_status not in ('resolved', 'dismissed', 'open') then raise exception 'Unknown status.'; end if;
  update public.support_requests set status = p_status, admin_response = private.clean_text(p_response),
         resolved_by = case when p_status = 'open' then null else v_uid end,
         resolved_at = case when p_status = 'open' then null else clock_timestamp() end
   where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
  perform private.audit('request.' || p_status, 'request', p_id::text, jsonb_build_object('response', p_response));
end $$;

-- ── Settings, rewards, staff (owner only) ──────────────────────────────
create function public.admin_update_settings(p_patch jsonb) returns public.pilot_settings
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner(); r public.pilot_settings;
begin
  begin
    update public.pilot_settings set
      venue_name = coalesce(private.clean_text(p_patch ->> 'venue_name'), venue_name),
      public_app_url = coalesce(private.clean_text(p_patch ->> 'public_app_url'), public_app_url),
      pilot_start = case when p_patch ? 'pilot_start' then nullif(p_patch ->> 'pilot_start', '')::date else pilot_start end,
      pilot_end = case when p_patch ? 'pilot_end' then nullif(p_patch ->> 'pilot_end', '')::date else pilot_end end,
      max_session_minutes = coalesce((p_patch ->> 'max_session_minutes')::int, max_session_minutes),
      checkin_reminder_minutes = coalesce((p_patch ->> 'checkin_reminder_minutes')::int, checkin_reminder_minutes),
      manual_min_minutes = coalesce((p_patch ->> 'manual_min_minutes')::int, manual_min_minutes),
      manual_max_minutes = coalesce((p_patch ->> 'manual_max_minutes')::int, manual_max_minutes),
      backdate_days = coalesce((p_patch ->> 'backdate_days')::int, backdate_days),
      daily_minutes_cap = coalesce((p_patch ->> 'daily_minutes_cap')::int, daily_minutes_cap),
      crew_min_size = coalesce((p_patch ->> 'crew_min_size')::int, crew_min_size),
      crew_max_size = coalesce((p_patch ->> 'crew_max_size')::int, crew_max_size),
      auto_approve_timer = coalesce((p_patch ->> 'auto_approve_timer')::boolean, auto_approve_timer),
      default_board_scope = coalesce(p_patch ->> 'default_board_scope', default_board_scope),
      display_scope = coalesce(p_patch ->> 'display_scope', display_scope),
      display_rotation_seconds = coalesce((p_patch ->> 'display_rotation_seconds')::int, display_rotation_seconds),
      display_slides = case when p_patch ? 'display_slides'
        then array(select jsonb_array_elements_text(p_patch -> 'display_slides')) else display_slides end,
      boards_enabled = case when p_patch ? 'boards_enabled'
        then array(select jsonb_array_elements_text(p_patch -> 'boards_enabled')) else boards_enabled end,
      rewards_enabled = coalesce((p_patch ->> 'rewards_enabled')::boolean, rewards_enabled)
    where id = 1 returning * into r;
  exception when others then
    raise exception 'One of those settings isn''t valid (%).', sqlerrm;
  end;
  perform private.audit('settings.update', 'settings', '1', p_patch);
  return r;
end $$;

create function public.admin_list_rewards() returns setof public.rewards
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select * from public.rewards order by created_at desc;
end $$;

create function public.admin_save_reward(
  p_id uuid, p_title text, p_description text, p_criteria text, p_enabled boolean, p_approval_note text)
returns public.rewards language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner(); r public.rewards;
begin
  if coalesce(p_enabled, false) and char_length(coalesce(private.clean_text(p_approval_note), '')) < 5 then
    raise exception 'Record who approved this reward and how it''s fulfilled before turning it on.';
  end if;
  if p_id is null then
    insert into public.rewards (title, description, criteria, enabled, approval_note)
    values (private.clean_text(p_title), private.clean_text(p_description), private.clean_text(p_criteria),
            coalesce(p_enabled, false), private.clean_text(p_approval_note))
    returning * into r;
  else
    update public.rewards set title = private.clean_text(p_title), description = private.clean_text(p_description),
           criteria = private.clean_text(p_criteria), enabled = coalesce(p_enabled, false),
           approval_note = private.clean_text(p_approval_note)
     where id = p_id returning * into r;
    if not found then raise exception 'Reward not found.'; end if;
  end if;
  perform private.audit('reward.save', 'reward', r.id::text, to_jsonb(r));
  return r;
end $$;

create function public.admin_list_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role, 'added_at', a.added_at,
           'display_name', p.display_name, 'email', u.email) order by a.added_at)
    from private.admins a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id), '[]');
end $$;

create function public.admin_set_staff(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner();
begin
  if p_user_id = v_uid then raise exception 'You can''t change your own access.'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Player not found.'; end if;
  if p_role is null then
    delete from private.admins where user_id = p_user_id;
  elsif p_role in ('owner', 'staff') then
    insert into private.admins (user_id, role, added_by) values (p_user_id, p_role, v_uid)
    on conflict (user_id) do update set role = excluded.role;
  else
    raise exception 'Unknown role.';
  end if;
  perform private.audit('staff.set', 'user', p_user_id::text, jsonb_build_object('role', p_role));
end $$;

create function public.admin_audit_log(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, p.display_name as actor_name
      from private.audit_log l left join public.profiles p on p.id = l.actor_id
     order by l.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]');
end $$;

-- ── Pilot analytics (aggregates only; no emails or notes) ─────────────
create function private.weekly_stats(p_from date) returns jsonb language sql stable set search_path = '' as $$
  with weeks as (
    select generate_series(private.week_start(p_from), private.week_start(private.today()), interval '7 days')::date w),
  q as (select s.*, private.week_start(s.played_on) w from public.play_sessions s where s.status in ('pending', 'approved')),
  firsts as (select q.user_id, min(q.w) first_w from q group by q.user_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', weeks.w,
    'active_players', (select count(distinct q.user_id) from q where q.w = weeks.w),
    'returning_players', (select count(distinct q.user_id) from q join firsts f on f.user_id = q.user_id
                           where q.w = weeks.w and f.first_w < weeks.w),
    'new_signups', (select count(*) from public.profiles p
                     where private.week_start((p.created_at at time zone 'America/New_York')::date) = weeks.w),
    'sessions', (select count(*) from q where q.w = weeks.w),
    'timer_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'timer'),
    'manual_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'manual'),
    'approved_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'approved'),
    'pending_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'pending'),
    'crews_with_play', (select count(*) from private.crew_board('all', 'community') b
                         where exists (select 1 from public.crew_memberships m join q on q.user_id = m.user_id
                                        and q.started_at >= m.joined_at and (m.left_at is null or q.started_at < m.left_at)
                                        where m.crew_id = b.crew_id and q.w = weeks.w)))
    order by weeks.w), '[]')
  from weeks $$;

create function public.admin_analytics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings();
        v_from date;
begin
  perform private.require_admin();
  v_from := coalesce(s.pilot_start, (select min(played_on) from public.play_sessions), private.today());
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'pilot_start', s.pilot_start, 'pilot_end', s.pilot_end,
    'accounts', (select count(*) from auth.users),
    'registered_players', (select count(*) from public.profiles),
    'players_with_session', (select count(distinct user_id) from public.play_sessions where status in ('pending', 'approved')),
    'repeat_players_days', (select count(*) from (select user_id from public.play_sessions where status in ('pending', 'approved')
                              group by user_id having count(distinct played_on) >= 2) t),
    'repeat_players_weeks', (select count(*) from (select user_id from public.play_sessions where status in ('pending', 'approved')
                              group by user_id having count(distinct private.week_start(played_on)) >= 2) t),
    'sessions', (select jsonb_build_object(
        'counted', count(*) filter (where status in ('pending', 'approved')),
        'approved', count(*) filter (where status = 'approved'),
        'pending', count(*) filter (where status = 'pending'),
        'rejected', count(*) filter (where status = 'rejected'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'active_now', count(*) filter (where status = 'active'),
        'timer', count(*) filter (where method = 'timer' and status in ('pending', 'approved')),
        'manual', count(*) filter (where method = 'manual' and status in ('pending', 'approved')),
        'auto_closed', count(*) filter (where auto_closed)) from public.play_sessions),
    'minutes', (select jsonb_build_object(
        'approved', coalesce(sum(minutes) filter (where status = 'approved'), 0),
        'pending', coalesce(sum(minutes) filter (where status = 'pending'), 0),
        'rejected', coalesce(sum(minutes) filter (where status = 'rejected'), 0)) from public.play_sessions),
    'crews', jsonb_build_object(
        'total', (select count(*) from public.crews where archived_at is null),
        'eligible', (select count(*) from private.crew_board('all', 'community')),
        'active_this_week', (select count(*) from private.crew_board('week', 'community') where minutes > 0)),
    'spindex', (select jsonb_build_object(
        'self_reported', count(*) filter (where status = 'unverified'),
        'verified', count(*) filter (where status = 'verified')) from public.spindex_ratings),
    'open_requests', (select count(*) from public.support_requests where status = 'open'),
    'weekly', private.weekly_stats(v_from));
end $$;

-- CSV-ready exports with pseudonymous player references (no names, emails or notes).
create function public.admin_export(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings();
begin
  perform private.require_admin();
  if p_kind = 'weekly' then
    return private.weekly_stats(coalesce(s.pilot_start, (select min(played_on) from public.play_sessions), private.today()));
  elsif p_kind = 'players' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.joined_on) from (
      select 'P' || substr(encode(extensions.digest(p.id::text || ':pingpod-morrisville', 'sha256'), 'hex'), 1, 8) as player_ref,
             (p.created_at at time zone 'America/New_York')::date as joined_on,
             count(q.id) as sessions,
             count(q.id) filter (where q.method = 'timer') as timer_sessions,
             count(q.id) filter (where q.method = 'manual') as manual_sessions,
             coalesce(sum(q.minutes) filter (where q.status = 'approved'), 0) as approved_minutes,
             coalesce(sum(q.minutes) filter (where q.status = 'pending'), 0) as pending_minutes,
             count(distinct q.played_on) as active_days,
             count(distinct private.week_start(q.played_on)) as active_weeks,
             (private.active_crew(p.id) is not null) as in_crew,
             p.show_on_leaderboard as public_profile
        from public.profiles p
        left join public.play_sessions q on q.user_id = p.id and q.status in ('pending', 'approved')
       group by p.id) x), '[]');
  elsif p_kind = 'sessions' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.played_on, x.player_ref) from (
      select 'P' || substr(encode(extensions.digest(q.user_id::text || ':pingpod-morrisville', 'sha256'), 'hex'), 1, 8) as player_ref,
             q.played_on, private.week_start(q.played_on) as week_start, q.method, q.status, q.minutes, q.auto_closed
        from public.play_sessions q where q.status in ('pending', 'approved', 'rejected')) x), '[]');
  else
    raise exception 'Unknown export.';
  end if;
end $$;

-- ── Permissions ────────────────────────────────────────────────────────
-- Postgres and Supabase grant EXECUTE broadly by default; lock it down, then open exactly what's needed.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
  public.get_display_data(), public.preview_crew(text) to anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ── Scheduled cleanup: close abandoned timers, trim rate-limit history ──
create extension if not exists pg_cron;
select cron.schedule('pingpod-close-stale-sessions', '*/10 * * * *',
  $$select private.close_stale_sessions(null); delete from private.rate_events where at < now() - interval '3 days';$$);

-- ════════ 20261119000500_crew_attribution_by_end.sql ════════
-- PingPod Morrisville Rewards · 005 crew attribution uses when a session ENDED.
-- A session counts for the crew the player belonged to when it finished:
--   ended_at > joined_at AND (left_at IS NULL OR ended_at <= left_at)
-- Intervals never overlap (one active crew at a time), so no session counts twice,
-- and a session logged right after forming a crew at the venue still counts.

create or replace function private.in_membership(p_ended timestamptz, p_joined timestamptz, p_left timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_ended > p_joined and (p_left is null or p_ended <= p_left) $$;

create or replace function private.crew_board(p_period text, p_scope text)
returns table (crew_id uuid, name text, minutes int, members int, contributors int, avg_minutes int, rank int)
language sql stable set search_path = '' as $$
  with cfg as (
    select private.statuses(p_scope) st, private.period_start(p_period) d,
           (select crew_min_size from public.pilot_settings where id = 1) min_size),
  am as (select m.crew_id cid, count(*)::int n from public.crew_memberships m where m.left_at is null group by m.crew_id),
  contrib as (
    select m.crew_id cid, s.user_id uid, s.minutes, s.ended_at
      from cfg, public.crew_memberships m
      join public.play_sessions s on s.user_id = m.user_id and private.in_membership(s.ended_at, m.joined_at, m.left_at)
     where s.status = any (cfg.st) and s.played_on >= cfg.d),
  agg as (select cid, sum(minutes)::int mins, count(distinct uid)::int contributors, max(ended_at) last_at
            from contrib group by cid)
  select c.id, c.name, coalesce(a.mins, 0), am.n, coalesce(a.contributors, 0), (coalesce(a.mins, 0) / am.n)::int,
         (row_number() over (order by coalesce(a.mins, 0) desc, a.last_at nulls last, lower(c.name), c.id))::int
    from public.crews c join am on am.cid = c.id left join agg a on a.cid = c.id
   where c.archived_at is null and not c.hidden_by_admin and am.n >= (select min_size from cfg)
     and (select d from cfg) is not null $$;

create or replace function public.get_my_crew(p_period text default 'week', p_scope text default 'verified')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_crew uuid := private.active_crew(v_uid); c public.crews;
        v_st text[] := private.statuses(p_scope); v_start date := private.period_start(p_period);
        s public.pilot_settings := private.settings();
begin
  if v_crew is null then return null; end if;
  if v_start is null or p_scope not in ('verified', 'community') then raise exception 'Unknown period or scope.'; end if;
  select * into c from public.crews where id = v_crew;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'invite_code', c.invite_code, 'is_owner', c.owner_id = v_uid,
    'created_at', c.created_at, 'hidden_by_admin', c.hidden_by_admin,
    'min_members', s.crew_min_size, 'max_members', s.crew_max_size,
    'rank', (select b.rank from private.crew_board(p_period, p_scope) b where b.crew_id = v_crew),
    'crews_ranked', (select count(*) from private.crew_board(p_period, p_scope)),
    'total_minutes', (
      select coalesce(sum(x.minutes), 0) from public.crew_memberships m
        join public.play_sessions x on x.user_id = m.user_id and private.in_membership(x.ended_at, m.joined_at, m.left_at)
       where m.crew_id = v_crew and x.status = any (v_st) and x.played_on >= v_start),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'display_name', p.display_name, 'avatar_color', p.avatar_color,
               'is_owner', m.user_id = c.owner_id, 'is_me', m.user_id = v_uid, 'joined_at', m.joined_at,
               'minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                            where x.user_id = m.user_id and private.in_membership(x.ended_at, m.joined_at, m.left_at)
                              and x.status = any (v_st) and x.played_on >= v_start))
             order by m.joined_at), '[]')
        from public.crew_memberships m join public.profiles p on p.id = m.user_id
       where m.crew_id = v_crew and m.left_at is null));
end $$;

create or replace function private.weekly_stats(p_from date) returns jsonb language sql stable set search_path = '' as $$
  with weeks as (
    select generate_series(private.week_start(p_from), private.week_start(private.today()), interval '7 days')::date w),
  q as (select s.*, private.week_start(s.played_on) w from public.play_sessions s where s.status in ('pending', 'approved')),
  firsts as (select q.user_id, min(q.w) first_w from q group by q.user_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', weeks.w,
    'active_players', (select count(distinct q.user_id) from q where q.w = weeks.w),
    'returning_players', (select count(distinct q.user_id) from q join firsts f on f.user_id = q.user_id
                           where q.w = weeks.w and f.first_w < weeks.w),
    'new_signups', (select count(*) from public.profiles p
                     where private.week_start((p.created_at at time zone 'America/New_York')::date) = weeks.w),
    'sessions', (select count(*) from q where q.w = weeks.w),
    'timer_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'timer'),
    'manual_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'manual'),
    'approved_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'approved'),
    'pending_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'pending'),
    'crews_with_play', (select count(distinct m.crew_id) from public.crew_memberships m
                         join q on q.user_id = m.user_id and private.in_membership(q.ended_at, m.joined_at, m.left_at)
                        where q.w = weeks.w))
    order by weeks.w), '[]')
  from weeks $$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- ════════ 20261119000600_manual_end_not_in_future.sql ════════
-- PingPod Morrisville Rewards · 006 manual sessions never end in the future.
-- Bug: logging "today" shortly after midnight (e.g. 60 min at 12:30 AM) clamped the start to
-- midnight, so ended_at landed after the moment of logging. Crew attribution (which uses
-- ended_at) then credited play logged *before* joining a crew. Fix: ended_at is capped at the
-- time of logging. `minutes` remains the authoritative duration.

create or replace function public.log_session(
  p_played_on date, p_minutes int, p_note text default null, p_client_request_id uuid default null
) returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); s public.pilot_settings := private.settings();
        v_today date := private.today(); r public.play_sessions; v_total int; v_flags text[] := '{}';
        v_note text := private.clean_text(p_note); v_start timestamptz; v_now timestamptz := clock_timestamp();
begin
  if p_client_request_id is not null then
    select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
    if found then return r; end if;
  end if;
  if p_minutes is null or p_minutes < s.manual_min_minutes or p_minutes > s.manual_max_minutes then
    raise exception 'Enter between % and % minutes.', s.manual_min_minutes, s.manual_max_minutes;
  end if;
  if p_played_on is null or p_played_on > v_today then raise exception 'That date is in the future.'; end if;
  if p_played_on < v_today - s.backdate_days then
    raise exception 'You can log play from the last % days. Ask staff for anything older.', s.backdate_days;
  end if;
  if char_length(v_note) > 280 then raise exception 'Keep notes under 280 characters.'; end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and status = 'active') then
    raise exception 'Finish your running session first.';
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'manual'
             and played_on = p_played_on and minutes = p_minutes and status in ('pending', 'approved')) then
    raise exception 'You already logged % minutes on that day.', p_minutes;
  end if;
  select coalesce(sum(minutes), 0) into v_total from public.play_sessions
   where user_id = v_uid and played_on = p_played_on and status in ('pending', 'approved');
  if v_total + p_minutes > s.daily_minutes_cap then
    raise exception 'That would be more than % minutes in one day. Ask staff if that''s right.', s.daily_minutes_cap;
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'timer'
             and played_on = p_played_on and status in ('pending', 'approved')) then
    v_flags := array_append(v_flags, 'same_day_as_timer');
  end if;
  perform private.rate_limit('manual_log', 6, interval '1 hour');
  if p_played_on = v_today then
    v_start := least(v_now, greatest(p_played_on::timestamp at time zone 'America/New_York',
                                     v_now - make_interval(mins => p_minutes)));
  else
    v_start := (p_played_on::timestamp + interval '12 hours') at time zone 'America/New_York';
  end if;
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes,
                                    submitted_minutes, note, client_request_id, flags)
  values (v_uid, 'manual', 'pending', v_start, least(v_start + make_interval(mins => p_minutes), v_now), p_played_on,
          p_minutes, p_minutes, v_note, p_client_request_id, v_flags)
  returning * into r;
  return r;
exception when unique_violation then
  select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
  if found then return r; end if;
  raise;
end $$;

-- Repair any manual rows already written with a future end.
update public.play_sessions set ended_at = greatest(started_at, created_at)
 where method = 'manual' and ended_at > created_at;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
  public.get_display_data(), public.preview_crew(text) to anon;

-- ════════ 20261119000700_timing_refinements.sql ════════
-- PingPod Morrisville Rewards · 007 timing refinements (signatures unchanged).
-- 1) log_session: an entry dated today is assumed to have just finished, so it starts
--    `minutes` before now (it may begin the previous evening) and ends now. played_on stays
--    the chosen date. ended_at is still capped at now for safety.
-- 2) stop_session: timer sessions under 5 minutes (or under manual_min_minutes if that is
--    lower) are treated as accidental and not counted; this no longer moves with the manual
--    log minimum.

create or replace function public.log_session(
  p_played_on date, p_minutes int, p_note text default null, p_client_request_id uuid default null
) returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); s public.pilot_settings := private.settings();
        v_today date := private.today(); r public.play_sessions; v_total int; v_flags text[] := '{}';
        v_note text := private.clean_text(p_note); v_start timestamptz; v_now timestamptz := clock_timestamp();
begin
  if p_client_request_id is not null then
    select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
    if found then return r; end if;
  end if;
  if p_minutes is null or p_minutes < s.manual_min_minutes or p_minutes > s.manual_max_minutes then
    raise exception 'Enter between % and % minutes.', s.manual_min_minutes, s.manual_max_minutes;
  end if;
  if p_played_on is null or p_played_on > v_today then raise exception 'That date is in the future.'; end if;
  if p_played_on < v_today - s.backdate_days then
    raise exception 'You can log play from the last % days. Ask staff for anything older.', s.backdate_days;
  end if;
  if char_length(v_note) > 280 then raise exception 'Keep notes under 280 characters.'; end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and status = 'active') then
    raise exception 'Finish your running session first.';
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'manual'
             and played_on = p_played_on and minutes = p_minutes and status in ('pending', 'approved')) then
    raise exception 'You already logged % minutes on that day.', p_minutes;
  end if;
  select coalesce(sum(minutes), 0) into v_total from public.play_sessions
   where user_id = v_uid and played_on = p_played_on and status in ('pending', 'approved');
  if v_total + p_minutes > s.daily_minutes_cap then
    raise exception 'That would be more than % minutes in one day. Ask staff if that''s right.', s.daily_minutes_cap;
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and method = 'timer'
             and played_on = p_played_on and status in ('pending', 'approved')) then
    v_flags := array_append(v_flags, 'same_day_as_timer');
  end if;
  perform private.rate_limit('manual_log', 6, interval '1 hour');
  if p_played_on = v_today then
    v_start := v_now - make_interval(mins => p_minutes);
  else
    v_start := (p_played_on::timestamp + interval '12 hours') at time zone 'America/New_York';
  end if;
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes,
                                    submitted_minutes, note, client_request_id, flags)
  values (v_uid, 'manual', 'pending', v_start, least(v_start + make_interval(mins => p_minutes), v_now), p_played_on,
          p_minutes, p_minutes, v_note, p_client_request_id, v_flags)
  returning * into r;
  return r;
exception when unique_violation then
  select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
  if found then return r; end if;
  raise;
end $$;

create or replace function public.stop_session(p_id uuid, p_ended_at timestamptz default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.play_sessions; s public.pilot_settings := private.settings();
        v_now timestamptz := clock_timestamp(); v_end timestamptz; v_min int;
begin
  select * into r from public.play_sessions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Session not found.'; end if;
  if r.status <> 'active' then return r; end if;
  v_end := least(v_now, coalesce(p_ended_at, v_now));
  v_end := greatest(v_end, v_now - interval '30 minutes', r.started_at);
  v_end := least(v_end, r.started_at + make_interval(mins => s.max_session_minutes));
  v_min := floor(extract(epoch from (v_end - r.started_at)) / 60)::int;
  if v_min < least(5, s.manual_min_minutes) then
    update public.play_sessions set status = 'cancelled', ended_at = v_end, minutes = 0, submitted_minutes = v_min,
      flags = array_append(flags, 'too_short')
     where id = p_id returning * into r;
    return r;
  end if;
  update public.play_sessions
     set ended_at = v_end, minutes = v_min, submitted_minutes = v_min,
         status = case when s.auto_approve_timer then 'approved' else 'pending' end,
         reviewed_at = case when s.auto_approve_timer then v_now end,
         review_reason = case when s.auto_approve_timer then 'Auto-approved timer session' end,
         flags = case when v_min >= s.max_session_minutes then array_append(flags, 'hit_max') else flags end
   where id = p_id returning * into r;
  return r;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
  public.get_display_data(), public.preview_crew(text) to anon;

-- ════════ 20261119000800_fk_indexes.sql ════════
-- PingPod Morrisville Rewards · 008 covering indexes for foreign keys (performance advisor).
create index if not exists crews_owner on public.crews (owner_id);
create index if not exists play_sessions_reviewed_by on public.play_sessions (reviewed_by);
create index if not exists play_sessions_venue on public.play_sessions (venue_id);
create index if not exists spindex_verified_by on public.spindex_ratings (verified_by);
create index if not exists support_requests_resolved_by on public.support_requests (resolved_by);
create index if not exists support_requests_session on public.support_requests (session_id);
create index if not exists support_requests_user on public.support_requests (user_id, created_at desc);

-- ════════ 20261119000900_trust_players.sql ════════
-- PingPod Morrisville Rewards · 009 trust players' own time.
-- Product decision (pilot owner): logged and timed sessions count immediately; no staff
-- approval step. Staff can still adjust, reopen or remove (reject) a session that looks wrong.
-- Implemented as one trigger so every write path (stop_session, log_session, the stale-timer
-- job) behaves the same without duplicating function bodies.

create or replace function private.count_immediately() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- New manual logs, and timers finishing (active -> pending), count right away.
  -- A staff "reopen" (approved/rejected -> pending) is left as the staff member chose.
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'active') then
    new.status := 'approved';
  end if;
  return new;
end $$;

create trigger count_immediately before insert or update of status on public.play_sessions
  for each row execute function private.count_immediately();

update public.play_sessions set status = 'approved' where status = 'pending';

-- Boards include everything not removed by staff.
update public.pilot_settings set default_board_scope = 'community', display_scope = 'community' where id = 1;

-- "Verified" milestone no longer means anything; replace it with "Regular" (5 different days).
create or replace function public.get_my_achievements()
returns table (code text, title text, description text, target int, progress int, earned_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_user();
  v_total int; v_sessions int; v_first timestamptz; v_longest int; v_long_at timestamptz;
  v_t60 timestamptz; v_t300 timestamptz; v_t600 timestamptz; v_t1200 timestamptz;
  v_streak int; v_streak_day date; v_crew_at timestamptz; v_days int; v_day5 timestamptz; v_top5_day date;
begin
  select coalesce(sum(s.minutes), 0), count(*), min(s.ended_at), coalesce(max(s.minutes), 0), count(distinct s.played_on)
    into v_total, v_sessions, v_first, v_longest, v_days
    from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending');
  select min(c.ended_at) filter (where c.cum >= 60), min(c.ended_at) filter (where c.cum >= 300),
         min(c.ended_at) filter (where c.cum >= 600), min(c.ended_at) filter (where c.cum >= 1200)
    into v_t60, v_t300, v_t600, v_t1200
    from (select s.ended_at, sum(s.minutes) over (order by s.ended_at, s.id) cum
            from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending')) c;
  select min(s.ended_at) into v_long_at from public.play_sessions s
   where s.user_id = v_uid and s.status in ('approved', 'pending') and s.minutes >= 120;
  select d.first_end into v_day5 from (
    select s.played_on, min(s.ended_at) first_end from public.play_sessions s
     where s.user_id = v_uid and s.status in ('approved', 'pending') group by s.played_on
     order by s.played_on offset 4 limit 1) d;
  with wk as (select distinct private.week_start(s.played_on) w from public.play_sessions s
               where s.user_id = v_uid and s.status in ('approved', 'pending')),
       isl as (select wk.w, wk.w - (7 * row_number() over (order by wk.w))::int g from wk),
       pos as (select isl.w, row_number() over (partition by isl.g order by isl.w) p,
                      count(*) over (partition by isl.g) len from isl)
  select max(pos.len)::int, min(pos.w) filter (where pos.p = 3) into v_streak, v_streak_day from pos;
  select min(m.joined_at) into v_crew_at from public.crew_memberships m where m.user_id = v_uid;
  with weekly as (
    select private.week_start(s.played_on) w, s.user_id u, sum(s.minutes) m
      from public.play_sessions s join public.profiles p on p.id = s.user_id
     where s.status in ('approved', 'pending') and not p.hidden_by_admin
       and private.week_start(s.played_on) < private.week_start(private.today())
     group by 1, 2),
  ranked as (select weekly.w, weekly.u, rank() over (partition by weekly.w order by weekly.m desc) r from weekly)
  select min(ranked.w) into v_top5_day from ranked where ranked.u = v_uid and ranked.r <= 5;
  return query select * from (values
    ('first_session', 'First session', 'Finish your first playing session.', 1, least(v_sessions, 1), v_first),
    ('first_hour', 'First hour', 'Play 60 minutes in total.', 60, least(v_total, 60), v_t60),
    ('minutes_300', '300 club', 'Reach 300 total minutes.', 300, least(v_total, 300), v_t300),
    ('minutes_600', '600 club', 'Reach 600 total minutes.', 600, least(v_total, 600), v_t600),
    ('minutes_1200', 'Twenty hours', 'Reach 1,200 total minutes.', 1200, least(v_total, 1200), v_t1200),
    ('long_session', 'Long rally', 'Play one session of 2 hours or more.', 120, least(v_longest, 120), v_long_at),
    ('streak_3', 'Three-week streak', 'Play at least once in three weeks in a row.', 3, least(coalesce(v_streak, 0), 3),
       v_streak_day::timestamp at time zone 'America/New_York'),
    ('crew_joined', 'Crew up', 'Create or join a crew.', 1, case when v_crew_at is null then 0 else 1 end, v_crew_at),
    ('regular', 'Regular', 'Play on 5 different days.', 5, least(coalesce(v_days, 0), 5), v_day5),
    ('weekly_top5', 'Top five', 'Finish a week in the top five for minutes.', 1,
       case when v_top5_day is null then 0 else 1 end, (v_top5_day + 7)::timestamp at time zone 'America/New_York')
  ) as t(code, title, description, target, progress, earned_at);
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.get_my_achievements() from public, anon;
grant execute on function public.get_my_achievements() to authenticated;

-- ════════ 20261119001000_display_all_boards.sql ════════
-- iPad display: add a "Highest SPINDEX" screen and show every board by default
-- (most minutes, streaks, longest session, crews, SPINDEX, weekly highlights).

-- Allow 'spindex' as a display screen (drop the old check, whatever Postgres named it).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.pilot_settings'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%display_slides%'
  loop
    execute format('alter table public.pilot_settings drop constraint %I', c);
  end loop;
end $$;

alter table public.pilot_settings
  add constraint pilot_settings_display_slides_check
  check (display_slides <@ array['minutes', 'streaks', 'longest', 'crews', 'spindex', 'highlights']::text[]
         and cardinality(display_slides) > 0);

alter table public.pilot_settings
  alter column display_slides set default '{minutes,streaks,longest,crews,spindex,highlights}';

update public.pilot_settings
   set display_slides = '{minutes,streaks,longest,crews,spindex,highlights}'
 where id = 1;

-- Same payload as before plus `spindex` (top 8 current ratings; respects show_spindex,
-- show_on_leaderboard and staff hiding, exactly like get_leaderboard('spindex')).
create or replace function public.get_display_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings(); v_scope text := s.display_scope;
        v_week date := private.week_start(private.today()); v_st text[] := private.statuses(s.display_scope);
begin
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'scope', v_scope,
    'rotation_seconds', s.display_rotation_seconds,
    'slides', to_jsonb(s.display_slides),
    'public_app_url', s.public_app_url,
    'venue_name', s.venue_name,
    'week_start', v_week,
    'minutes', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'sessions', b.sessions) order by b.rank)
               from private.board('minutes', 'week', v_scope) b where b.rank <= 8), '[]'),
    'longest', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'detail', b.detail) order by b.rank)
               from private.board('longest', 'week', v_scope) b where b.rank <= 8), '[]'),
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'secondary', b.secondary) order by b.rank)
               from private.board('streaks', 'all', v_scope) b where b.rank <= 8), '[]'),
    'spindex', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'detail', b.detail) order by b.rank)
               from private.board('spindex', 'all', v_scope) b where b.rank <= 8), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('rank', c.rank, 'name', c.name, 'minutes', c.minutes,
                 'members', c.members, 'avg_minutes', c.avg_minutes) order by c.rank)
               from private.crew_board('week', v_scope) c where c.rank <= 6 and c.minutes > 0), '[]'),
    'highlights', jsonb_build_object(
      'players', (select count(distinct x.user_id) from public.play_sessions x
                   where x.status = any (v_st) and x.played_on >= v_week),
      'minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                   where x.status = any (v_st) and x.played_on >= v_week),
      'sessions', (select count(*) from public.play_sessions x where x.status = any (v_st) and x.played_on >= v_week),
      'new_players', (select count(*) from public.profiles p
                       where p.created_at >= v_week::timestamp at time zone 'America/New_York'),
      'longest', (select jsonb_build_object('display_name', b.display_name, 'minutes', b.value)
                    from private.board('longest', 'week', v_scope) b where b.rank = 1),
      'most_sessions', (select jsonb_build_object('display_name', b.display_name, 'sessions', b.sessions)
                          from private.board('minutes', 'week', v_scope) b order by b.sessions desc, b.rank limit 1),
      'top_crew', (select jsonb_build_object('name', c.name, 'minutes', c.minutes)
                     from private.crew_board('week', v_scope) c where c.rank = 1 and c.minutes > 0),
      'top_spindex', (select jsonb_build_object('display_name', b.display_name, 'rating', b.value)
                        from private.board('spindex', 'all', v_scope) b where b.rank = 1),
      'active_crews', (select count(*) from private.crew_board('week', v_scope) c where c.minutes > 0)));
end $$;

grant execute on function public.get_display_data() to anon, authenticated;

-- ════════ 20261119001100_daily_streaks.sql ════════
-- Streaks become daily: days in a row with at least one counted session (Morrisville calendar).
-- A streak stays alive through today if the player played yesterday, so it only breaks after a
-- full missed day. Milestones: 3 days and 7 days in a row.
-- Also puts Highest SPINDEX second on the iPad rotation (right after Most minutes).

-- Same signature as before so every caller keeps working. Column `weeks` now holds the number of
-- distinct days played (it was distinct weeks); the streaks board shows it as "sessions".
create or replace function private.streaks_all(p_statuses text[], p_user uuid default null)
returns table (uid uuid, cur int, longest int, weeks int, mins int)
language sql stable set search_path = '' as $$
  with q as (
    select s.user_id, s.played_on, s.minutes from public.play_sessions s
     where s.status = any (p_statuses) and (p_user is null or s.user_id = p_user)),
  dy as (select distinct q.user_id, q.played_on d from q),
  isl as (select dy.user_id, dy.d, dy.d - (row_number() over (partition by dy.user_id order by dy.d))::int g from dy),
  runs as (select isl.user_id, count(*)::int len, max(isl.d) last_d from isl group by isl.user_id, isl.g)
  select r.user_id,
         coalesce(max(r.len) filter (where r.last_d >= private.today() - 1), 0)::int,
         max(r.len)::int,
         (select count(*) from dy where dy.user_id = r.user_id)::int,
         (select coalesce(sum(q.minutes), 0) from q where q.user_id = r.user_id)::int
    from runs r group by r.user_id $$;

create or replace function public.get_my_achievements()
returns table (code text, title text, description text, target int, progress int, earned_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_user();
  v_total int; v_sessions int; v_first timestamptz; v_longest int; v_long_at timestamptz;
  v_t60 timestamptz; v_t300 timestamptz; v_t600 timestamptz; v_t1200 timestamptz;
  v_streak int; v_streak3_day date; v_streak7_day date; v_crew_at timestamptz; v_days int; v_day5 timestamptz;
  v_top5_day date;
begin
  select coalesce(sum(s.minutes), 0), count(*), min(s.ended_at), coalesce(max(s.minutes), 0), count(distinct s.played_on)
    into v_total, v_sessions, v_first, v_longest, v_days
    from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending');
  select min(c.ended_at) filter (where c.cum >= 60), min(c.ended_at) filter (where c.cum >= 300),
         min(c.ended_at) filter (where c.cum >= 600), min(c.ended_at) filter (where c.cum >= 1200)
    into v_t60, v_t300, v_t600, v_t1200
    from (select s.ended_at, sum(s.minutes) over (order by s.ended_at, s.id) cum
            from public.play_sessions s where s.user_id = v_uid and s.status in ('approved', 'pending')) c;
  select min(s.ended_at) into v_long_at from public.play_sessions s
   where s.user_id = v_uid and s.status in ('approved', 'pending') and s.minutes >= 120;
  select d.first_end into v_day5 from (
    select s.played_on, min(s.ended_at) first_end from public.play_sessions s
     where s.user_id = v_uid and s.status in ('approved', 'pending') group by s.played_on
     order by s.played_on offset 4 limit 1) d;
  with dy as (select distinct s.played_on d from public.play_sessions s
               where s.user_id = v_uid and s.status in ('approved', 'pending')),
       isl as (select dy.d, dy.d - (row_number() over (order by dy.d))::int g from dy),
       pos as (select isl.d, row_number() over (partition by isl.g order by isl.d) p,
                      count(*) over (partition by isl.g) len from isl)
  select max(pos.len)::int, min(pos.d) filter (where pos.p = 3), min(pos.d) filter (where pos.p = 7)
    into v_streak, v_streak3_day, v_streak7_day from pos;
  select min(m.joined_at) into v_crew_at from public.crew_memberships m where m.user_id = v_uid;
  with weekly as (
    select private.week_start(s.played_on) w, s.user_id u, sum(s.minutes) m
      from public.play_sessions s join public.profiles p on p.id = s.user_id
     where s.status in ('approved', 'pending') and not p.hidden_by_admin
       and private.week_start(s.played_on) < private.week_start(private.today())
     group by 1, 2),
  ranked as (select weekly.w, weekly.u, rank() over (partition by weekly.w order by weekly.m desc) r from weekly)
  select min(ranked.w) into v_top5_day from ranked where ranked.u = v_uid and ranked.r <= 5;
  return query select * from (values
    ('first_session', 'First session', 'Finish your first playing session.', 1, least(v_sessions, 1), v_first),
    ('first_hour', 'First hour', 'Play 60 minutes in total.', 60, least(v_total, 60), v_t60),
    ('minutes_300', '300 club', 'Reach 300 total minutes.', 300, least(v_total, 300), v_t300),
    ('minutes_600', '600 club', 'Reach 600 total minutes.', 600, least(v_total, 600), v_t600),
    ('minutes_1200', 'Twenty hours', 'Reach 1,200 total minutes.', 1200, least(v_total, 1200), v_t1200),
    ('long_session', 'Long rally', 'Play one session of 2 hours or more.', 120, least(v_longest, 120), v_long_at),
    ('streak_3', 'Three-day streak', 'Play three days in a row.', 3, least(coalesce(v_streak, 0), 3),
       v_streak3_day::timestamp at time zone 'America/New_York'),
    ('streak_7', 'Seven-day streak', 'Play seven days in a row.', 7, least(coalesce(v_streak, 0), 7),
       v_streak7_day::timestamp at time zone 'America/New_York'),
    ('crew_joined', 'Crew up', 'Create or join a crew.', 1, case when v_crew_at is null then 0 else 1 end, v_crew_at),
    ('regular', 'Regular', 'Play on 5 different days.', 5, least(coalesce(v_days, 0), 5), v_day5),
    ('weekly_top5', 'Top five', 'Finish a week in the top five for minutes.', 1,
       case when v_top5_day is null then 0 else 1 end, (v_top5_day + 7)::timestamp at time zone 'America/New_York')
  ) as t(code, title, description, target, progress, earned_at);
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.get_my_achievements() from public, anon;
grant execute on function public.get_my_achievements() to authenticated;

-- iPad rotation: Highest SPINDEX right after Most minutes.
alter table public.pilot_settings
  alter column display_slides set default '{minutes,spindex,crews,streaks,longest,highlights}';
update public.pilot_settings
   set display_slides = '{minutes,spindex,crews,streaks,longest,highlights}'
 where id = 1 and display_slides @> '{minutes,spindex,crews,streaks,longest,highlights}';

-- ════════ 20261119001200_staff_need_password.sql ════════
-- Players now sign in with just their email: the app derives their password from the address
-- (src/lib/emailKey.ts; the iOS app does the same). Staff tools must never open that way, so a staff
-- or owner role only takes effect once the account has a password of its own. The check runs here,
-- on the server, so it holds for every client.

-- True when the account's password is still the email-derived key.
create or replace function private.on_email_key(p uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select u.encrypted_password is not null and u.encrypted_password <> ''
       and extensions.crypt(
             'Pp!' || left(encode(extensions.digest(lower(trim(u.email)) || '|pingpod-morrisville-email-only-v1', 'sha256'), 'hex'), 40) || '9',
             u.encrypted_password) = u.encrypted_password
      from auth.users u where u.id = p), false) $$;

create or replace function private.require_admin() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.is_admin(v) then raise exception 'Staff access only.'; end if;
  if private.on_email_key(v) then raise exception 'Set your staff password first: open the staff dashboard.'; end if;
  return v;
end $$;

create or replace function private.require_owner() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not exists (select 1 from private.admins where user_id = v and role = 'owner') then
    raise exception 'Only the pilot owner can change this.';
  end if;
  if private.on_email_key(v) then raise exception 'Set your staff password first: open the staff dashboard.'; end if;
  return v;
end $$;

-- get_me: admin_role is only reported once the staff password is set; staff_needs_password tells
-- the app to ask for one. (The bcrypt check only runs for accounts that are in private.admins.)
create or replace function public.get_me() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); p public.profiles; a public.play_sessions; v_crew jsonb; v_spindex jsonb;
        v_role text; v_needs_pw boolean := false;
begin
  perform private.close_stale_sessions(v_uid);
  select role into v_role from private.admins where user_id = v_uid;
  if v_role is not null and private.on_email_key(v_uid) then
    v_role := null;
    v_needs_pw := true;
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('server_now', clock_timestamp(), 'profile', null, 'admin_role', v_role,
                              'staff_needs_password', v_needs_pw, 'settings', to_jsonb(private.settings()));
  end if;
  select * into a from public.play_sessions where user_id = v_uid and status = 'active';
  select jsonb_build_object('id', c.id, 'name', c.name, 'invite_code', c.invite_code, 'is_owner', c.owner_id = v_uid)
    into v_crew from public.crews c where c.id = private.active_crew(v_uid);
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'status', r.status, 'source', r.source,
                            'verified_at', r.verified_at, 'created_at', r.created_at)
    into v_spindex from public.spindex_ratings r
   where r.user_id = v_uid and r.status in ('unverified', 'verified') order by r.created_at desc limit 1;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'profile', to_jsonb(p) - 'hidden_reason',
    'admin_role', v_role,
    'staff_needs_password', v_needs_pw,
    'active_session', case when a.id is null then null else to_jsonb(a) end,
    'crew', v_crew,
    'spindex', v_spindex,
    'stats', private.user_stats(v_uid),
    'settings', to_jsonb(private.settings()));
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.get_me() from public, anon;
grant execute on function public.get_me() to authenticated;

-- ════════ 20261119001300_everyone_email_only.sql ════════
-- Players never use a password, not even accounts created before email-only sign-in existed:
-- switch every existing player account to the email-derived key (same formula as
-- src/lib/emailKey.ts and private.on_email_key). Staff and owner accounts keep their own password,
-- because the staff dashboard shows every player's email and can delete accounts.
-- Safe to re-run: accounts already on the key are skipped.
update auth.users u
   set encrypted_password = extensions.crypt(
         'Pp!' || left(encode(extensions.digest(lower(trim(u.email)) || '|pingpod-morrisville-email-only-v1', 'sha256'), 'hex'), 40) || '9',
         extensions.gen_salt('bf', 10)),
       updated_at = now()
 where u.email is not null and u.email <> ''
   and not exists (select 1 from private.admins a where a.user_id = u.id)
   and not private.on_email_key(u.id);
