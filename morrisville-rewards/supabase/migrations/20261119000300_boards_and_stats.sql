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
