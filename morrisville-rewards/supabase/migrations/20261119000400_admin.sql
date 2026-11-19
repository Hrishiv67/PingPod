-- PingPod Morrisville Rewards · 004 staff tools, analytics, permissions, scheduled cleanup.
-- Staff rights live in private.admins (not editable by players). Every staff change is audited.
-- Roles: owner (settings, rewards, staff, deletions) and staff (reviews and moderation).

-- One-time staff codes (stored hashed) let the first owner claim access without editing SQL.
create function public.admin_claim(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); r private.admin_claim_codes;
begin
  select * into r from private.admin_claim_codes
   where code_hash = encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    perform pg_sleep(1);
    raise exception 'That staff code didn''t work.';
  end if;
  insert into private.admins (user_id, role, added_by) values (v_uid, r.role, v_uid)
  on conflict (user_id) do update set role = case when excluded.role = 'owner' then 'owner' else private.admins.role end;
  update private.admin_claim_codes set used_by = v_uid, used_at = now() where code_hash = r.code_hash;
  perform private.audit('staff.claimed', 'user', v_uid::text, jsonb_build_object('role', r.role));
  return jsonb_build_object('role', r.role);
end $$;

-- ── Session review ─────────────────────────────────────────────────────
create function public.admin_list_sessions(p_status text default 'pending', p_search text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select s.id, s.user_id, p.display_name, s.method, s.status, s.minutes, s.submitted_minutes, s.played_on,
           s.started_at, s.ended_at, s.note, s.flags, s.auto_closed, s.last_checkin_at, s.created_at,
           s.reviewed_at, s.review_reason, rp.display_name as reviewed_by_name, s.user_id = v_uid as is_own,
           (select count(*) from public.play_sessions s2 where s2.user_id = s.user_id and s2.status in ('pending', 'approved')) as player_sessions,
           (select count(*) from public.play_sessions s3 where s3.user_id = s.user_id and s3.status = 'rejected') as player_rejections
      from public.play_sessions s join public.profiles p on p.id = s.user_id
      left join public.profiles rp on rp.id = s.reviewed_by
     where ((coalesce(p_status, 'all') = 'all' and s.status <> 'active') or s.status = p_status)
       and (private.clean_text(p_search) is null or p.display_name ilike '%' || private.clean_text(p_search) || '%')
     order by s.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]');
end $$;

create function public.admin_review_session(p_id uuid, p_action text, p_minutes int default null, p_reason text default null)
returns public.play_sessions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); o public.play_sessions; r public.play_sessions;
        v_reason text := private.clean_text(p_reason); s public.pilot_settings := private.settings();
        v_max int := greatest(s.max_session_minutes, s.manual_max_minutes);
begin
  select * into o from public.play_sessions where id = p_id for update;
  if not found then raise exception 'Session not found.'; end if;
  if o.user_id = v_uid then raise exception 'You can''t review your own session. Ask another staff member.'; end if;
  if o.status in ('active', 'cancelled') then raise exception 'Only finished sessions can be reviewed.'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > v_max) then
    raise exception 'Minutes must be between 1 and %.', v_max;
  end if;
  if p_action = 'approve' then
    if o.status = 'approved' then raise exception 'Already approved.'; end if;
    if o.status <> 'pending' then raise exception 'Reopen this session before approving it.'; end if;
    if p_minutes is not null and p_minutes <> o.minutes and v_reason is null then
      raise exception 'Add a reason when changing the minutes.';
    end if;
    update public.play_sessions set status = 'approved', minutes = coalesce(p_minutes, minutes),
           reviewed_by = v_uid, reviewed_at = clock_timestamp(), review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'reject' then
    if o.status = 'rejected' then raise exception 'Already rejected.'; end if;
    if o.status = 'approved' and v_reason is null then raise exception 'Add a reason when rejecting an approved session.'; end if;
    update public.play_sessions set status = 'rejected', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'adjust' then
    if p_minutes is null or v_reason is null then raise exception 'Enter the corrected minutes and a reason.'; end if;
    if o.status = 'rejected' then raise exception 'Reopen this session first.'; end if;
    update public.play_sessions set minutes = p_minutes, reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  elsif p_action = 'reopen' then
    if o.status = 'pending' then raise exception 'Already pending.'; end if;
    if v_reason is null then raise exception 'Add a reason.'; end if;
    update public.play_sessions set status = 'pending', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = v_reason
     where id = p_id returning * into r;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('session.' || p_action, 'session', p_id::text, jsonb_build_object(
    'player', o.user_id, 'reason', v_reason,
    'before', jsonb_build_object('status', o.status, 'minutes', o.minutes),
    'after', jsonb_build_object('status', r.status, 'minutes', r.minutes)));
  return r;
