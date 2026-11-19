-- iPad display: add a "Highest SPINDEX" screen and show every board by default
-- (most minutes, streaks, longest session, crews, SPINDEX, weekly highlights).

-- Allow 'spindex' as a display screen (drop the old check, whatever Postgres named it).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.pilot_settings'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%display_slides%'
  loop
    execute format('alter table public.pilot_settings drop constraint %I', c);
  end loop;
end $$;

alter table public.pilot_settings
  add constraint pilot_settings_display_slides_check
  check (display_slides <@ array['minutes', 'streaks', 'longest', 'crews', 'spindex', 'highlights']::text[]
         and cardinality(display_slides) > 0);

alter table public.pilot_settings
  alter column display_slides set default '{minutes,streaks,longest,crews,spindex,highlights}';

update public.pilot_settings
   set display_slides = '{minutes,streaks,longest,crews,spindex,highlights}'
 where id = 1;

-- Same payload as before plus `spindex` (top 8 current ratings; respects show_spindex,
-- show_on_leaderboard and staff hiding, exactly like get_leaderboard('spindex')).
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
                 'avatar_color', b.avatar_color, 'value', b.value, 'sessions', b.sessions) order by b.rank)
               from private.board('minutes', 'week', v_scope) b where b.rank <= 8), '[]'),
    'longest', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'detail', b.detail) order by b.rank)
               from private.board('longest', 'week', v_scope) b where b.rank <= 8), '[]'),
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'secondary', b.secondary) order by b.rank)
               from private.board('streaks', 'all', v_scope) b where b.rank <= 8), '[]'),
    'spindex', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'value', b.value, 'detail', b.detail) order by b.rank)
               from private.board('spindex', 'all', v_scope) b where b.rank <= 8), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('rank', c.rank, 'name', c.name, 'minutes', c.minutes,
                 'members', c.members, 'avg_minutes', c.avg_minutes) order by c.rank)
               from private.crew_board('week', v_scope) c where c.rank <= 6 and c.minutes > 0), '[]'),
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
                        from private.board('spindex', 'all', v_scope) b where b.rank = 1),
      'active_crews', (select count(*) from private.crew_board('week', v_scope) c where c.minutes > 0)));
end $$;

grant execute on function public.get_display_data() to anon, authenticated;
