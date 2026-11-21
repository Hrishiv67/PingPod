-- "How it works" shows once per player (not once per phone).
alter table public.profiles add column if not exists tutorial_seen_at timestamptz;
create or replace function public.mark_tutorial_seen() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set tutorial_seen_at = coalesce(tutorial_seen_at, now()) where id = (select auth.uid());
$$;
revoke execute on function public.mark_tutorial_seen() from public, anon;
grant execute on function public.mark_tutorial_seen() to authenticated;
