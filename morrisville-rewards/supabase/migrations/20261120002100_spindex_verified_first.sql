-- SPINDEX fairness (persona test): a rating someone typed in can't outrank one staff have checked.
-- The SPINDEX board lists staff-verified ratings first, then self-reported ones; the iPad's
-- "Top SPINDEX" tile only ever shows a verified rating.
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
           (row_number() over (order by (c.st = 'verified') desc, c.v desc, c.ts, lower(p.display_name), c.uid))::int
      from cur c join public.profiles p on p.id = c.uid
     where (p_scope = 'community' or c.st = 'verified')
       and p.show_spindex and p.show_on_leaderboard and not p.hidden_by_admin;
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
                        from private.board('spindex', 'all', v_scope) b where b.rank = 1 and b.detail = 'verified'),
      'active_crews', (select count(*) from private.crew_board('week', v_scope) c where c.minutes > 0)));
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.get_display_data() from public;
grant execute on function public.get_display_data() to anon, authenticated;
