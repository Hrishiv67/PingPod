-- Profile photos and short bios, tap-a-player profile cards, and crew style (color, motto, emblem).
-- Photos live in the public "avatars" storage bucket under <user id>/<file>; the database stores
-- only the path, and clients build the public URL:
--   <project url>/storage/v1/object/public/avatars/<avatar_path>
-- Staff can clear any photo, bio or motto from the dashboard.

-- ── Columns ────────────────────────────────────────────────────────────
alter table public.profiles
  add column bio text check (bio is null or char_length(bio) <= 140),
  add column avatar_path text
    check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$');

alter table public.crews
  add column color text not null default 'pink'
    check (color in ('pink', 'white', 'blue', 'green', 'orange', 'purple')),
  add column motto text check (motto is null or char_length(motto) <= 60),
  add column emblem text not null default 'users'
    check (emblem in ('users', 'flame', 'bolt', 'crown', 'target', 'rocket', 'star', 'shield'));

-- ── Storage: public avatars bucket, each player writes only their own folder ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Player functions ───────────────────────────────────────────────────
create function public.save_bio(p_bio text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); v_bio text := private.clean_text(p_bio); r public.profiles;
begin
  if v_bio is not null and char_length(v_bio) > 140 then raise exception 'Keep your bio to 140 characters.'; end if;
  if v_bio is not null and private.has_blocked_term(v_bio) then raise exception 'Please keep your bio friendly.'; end if;
  update public.profiles set bio = v_bio where id = v_uid returning * into r;
  return r;
end $$;

-- p_path = null removes the photo. The file must already be uploaded to the caller's own folder.
create function public.set_avatar(p_path text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); r public.profiles;
begin
  if p_path is not null then
    if p_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$') then
      raise exception 'That photo couldn''t be used. Try another.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
      raise exception 'That photo didn''t finish uploading. Try again.';
    end if;
    perform private.rate_limit('avatar', 20, interval '1 day');
  end if;
  update public.profiles set avatar_path = p_path where id = v_uid returning * into r;
  return r;
end $$;

-- Public profile card for any player on the boards (or a crewmate, or yourself).
create function public.get_player_card(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); p public.profiles; s public.pilot_settings := private.settings();
        v_theirs uuid := private.active_crew(p_user_id); v_mine uuid := private.active_crew(v_uid);
        v_week date := private.week_start(private.today()); st record;
begin
  select * into p from public.profiles where id = p_user_id;
  if not found then raise exception 'Player not found.'; end if;
  if p.id <> v_uid and (p.hidden_by_admin or not p.show_on_leaderboard)
     and (v_mine is null or v_mine is distinct from v_theirs) then
    raise exception 'This player keeps their profile private.';
  end if;
  select * into st from private.streaks_all(array['approved', 'pending'], p.id);
  return jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'avatar_color', p.avatar_color,
    'avatar_path', p.avatar_path,
    'bio', p.bio,
    'member_since', p.created_at,
    'is_me', p.id = v_uid,
    'crew', (select jsonb_build_object('name', c.name, 'color', c.color, 'emblem', c.emblem, 'motto', c.motto)
               from public.crews c where c.id = v_theirs and not c.hidden_by_admin),
    'week_minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                      where x.user_id = p.id and x.status in ('approved', 'pending') and x.played_on >= v_week),
    'total_minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                       where x.user_id = p.id and x.status in ('approved', 'pending')),
    'sessions', (select count(*) from public.play_sessions x where x.user_id = p.id and x.status in ('approved', 'pending')),
    'current_streak', coalesce(st.cur, 0),
    'longest_streak', coalesce(st.longest, 0),
    'rank_week', (select b.rank from private.board('minutes', 'week', s.default_board_scope) b where b.user_id = p.id),
    'spindex', case when p.show_spindex then (
                 select jsonb_build_object('rating', r.rating, 'verified', r.status = 'verified')
                   from public.spindex_ratings r
                  where r.user_id = p.id and r.status in ('unverified', 'verified') order by r.created_at desc limit 1) end);
end $$;

create function public.set_crew_style(p_color text, p_motto text, p_emblem text) returns public.crews
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); v_crew uuid := private.active_crew(v_uid);
        v_motto text := private.clean_text(p_motto); r public.crews;
