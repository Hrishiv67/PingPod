-- Persona-test fixes.
-- "Top five" only counts weeks the player was signed up for: a session back-logged into a week
-- that ended before they joined can't earn it.
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
  select min(ranked.w) into v_top5_day from ranked
   where ranked.u = v_uid and ranked.r <= 5
     and ranked.w + 7 > (select (p.created_at at time zone 'America/New_York')::date from public.profiles p where p.id = v_uid);
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

revoke execute on function public.get_my_achievements() from public, anon;
grant execute on function public.get_my_achievements() to authenticated;
