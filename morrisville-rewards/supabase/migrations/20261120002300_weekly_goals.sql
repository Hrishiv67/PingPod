-- Weekly Rally goals: each player can set how many minutes and how many days they want to play
-- each week. Stored on the profile so the goal follows them across phones. Both null = no goal.
alter table public.profiles
  add column weekly_goal_days smallint check (weekly_goal_days between 1 and 7),
  add column weekly_goal_minutes int check (weekly_goal_minutes between 15 and 10080);

create or replace function public.save_weekly_goals(p_days int, p_minutes int) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.profiles;
begin
  if (p_days is null) <> (p_minutes is null) then raise exception 'Pick both hours and days, or clear the goal.'; end if;
  if p_days is not null and (p_days < 1 or p_days > 7) then raise exception 'Pick 1 to 7 days.'; end if;
  if p_minutes is not null and (p_minutes < 15 or p_minutes > 10080) then raise exception 'Pick between 15 minutes and 168 hours.'; end if;
  if p_minutes is not null and p_minutes > p_days * 1440 then raise exception 'That''s more time than those days have.'; end if;
  perform private.rate_limit('weekly_goals', 30, interval '1 hour');
  update public.profiles set weekly_goal_days = p_days, weekly_goal_minutes = p_minutes, updated_at = now()
   where id = v_uid returning * into r;
  return r;
end $$;

revoke execute on function public.save_weekly_goals(int, int) from public, anon;
grant execute on function public.save_weekly_goals(int, int) to authenticated;
