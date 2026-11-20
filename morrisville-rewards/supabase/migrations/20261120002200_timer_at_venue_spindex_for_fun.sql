-- 1) The timer only starts at PingPod (optional, owner switches it on).
--    Staff stand in the venue and tap "Use this spot" in Admin → Settings; that saves the venue's
--    coordinates. With the check on, start_session needs the phone's location and refuses a start
--    more than `geofence_m` metres away (plus the phone's own accuracy, capped at 150 m, because
--    indoor location is fuzzy). The location is only compared, never stored.
-- 2) SPINDEX is just for fun: the board is sorted by rating only, every rating shows in every
--    scope, and the iPad's Top SPINDEX is simply the highest rating. (Staff can still mark ratings
--    verified in Admin if real prizes ever depend on it; players don't see the difference.)

alter table public.pilot_settings
  add column venue_lat double precision check (venue_lat between -90 and 90),
  add column venue_lng double precision check (venue_lng between -180 and 180),
  add column geofence_m int not null default 300 check (geofence_m between 50 and 5000),
  add column geofence_enabled boolean not null default false;

-- Great-circle distance in metres.
create or replace function private.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

drop function public.start_session(uuid);
create function public.start_session(
  p_client_request_id uuid default null, p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.play_sessions; s public.pilot_settings := private.settings();
begin
  perform private.close_stale_sessions(v_uid);
  if p_client_request_id is not null then
    select * into r from public.play_sessions where user_id = v_uid and client_request_id = p_client_request_id;
    if found then return r; end if;
  end if;
  if exists (select 1 from public.play_sessions where user_id = v_uid and status = 'active') then
    raise exception 'You already have a session running.';
  end if;
  if s.geofence_enabled and s.venue_lat is not null and s.venue_lng is not null then
    if p_lat is null or p_lng is null then
      raise exception 'Turn on location to start the timer. It only checks that you''re at %.', s.venue_name;
    end if;
    if private.distance_m(p_lat, p_lng, s.venue_lat, s.venue_lng)
       > s.geofence_m + least(greatest(coalesce(p_accuracy, 0), 0), 150) then
      raise exception 'The timer starts when you''re at %.', s.venue_name;
    end if;
  end if;
  perform private.rate_limit('start', 12, interval '1 hour');
  insert into public.play_sessions (user_id, method, status, started_at, played_on, client_request_id)
  values (v_uid, 'timer', 'active', clock_timestamp(), private.today(), p_client_request_id)
  returning * into r;
  return r;
exception when unique_violation then
  raise exception 'You already have a session running.';
end $$;

create or replace function public.admin_update_settings(p_patch jsonb) returns public.pilot_settings
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
      rewards_enabled = coalesce((p_patch ->> 'rewards_enabled')::boolean, rewards_enabled),
      survey_url = case when p_patch ? 'survey_url'
        then nullif(private.clean_text(p_patch ->> 'survey_url'), '') else survey_url end,
      venue_lat = case when p_patch ? 'venue_lat' then nullif(p_patch ->> 'venue_lat', '')::float8 else venue_lat end,
      venue_lng = case when p_patch ? 'venue_lng' then nullif(p_patch ->> 'venue_lng', '')::float8 else venue_lng end,
      geofence_m = coalesce((p_patch ->> 'geofence_m')::int, geofence_m),
      geofence_enabled = coalesce((p_patch ->> 'geofence_enabled')::boolean, geofence_enabled)
    where id = 1 returning * into r;
  exception when others then
    raise exception 'One of those settings isn''t valid (%).', sqlerrm;
  end;
  if r.geofence_enabled and (r.venue_lat is null or r.venue_lng is null) then
    raise exception 'Set the PingPod location first (tap "Use this spot" while you''re at the venue).';
  end if;
  perform private.audit('settings.update', 'settings', '1', p_patch);
  return r;
end $$;

-- SPINDEX board: highest rating first, everyone's rating counts.
create or replace function private.board(p_metric text, p_period text, p_scope text)
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
           (row_number() over (order by c.v desc, c.ts, lower(p.display_name), c.uid))::int
      from cur c join public.profiles p on p.id = c.uid
     where p.show_spindex and p.show_on_leaderboard and not p.hidden_by_admin;
  else
    raise exception 'Unknown leaderboard.';
  end if;
end $$;

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
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'sessions', b.sessions)
                 order by b.rank)
               from private.board('minutes', 'week', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'longest', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'detail', b.detail)
                 order by b.rank)
               from private.board('longest', 'week', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'secondary', b.secondary)
                 order by b.rank)
               from private.board('streaks', 'all', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'spindex', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'detail', b.detail)
                 order by b.rank)
               from private.board('spindex', 'all', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('rank', cb.rank, 'name', cb.name, 'minutes', cb.minutes,
                 'members', cb.members, 'avg_minutes', cb.avg_minutes, 'color', c.color, 'emblem', c.emblem,
                 'motto', c.motto) order by cb.rank)
               from private.crew_board('week', v_scope) cb join public.crews c on c.id = cb.crew_id
              where cb.rank <= 6 and cb.minutes > 0), '[]'),
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

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.start_session(uuid, float8, float8, float8) from public, anon;
grant execute on function public.start_session(uuid, float8, float8, float8) to authenticated;
revoke execute on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
revoke execute on function public.get_display_data() from public;
grant execute on function public.get_display_data() to anon, authenticated;
