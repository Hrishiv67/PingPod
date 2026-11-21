-- New public address for QR codes and links.
alter table public.pilot_settings alter column public_app_url set default 'https://www.pingpodrewards.site';
update public.pilot_settings set public_app_url = 'https://www.pingpodrewards.site';

-- Temporary "Players" board on the in-store screen: everyone who has signed up (and shows on the
-- leaderboard), newest first, so new players see their name right away. Turn off with
--   update public.pilot_settings set show_joined_board = false;
alter table public.pilot_settings add column if not exists show_joined_board boolean not null default true;

create or replace function public.get_joined_players(p_limit int default 50)
returns table(user_id uuid, display_name text, avatar_color text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.avatar_color, p.created_at
    from public.profiles p
   where (select s.show_joined_board from public.pilot_settings s limit 1)
     and p.show_on_leaderboard and not p.hidden_by_admin
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
revoke execute on function public.get_joined_players(int) from public;
grant execute on function public.get_joined_players(int) to anon, authenticated;
