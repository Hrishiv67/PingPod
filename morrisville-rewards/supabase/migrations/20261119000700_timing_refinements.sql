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
