-- Time-dependent rules the HTTP API can't fake (server clock, abandoned timers, DST weeks,
-- crew membership boundaries). Everything runs in ONE DO block that finishes by raising an
-- exception carrying the results, so every change is rolled back and nothing persists.
-- Run in the Supabase SQL editor; read the error text: "TIME LOGIC RESULTS: passed=N failed=0 ...".
-- Players are impersonated by setting request.jwt.claims (what auth.uid() reads); table
-- privileges for the authenticated role are covered separately by tests/integration.test.mjs.
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  r public.play_sessions; res jsonb := '[]'; failed int := 0; v int; v2 int; j jsonb;
  cx uuid; cy uuid; jn timestamptz := now() - interval '5 days'; lv timestamptz := now() - interval '2 days';
  wk date := private.week_start(private.today());
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tl-1@example.test'),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tl-2@example.test'),
    (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tl-3@example.test');
  insert into public.profiles (id, display_name) values (u1, 'TL One'), (u2, 'TL Two'), (u3, 'TL Three');
  update public.pilot_settings set crew_min_size = 1 where id = 1;  -- rolled back with everything else
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);

  -- 1. Minutes come from the server clock, not the phone.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '54 minutes 30 seconds' where id = r.id;
  r := public.stop_session(r.id);
  res := res || jsonb_build_object('t', 'stop uses server time (54 min)', 'ok', r.minutes = 54 and r.status = 'pending', 'got', r.minutes);

  -- 2. A Finish time in the future is ignored.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '40 minutes' where id = r.id;
  r := public.stop_session(r.id, clock_timestamp() + interval '1 hour');
  res := res || jsonb_build_object('t', 'future p_ended_at clamped to now', 'ok', r.minutes = 40, 'got', r.minutes);

  -- 3. An offline Finish tap from 10 minutes ago is honoured…
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '60 minutes' where id = r.id;
  r := public.stop_session(r.id, clock_timestamp() - interval '10 minutes');
  res := res || jsonb_build_object('t', 'recent offline p_ended_at honoured', 'ok', r.minutes = 50, 'got', r.minutes);

  -- 4. …but claims older than 30 minutes are clamped to now-30m.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '100 minutes' where id = r.id;
  r := public.stop_session(r.id, clock_timestamp() - interval '90 minutes');
  res := res || jsonb_build_object('t', 'stale p_ended_at clamped to now-30m', 'ok', r.minutes = 70, 'got', r.minutes);

  -- 5. Finishing after the maximum caps the session and flags it.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '170 minutes' where id = r.id;
  update public.play_sessions set started_at = clock_timestamp() - interval '179 minutes 59 seconds' where id = r.id;
  r := public.stop_session(r.id);
  res := res || jsonb_build_object('t', 'stop just under max not flagged', 'ok', r.minutes = 179 and not ('hit_max' = any (r.flags)), 'got', r.minutes);

  -- 6. Abandoned timers are closed at the maximum by the scheduled job and flagged for staff.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '4 hours' where id = r.id;
  v := private.close_stale_sessions(null);
  select * into r from public.play_sessions where id = r.id;
  res := res || jsonb_build_object('t', 'auto-close at 180 min', 'ok',
    v >= 1 and r.status = 'pending' and r.minutes = 180 and r.auto_closed and 'auto_closed' = any (r.flags)
    and r.ended_at = r.started_at + interval '180 minutes', 'got', to_jsonb(r) - 'note');

  -- 7. Reopening the app also closes an abandoned timer (get_me), so no "ghost" running timer.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '5 hours' where id = r.id;
  j := public.get_me();
  select * into r from public.play_sessions where id = r.id;
  res := res || jsonb_build_object('t', 'get_me closes stale timer', 'ok',
    j -> 'active_session' = 'null'::jsonb and r.status = 'pending' and r.auto_closed, 'got', j -> 'active_session');

  -- 8. Stopping a session past the max via stop_session is capped and flagged.
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '179 minutes' where id = r.id;
  update public.play_sessions set started_at = started_at - interval '2 minutes' where id = r.id;
  r := public.stop_session(r.id);
  res := res || jsonb_build_object('t', 'stop capped at max + hit_max flag', 'ok', r.minutes = 180 and 'hit_max' = any (r.flags), 'got', r.minutes);

  -- 9. DST: timer start dates use Morrisville local time (fall back 2026-11-01).
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes)
  values (u2, 'timer', 'approved', '2026-11-02 04:30:00+00', '2026-11-02 05:00:00+00', '2000-01-01', 30)
  returning * into r;
  res := res || jsonb_build_object('t', 'DST: 23:30 EST Nov 1 is played_on Nov 1 (week Oct 26)', 'ok',
    r.played_on = '2026-11-01' and private.week_start(r.played_on) = '2026-10-26', 'got', r.played_on);
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes)
  values (u2, 'timer', 'approved', '2026-11-02 05:30:00+00', '2026-11-02 06:00:00+00', '2000-01-01', 30)
  returning * into r;
  res := res || jsonb_build_object('t', 'DST: 00:30 EST Nov 2 starts the next week', 'ok',
    r.played_on = '2026-11-02' and private.week_start(r.played_on) = '2026-11-02', 'got', r.played_on);
  res := res || jsonb_build_object('t', 'spring forward: 2026-03-08 03:30 EDT is Mar 8', 'ok',
    ('2026-03-08 07:30:00+00'::timestamptz at time zone 'America/New_York')::date = '2026-03-08', 'got', null);
  delete from public.play_sessions where user_id = u2;

  -- 10. Weekly streaks: Monday-start weeks, current streak survives until the week after next.
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes)
  select u2, 'manual', 'approved', d::timestamp at time zone 'America/New_York' + interval '12 hours',
         d::timestamp at time zone 'America/New_York' + interval '13 hours', d, 60
    from unnest(array[wk - 35 + 6, wk - 28, wk - 21 + 3, wk - 7 + 1]) d;  -- Sun, Mon, Thu (3 weeks) … gap … last week
  select cur, longest into v, v2 from private.streaks_all(array['approved'], u2);
  res := res || jsonb_build_object('t', 'streak: longest 3 across gap, current 1 (last week counts)', 'ok',
    v = 1 and v2 = 3, 'got', jsonb_build_array(v, v2));

  -- 11. Crew attribution boundaries: joined/left instants, switching crews never double-counts.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  cx := (public.create_crew('TL Crew X')).id;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  cy := (public.create_crew('TL Crew Y')).id;
  update public.crew_memberships set joined_at = now() - interval '10 days' where crew_id = cx;
  update public.crew_memberships set joined_at = lv - interval '1 minute' where crew_id = cy;
  insert into public.crew_memberships (crew_id, user_id, joined_at, left_at, left_reason) values (cx, u3, jn, lv, 'left');
  insert into public.crew_memberships (crew_id, user_id, joined_at) values (cy, u3, lv);
  insert into public.play_sessions (user_id, method, status, started_at, ended_at, played_on, minutes) values
    (u3, 'manual', 'approved', jn - interval '2 hours', jn - interval '1 hour', (jn at time zone 'America/New_York')::date, 11),
    (u3, 'manual', 'approved', jn + interval '1 day', jn + interval '1 day 1 hour', ((jn + interval '1 day') at time zone 'America/New_York')::date, 22),
    (u3, 'manual', 'approved', lv - interval '1 hour', lv, (lv at time zone 'America/New_York')::date, 33),
    (u3, 'manual', 'approved', lv, lv + interval '1 hour', ((lv + interval '1 hour') at time zone 'America/New_York')::date, 44);
  select coalesce(sum(minutes), 0) into v from private.crew_board('all', 'verified') where crew_id = cx;
  select coalesce(sum(minutes), 0) into v2 from private.crew_board('all', 'verified') where crew_id = cy;
  res := res || jsonb_build_object('t', 'crew X gets play during membership incl. the leave instant (22+33)', 'ok', v = 55, 'got', v);
  res := res || jsonb_build_object('t', 'crew Y gets only play ending after joining (44)', 'ok', v2 = 44, 'got', v2);
  select max(n) into v from (
    select s.id, count(m.id) n from public.play_sessions s
      left join public.crew_memberships m on m.user_id = s.user_id and private.in_membership(s.ended_at, m.joined_at, m.left_at)
     where s.user_id = u3 group by s.id) t;
  res := res || jsonb_build_object('t', 'no session counts for two crews', 'ok', v <= 1, 'got', v);

  -- 12. Logging "today" never produces an end time in the future.
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.log_session(private.today(), 180);
  res := res || jsonb_build_object('t', 'manual today: ends now, starts minutes earlier, played_on kept', 'ok',
    r.ended_at <= clock_timestamp() and r.ended_at > clock_timestamp() - interval '1 minute'
    and r.started_at = r.ended_at - interval '180 minutes' and r.played_on = private.today() and r.minutes = 180,
    'got', jsonb_build_object('start', r.started_at, 'end', r.ended_at, 'day', r.played_on));

  -- 13. The "too short" cutoff for timers stays at 5 minutes even if the manual minimum is raised.
  update public.pilot_settings set manual_min_minutes = 10 where id = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '7 minutes' where id = r.id;
  r := public.stop_session(r.id);
  res := res || jsonb_build_object('t', '7-min timer counts when manual minimum is 10', 'ok', r.status = 'pending' and r.minutes = 7, 'got', r.status);
  r := public.start_session();
  update public.play_sessions set started_at = clock_timestamp() - interval '4 minutes' where id = r.id;
  r := public.stop_session(r.id);
  res := res || jsonb_build_object('t', '4-min timer is too short', 'ok', r.status = 'cancelled' and 'too_short' = any (r.flags), 'got', r.status);

  select count(*) into failed from jsonb_array_elements(res) e where not (e ->> 'ok')::boolean;
  raise exception 'TIME LOGIC RESULTS: passed=% failed=% %', jsonb_array_length(res) - failed, failed,
    (select jsonb_agg(e) from jsonb_array_elements(res) e where not (e ->> 'ok')::boolean or failed = 0);
end $$;