end $$;

create function public.admin_bulk_approve(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_ids uuid[]; n int;
begin
  with u as (
    update public.play_sessions set status = 'approved', reviewed_by = v_uid, reviewed_at = clock_timestamp(),
           review_reason = 'Approved in bulk'
     where id = any (p_ids) and status = 'pending' and user_id <> v_uid
    returning id)
  select array_agg(id), count(*) into v_ids, n from u;
  if n > 0 then
    perform private.audit('session.bulk_approve', 'session', null, jsonb_build_object('ids', to_jsonb(v_ids), 'count', n));
  end if;
  return n;
end $$;

-- ── Players ────────────────────────────────────────────────────────────
create function public.admin_list_players(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); v_q text := private.clean_text(p_search);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select u.id, p.display_name, u.email::text as email, u.created_at, u.last_sign_in_at, p.avatar_color,
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

create function public.admin_moderate_player(p_user_id uuid, p_action text, p_value text default null, p_reason text default null)
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
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('player.' || p_action, 'user', p_user_id::text,
                        jsonb_build_object('value', p_value, 'reason', v_reason));
end $$;

create function public.admin_delete_player(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner();
begin
  if p_user_id = v_uid then raise exception 'Use Delete account on your own profile instead.'; end if;
  if private.is_admin(p_user_id) then raise exception 'Remove their staff access first.'; end if;
  if private.clean_text(p_reason) is null then raise exception 'Add a reason (for example, the player''s request).'; end if;
  perform private.leave_crew_for(p_user_id, 'account_deleted');
  perform private.audit('account.deleted_by_staff', 'user', p_user_id::text, jsonb_build_object('reason', p_reason));
  delete from auth.users where id = p_user_id;
  if not found then raise exception 'Player not found.'; end if;
end $$;

-- ── Crews ──────────────────────────────────────────────────────────────
create function public.admin_list_crews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.archived_at nulls first, x.created_at desc) from (
    select c.id, c.name, c.invite_code, c.created_at, c.archived_at, c.hidden_by_admin, c.hidden_reason,
           c.owner_id, op.display_name as owner_name,
           (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                    'joined_at', m.joined_at) order by m.joined_at), '[]')
              from public.crew_memberships m join public.profiles p on p.id = m.user_id
             where m.crew_id = c.id and m.left_at is null) as members,
           (select count(*) from public.crew_memberships m where m.crew_id = c.id and m.left_at is not null) as past_members,
           (select b.minutes from private.crew_board('week', 'verified') b where b.crew_id = c.id) as week_verified_minutes
      from public.crews c left join public.profiles op on op.id = c.owner_id) x), '[]');
end $$;

create function public.admin_moderate_crew(p_crew_id uuid, p_action text, p_value text default null, p_reason text default null)
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

-- ── SPINDEX verification ───────────────────────────────────────────────
create function public.admin_list_spindex(p_status text default 'unverified') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select r.id, r.user_id, p.display_name, r.rating, r.status, r.source, r.player_note, r.created_at,
           r.verified_at, r.verification_source, vp.display_name as verified_by_name
      from public.spindex_ratings r join public.profiles p on p.id = r.user_id
      left join public.profiles vp on vp.id = r.verified_by
     where (coalesce(p_status, 'all') = 'all' and r.status <> 'superseded') or r.status = p_status
     order by r.created_at desc limit 300) x), '[]');
end $$;

