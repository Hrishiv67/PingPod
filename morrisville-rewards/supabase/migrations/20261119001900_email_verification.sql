-- Optional email verification ("Verify your email to be eligible for possible future rewards").
-- The player gets a one-time code (or link) by email; signing in with it gives a session whose
-- JWT "amr" lists an OTP sign-in. confirm_email_verified() only marks the profile when that proof
-- is in the caller's own token from the last hour, so a phone can't fake it.
alter table public.profiles add column email_verified_at timestamptz;

create or replace function public.confirm_email_verified() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.profiles; v_ok boolean;
begin
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
     where a ->> 'method' in ('otp', 'magiclink')
       and coalesce((a ->> 'timestamp')::bigint, 0) > extract(epoch from now() - interval '1 hour')
  ) into v_ok;
  if not v_ok then raise exception 'Enter the code from your email first.'; end if;
  update public.profiles set email_verified_at = coalesce(email_verified_at, now()) where id = v_uid returning * into r;
  return r;
end $$;

-- Staff see who has verified (for prize eligibility).
create or replace function public.admin_list_players(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_q text := private.clean_text(p_search);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select u.id, p.display_name, u.email::text as email, u.created_at, u.last_sign_in_at, p.avatar_color,
           p.avatar_path, p.bio, p.email_verified_at,
           p.show_on_leaderboard, p.hidden_by_admin, p.hidden_reason, a.role as admin_role,
           (select count(*) from public.play_sessions s where s.user_id = u.id and s.status in ('pending', 'approved')) as sessions,
           (select coalesce(sum(s.minutes), 0) from public.play_sessions s where s.user_id = u.id and s.status = 'approved') as approved_minutes,
           (select coalesce(sum(s.minutes), 0) from public.play_sessions s where s.user_id = u.id and s.status = 'pending') as pending_minutes,
           (select c.name from public.crews c where c.id = private.active_crew(u.id)) as crew_name,
           (select jsonb_build_object('rating', r.rating, 'status', r.status) from public.spindex_ratings r
             where r.user_id = u.id and r.status in ('unverified', 'verified') order by r.created_at desc limit 1) as spindex
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join private.admins a on a.user_id = u.id
     where v_q is null or p.display_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%'
     order by u.created_at desc limit 500) x), '[]');
end $$;

revoke execute on function public.confirm_email_verified() from public, anon;
grant execute on function public.confirm_email_verified() to authenticated;
revoke execute on function public.admin_list_players(text) from public, anon;
grant execute on function public.admin_list_players(text) to authenticated;
