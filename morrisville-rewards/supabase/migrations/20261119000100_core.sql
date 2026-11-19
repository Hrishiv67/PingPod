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
