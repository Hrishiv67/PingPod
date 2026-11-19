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