create function public.admin_review_spindex(p_id uuid, p_action text, p_source text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin(); r public.spindex_ratings; v_source text := private.clean_text(p_source);
begin
  select * into r from public.spindex_ratings where id = p_id for update;
  if not found or r.status not in ('unverified', 'verified') then raise exception 'That rating is no longer current.'; end if;
  if r.user_id = v_uid then raise exception 'Ask another staff member to verify your own rating.'; end if;
  if p_action = 'verify' then
    if v_source is null then raise exception 'Say how you verified it (for example, "Saw SPINDEX app in person").'; end if;
    update public.spindex_ratings set status = 'verified', source = 'staff_verified', verified_by = v_uid,
           verified_at = clock_timestamp(), verification_source = v_source where id = p_id;
  elsif p_action = 'reject' then
    update public.spindex_ratings set status = 'rejected', verified_by = v_uid, verified_at = clock_timestamp(),
           verification_source = v_source where id = p_id;
  elsif p_action = 'unverify' then
    update public.spindex_ratings set status = 'unverified', source = 'self_reported', verified_by = null,
           verified_at = null, verification_source = null where id = p_id;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.audit('spindex.' || p_action, 'spindex', p_id::text,
                        jsonb_build_object('player', r.user_id, 'rating', r.rating, 'source', v_source));
end $$;

-- ── Player requests ────────────────────────────────────────────────────
create function public.admin_list_requests(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select q.id, q.kind, q.message, q.status, q.created_at, q.admin_response, q.resolved_at, q.user_id,
           p.display_name, q.session_id,
           (select jsonb_build_object('played_on', s.played_on, 'minutes', s.minutes, 'status', s.status, 'method', s.method)
              from public.play_sessions s where s.id = q.session_id) as session
      from public.support_requests q left join public.profiles p on p.id = q.user_id
     where coalesce(p_status, 'all') = 'all' or q.status = p_status
     order by q.created_at desc limit 300) x), '[]');
end $$;

create function public.admin_resolve_request(p_id uuid, p_status text, p_response text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  if p_status not in ('resolved', 'dismissed', 'open') then raise exception 'Unknown status.'; end if;
  update public.support_requests set status = p_status, admin_response = private.clean_text(p_response),
         resolved_by = case when p_status = 'open' then null else v_uid end,
         resolved_at = case when p_status = 'open' then null else clock_timestamp() end
   where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
  perform private.audit('request.' || p_status, 'request', p_id::text, jsonb_build_object('response', p_response));
end $$;

-- ── Settings, rewards, staff (owner only) ──────────────────────────────
create function public.admin_update_settings(p_patch jsonb) returns public.pilot_settings
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner(); r public.pilot_settings;
begin
  begin
    update public.pilot_settings set
      venue_name = coalesce(private.clean_text(p_patch ->> 'venue_name'), venue_name),
      public_app_url = coalesce(private.clean_text(p_patch ->> 'public_app_url'), public_app_url),
      pilot_start = case when p_patch ? 'pilot_start' then nullif(p_patch ->> 'pilot_start', '')::date else pilot_start end,
      pilot_end = case when p_patch ? 'pilot_end' then nullif(p_patch ->> 'pilot_end', '')::date else pilot_end end,
      max_session_minutes = coalesce((p_patch ->> 'max_session_minutes')::int, max_session_minutes),
      checkin_reminder_minutes = coalesce((p_patch ->> 'checkin_reminder_minutes')::int, checkin_reminder_minutes),
      manual_min_minutes = coalesce((p_patch ->> 'manual_min_minutes')::int, manual_min_minutes),
      manual_max_minutes = coalesce((p_patch ->> 'manual_max_minutes')::int, manual_max_minutes),
      backdate_days = coalesce((p_patch ->> 'backdate_days')::int, backdate_days),
      daily_minutes_cap = coalesce((p_patch ->> 'daily_minutes_cap')::int, daily_minutes_cap),
      crew_min_size = coalesce((p_patch ->> 'crew_min_size')::int, crew_min_size),
      crew_max_size = coalesce((p_patch ->> 'crew_max_size')::int, crew_max_size),
      auto_approve_timer = coalesce((p_patch ->> 'auto_approve_timer')::boolean, auto_approve_timer),
      default_board_scope = coalesce(p_patch ->> 'default_board_scope', default_board_scope),
      display_scope = coalesce(p_patch ->> 'display_scope', display_scope),
      display_rotation_seconds = coalesce((p_patch ->> 'display_rotation_seconds')::int, display_rotation_seconds),
      display_slides = case when p_patch ? 'display_slides'
        then array(select jsonb_array_elements_text(p_patch -> 'display_slides')) else display_slides end,
      boards_enabled = case when p_patch ? 'boards_enabled'
        then array(select jsonb_array_elements_text(p_patch -> 'boards_enabled')) else boards_enabled end,
      rewards_enabled = coalesce((p_patch ->> 'rewards_enabled')::boolean, rewards_enabled)
    where id = 1 returning * into r;
  exception when others then
    raise exception 'One of those settings isn''t valid (%).', sqlerrm;
  end;
  perform private.audit('settings.update', 'settings', '1', p_patch);
  return r;
end $$;

create function public.admin_list_rewards() returns setof public.rewards
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select * from public.rewards order by created_at desc;
end $$;

create function public.admin_save_reward(
  p_id uuid, p_title text, p_description text, p_criteria text, p_enabled boolean, p_approval_note text)
returns public.rewards language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner(); r public.rewards;
begin
  if coalesce(p_enabled, false) and char_length(coalesce(private.clean_text(p_approval_note), '')) < 5 then
    raise exception 'Record who approved this reward and how it''s fulfilled before turning it on.';
  end if;
  if p_id is null then
    insert into public.rewards (title, description, criteria, enabled, approval_note)
    values (private.clean_text(p_title), private.clean_text(p_description), private.clean_text(p_criteria),
            coalesce(p_enabled, false), private.clean_text(p_approval_note))
    returning * into r;
  else
    update public.rewards set title = private.clean_text(p_title), description = private.clean_text(p_description),
           criteria = private.clean_text(p_criteria), enabled = coalesce(p_enabled, false),
           approval_note = private.clean_text(p_approval_note)
     where id = p_id returning * into r;
    if not found then raise exception 'Reward not found.'; end if;
  end if;
  perform private.audit('reward.save', 'reward', r.id::text, to_jsonb(r));
  return r;
end $$;

create function public.admin_list_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role, 'added_at', a.added_at,
           'display_name', p.display_name, 'email', u.email) order by a.added_at)
    from private.admins a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id), '[]');
