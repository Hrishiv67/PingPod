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