begin
  if v_crew is null then raise exception 'You''re not in a crew.'; end if;
  if not exists (select 1 from public.crews where id = v_crew and owner_id = v_uid) then
    raise exception 'Only the crew owner can change this.';
  end if;
  if p_color is null or p_color not in ('pink', 'white', 'blue', 'green', 'orange', 'purple') then
    raise exception 'Pick one of the crew colors.';
  end if;
  if p_emblem is null or p_emblem not in ('users', 'flame', 'bolt', 'crown', 'target', 'rocket', 'star', 'shield') then
    raise exception 'Pick one of the crew emblems.';
  end if;
  if v_motto is not null and char_length(v_motto) > 60 then raise exception 'Keep the motto to 60 characters.'; end if;
  if v_motto is not null and private.has_blocked_term(v_motto) then raise exception 'Please choose a different motto.'; end if;
  update public.crews set color = p_color, motto = v_motto, emblem = p_emblem where id = v_crew returning * into r;
  return r;
end $$;

-- Players can remove one of their own finished sessions. It stays in their history as "removed"
-- and stops counting everywhere (boards, stats, streaks, crews).
create function public.remove_my_session(p_id uuid) returns public.play_sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r public.play_sessions;
begin
  select * into r from public.play_sessions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Session not found.'; end if;
  if r.status = 'active' then raise exception 'Finish or cancel the running timer instead.'; end if;
  if r.status = 'cancelled' then return r; end if;
  update public.play_sessions
     set status = 'cancelled', review_reason = 'Removed by player', reviewed_at = clock_timestamp()
   where id = p_id returning * into r;
  return r;
end $$;

-- ── Existing functions, now with photos and crew style ─────────────────
drop function public.get_leaderboard(text, text, text, int);
create function public.get_leaderboard(
  p_metric text default 'minutes', p_period text default 'week', p_scope text default 'verified', p_limit int default 50)
returns table (rank int, user_id uuid, display_name text, avatar_color text, value int, secondary int,
               sessions int, detail text, is_me boolean, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select b.rank, b.user_id, b.display_name, b.avatar_color, b.value, b.secondary, b.sessions, b.detail,
         coalesce(b.user_id = auth.uid(), false), p.avatar_path
    from private.board(p_metric, p_period, p_scope) b
    left join public.profiles p on p.id = b.user_id
   where b.rank <= least(greatest(coalesce(p_limit, 50), 1), 200) or b.user_id = auth.uid()
   order by b.rank $$;

drop function public.get_crew_leaderboard(text, text, int);
create function public.get_crew_leaderboard(
  p_period text default 'week', p_scope text default 'verified', p_limit int default 50)
returns table (rank int, crew_id uuid, name text, minutes int, members int, contributors int,
               avg_minutes int, is_mine boolean, color text, emblem text, motto text)
language sql stable security definer set search_path = '' as $$
  select b.rank, b.crew_id, b.name, b.minutes, b.members, b.contributors, b.avg_minutes,
         coalesce(b.crew_id = private.active_crew(auth.uid()), false), c.color, c.emblem, c.motto
    from private.crew_board(p_period, p_scope) b
    join public.crews c on c.id = b.crew_id
   where b.rank <= least(greatest(coalesce(p_limit, 50), 1), 200)
      or b.crew_id = private.active_crew(auth.uid())
   order by b.rank $$;

create or replace function public.preview_crew(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'color', c.color, 'emblem', c.emblem, 'motto', c.motto,
           'members', (select count(*) from public.crew_memberships m where m.crew_id = c.id and m.left_at is null),
           'max_members', (select crew_max_size from public.pilot_settings where id = 1))
    from public.crews c
   where c.invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and c.archived_at is null and not c.hidden_by_admin $$;

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
    'color', c.color, 'motto', c.motto, 'emblem', c.emblem,
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
               'avatar_path', p.avatar_path,
               'is_owner', m.user_id = c.owner_id, 'is_me', m.user_id = v_uid, 'joined_at', m.joined_at,
               'minutes', (select coalesce(sum(x.minutes), 0) from public.play_sessions x
                            where x.user_id = m.user_id and private.in_membership(x.ended_at, m.joined_at, m.left_at)
                              and x.status = any (v_st) and x.played_on >= v_start))
             order by m.joined_at), '[]')
        from public.crew_memberships m join public.profiles p on p.id = m.user_id
       where m.crew_id = v_crew and m.left_at is null));