end $$;

create function public.admin_set_staff(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_owner();
begin
  if p_user_id = v_uid then raise exception 'You can''t change your own access.'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Player not found.'; end if;
  if p_role is null then
    delete from private.admins where user_id = p_user_id;
  elsif p_role in ('owner', 'staff') then
    insert into private.admins (user_id, role, added_by) values (p_user_id, p_role, v_uid)
    on conflict (user_id) do update set role = excluded.role;
  else
    raise exception 'Unknown role.';
  end if;
  perform private.audit('staff.set', 'user', p_user_id::text, jsonb_build_object('role', p_role));
end $$;

create function public.admin_audit_log(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, p.display_name as actor_name
      from private.audit_log l left join public.profiles p on p.id = l.actor_id
     order by l.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]');
end $$;

-- ── Pilot analytics (aggregates only; no emails or notes) ─────────────
create function private.weekly_stats(p_from date) returns jsonb language sql stable set search_path = '' as $$
  with weeks as (
    select generate_series(private.week_start(p_from), private.week_start(private.today()), interval '7 days')::date w),
  q as (select s.*, private.week_start(s.played_on) w from public.play_sessions s where s.status in ('pending', 'approved')),
  firsts as (select q.user_id, min(q.w) first_w from q group by q.user_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', weeks.w,
    'active_players', (select count(distinct q.user_id) from q where q.w = weeks.w),
    'returning_players', (select count(distinct q.user_id) from q join firsts f on f.user_id = q.user_id
                           where q.w = weeks.w and f.first_w < weeks.w),
    'new_signups', (select count(*) from public.profiles p
                     where private.week_start((p.created_at at time zone 'America/New_York')::date) = weeks.w),
    'sessions', (select count(*) from q where q.w = weeks.w),
    'timer_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'timer'),
    'manual_sessions', (select count(*) from q where q.w = weeks.w and q.method = 'manual'),
    'approved_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'approved'),
    'pending_minutes', (select coalesce(sum(q.minutes), 0) from q where q.w = weeks.w and q.status = 'pending'),
    'crews_with_play', (select count(*) from private.crew_board('all', 'community') b
                         where exists (select 1 from public.crew_memberships m join q on q.user_id = m.user_id
                                        and q.started_at >= m.joined_at and (m.left_at is null or q.started_at < m.left_at)
                                        where m.crew_id = b.crew_id and q.w = weeks.w)))
    order by weeks.w), '[]')
  from weeks $$;

create function public.admin_analytics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings();
        v_from date;
