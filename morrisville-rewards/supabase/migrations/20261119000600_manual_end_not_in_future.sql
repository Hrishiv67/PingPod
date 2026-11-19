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