end $$;

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
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'sessions', b.sessions)
                 order by b.rank)
               from private.board('minutes', 'week', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'longest', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'detail', b.detail)
                 order by b.rank)
               from private.board('longest', 'week', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'secondary', b.secondary)
                 order by b.rank)
               from private.board('streaks', 'all', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'spindex', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'display_name', b.display_name,
                 'avatar_color', b.avatar_color, 'avatar_path', p.avatar_path, 'value', b.value, 'detail', b.detail)
                 order by b.rank)
               from private.board('spindex', 'all', v_scope) b join public.profiles p on p.id = b.user_id
              where b.rank <= 8), '[]'),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('rank', cb.rank, 'name', cb.name, 'minutes', cb.minutes,
                 'members', cb.members, 'avg_minutes', cb.avg_minutes, 'color', c.color, 'emblem', c.emblem,
                 'motto', c.motto) order by cb.rank)
               from private.crew_board('week', v_scope) cb join public.crews c on c.id = cb.crew_id
              where cb.rank <= 6 and cb.minutes > 0), '[]'),
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

-- ── Staff: see and clear photos, bios and mottos ───────────────────────
create or replace function public.admin_list_players(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_q text := private.clean_text(p_search);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select u.id, p.display_name, u.email::text as email, u.created_at, u.last_sign_in_at, p.avatar_color,
           p.avatar_path, p.bio,
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

create or replace function public.admin_moderate_player(p_user_id uuid, p_action text, p_value text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_reason text := private.clean_text(p_reason); v_name text;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Player not found.'; end if;
  if p_action = 'hide' then
    update public.profiles set hidden_by_admin = true, hidden_reason = v_reason where id = p_user_id;
  elsif p_action = 'unhide' then
    update public.profiles set hidden_by_admin = false, hidden_reason = null where id = p_user_id;
  elsif p_action = 'rename' then
    v_name := private.clean_text(p_value);
    if v_name is null or v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,19}$' then
      raise exception 'Nicknames are 2–20 characters: letters, numbers, spaces, _ . or -';
    end if;
    if exists (select 1 from public.profiles where lower(display_name) = lower(v_name) and id <> p_user_id) then
      raise exception 'That nickname is taken.';
    end if;
    update public.profiles set display_name = v_name where id = p_user_id;
  elsif p_action = 'clear_photo' then
    update public.profiles set avatar_path = null where id = p_user_id;
  elsif p_action = 'clear_bio' then
    update public.profiles set bio = null where id = p_user_id;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('player.' || p_action, 'user', p_user_id::text,
                        jsonb_build_object('value', p_value, 'reason', v_reason));
end $$;

create or replace function public.admin_moderate_crew(p_crew_id uuid, p_action text, p_value text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_reason text := private.clean_text(p_reason); v_name text; v_target uuid;
begin
  if not exists (select 1 from public.crews where id = p_crew_id) then raise exception 'Crew not found.'; end if;
  if p_action = 'rename' then
    v_name := private.valid_crew_name(p_value);
    if exists (select 1 from public.crews where lower(name) = lower(v_name) and archived_at is null and id <> p_crew_id) then
      raise exception 'That crew name is taken.';
    end if;
    update public.crews set name = v_name where id = p_crew_id;
  elsif p_action = 'hide' then
    update public.crews set hidden_by_admin = true, hidden_reason = v_reason where id = p_crew_id;
  elsif p_action = 'unhide' then
    update public.crews set hidden_by_admin = false, hidden_reason = null where id = p_crew_id;
  elsif p_action = 'clear_motto' then
    update public.crews set motto = null where id = p_crew_id;
  elsif p_action = 'archive' then
    update public.crew_memberships set left_at = clock_timestamp(), left_reason = 'crew_archived'
     where crew_id = p_crew_id and left_at is null;
    update public.crews set archived_at = clock_timestamp() where id = p_crew_id and archived_at is null;
  elsif p_action in ('transfer', 'remove_member') then
    v_target := p_value::uuid;
    if not exists (select 1 from public.crew_memberships where crew_id = p_crew_id and user_id = v_target and left_at is null) then
      raise exception 'That player isn''t in this crew.';
    end if;
    if p_action = 'transfer' then
      update public.crews set owner_id = v_target where id = p_crew_id;
    else
      perform private.leave_crew_for(v_target, 'removed_by_staff');
    end if;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('crew.' || p_action, 'crew', p_crew_id::text, jsonb_build_object('value', p_value, 'reason', v_reason));
end $$;

-- ── Grants (same pattern as before: everything for signed-in players, boards for anon) ──
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
  public.get_display_data(), public.preview_crew(text) to anon;