begin
  perform private.require_admin();
  v_from := coalesce(s.pilot_start, (select min(played_on) from public.play_sessions), private.today());
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'pilot_start', s.pilot_start, 'pilot_end', s.pilot_end,
    'accounts', (select count(*) from auth.users),
    'registered_players', (select count(*) from public.profiles),
    'players_with_session', (select count(distinct user_id) from public.play_sessions where status in ('pending', 'approved')),
    'repeat_players_days', (select count(*) from (select user_id from public.play_sessions where status in ('pending', 'approved')
                              group by user_id having count(distinct played_on) >= 2) t),
    'repeat_players_weeks', (select count(*) from (select user_id from public.play_sessions where status in ('pending', 'approved')
                              group by user_id having count(distinct private.week_start(played_on)) >= 2) t),
    'sessions', (select jsonb_build_object(
        'counted', count(*) filter (where status in ('pending', 'approved')),
        'approved', count(*) filter (where status = 'approved'),
        'pending', count(*) filter (where status = 'pending'),
        'rejected', count(*) filter (where status = 'rejected'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'active_now', count(*) filter (where status = 'active'),
        'timer', count(*) filter (where method = 'timer' and status in ('pending', 'approved')),
        'manual', count(*) filter (where method = 'manual' and status in ('pending', 'approved')),
        'auto_closed', count(*) filter (where auto_closed)) from public.play_sessions),
    'minutes', (select jsonb_build_object(
        'approved', coalesce(sum(minutes) filter (where status = 'approved'), 0),
        'pending', coalesce(sum(minutes) filter (where status = 'pending'), 0),
        'rejected', coalesce(sum(minutes) filter (where status = 'rejected'), 0)) from public.play_sessions),
    'crews', jsonb_build_object(
        'total', (select count(*) from public.crews where archived_at is null),
        'eligible', (select count(*) from private.crew_board('all', 'community')),
        'active_this_week', (select count(*) from private.crew_board('week', 'community') where minutes > 0)),
    'spindex', (select jsonb_build_object(
        'self_reported', count(*) filter (where status = 'unverified'),
        'verified', count(*) filter (where status = 'verified')) from public.spindex_ratings),
    'open_requests', (select count(*) from public.support_requests where status = 'open'),
    'weekly', private.weekly_stats(v_from));
end $$;

-- CSV-ready exports with pseudonymous player references (no names, emails or notes).
create function public.admin_export(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pilot_settings := private.settings();
begin
  perform private.require_admin();
  if p_kind = 'weekly' then
    return private.weekly_stats(coalesce(s.pilot_start, (select min(played_on) from public.play_sessions), private.today()));
  elsif p_kind = 'players' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.joined_on) from (
      select 'P' || substr(encode(extensions.digest(p.id::text || ':pingpod-morrisville', 'sha256'), 'hex'), 1, 8) as player_ref,
             (p.created_at at time zone 'America/New_York')::date as joined_on,
             count(q.id) as sessions,
             count(q.id) filter (where q.method = 'timer') as timer_sessions,
             count(q.id) filter (where q.method = 'manual') as manual_sessions,
             coalesce(sum(q.minutes) filter (where q.status = 'approved'), 0) as approved_minutes,
             coalesce(sum(q.minutes) filter (where q.status = 'pending'), 0) as pending_minutes,
             count(distinct q.played_on) as active_days,
             count(distinct private.week_start(q.played_on)) as active_weeks,
             (private.active_crew(p.id) is not null) as in_crew,
             p.show_on_leaderboard as public_profile
        from public.profiles p
        left join public.play_sessions q on q.user_id = p.id and q.status in ('pending', 'approved')
       group by p.id) x), '[]');
  elsif p_kind = 'sessions' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.played_on, x.player_ref) from (
      select 'P' || substr(encode(extensions.digest(q.user_id::text || ':pingpod-morrisville', 'sha256'), 'hex'), 1, 8) as player_ref,
             q.played_on, private.week_start(q.played_on) as week_start, q.method, q.status, q.minutes, q.auto_closed
        from public.play_sessions q where q.status in ('pending', 'approved', 'rejected')) x), '[]');
  else
    raise exception 'Unknown export.';
  end if;
end $$;

-- ── Permissions ────────────────────────────────────────────────────────
-- Postgres and Supabase grant EXECUTE broadly by default; lock it down, then open exactly what's needed.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
  public.get_display_data(), public.preview_crew(text) to anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ── Scheduled cleanup: close abandoned timers, trim rate-limit history ──
create extension if not exists pg_cron;
select cron.schedule('pingpod-close-stale-sessions', '*/10 * * * *',
  $$select private.close_stale_sessions(null); delete from private.rate_events where at < now() - interval '3 days';$$);
