-- Players now sign in with just their email: the app derives their password from the address
-- (src/lib/emailKey.ts; the iOS app does the same). Staff tools must never open that way, so a staff
-- or owner role only takes effect once the account has a password of its own. The check runs here,
-- on the server, so it holds for every client.

-- True when the account's password is still the email-derived key.
create or replace function private.on_email_key(p uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select u.encrypted_password is not null and u.encrypted_password <> ''
       and extensions.crypt(
             'Pp!' || left(encode(extensions.digest(lower(trim(u.email)) || '|pingpod-morrisville-email-only-v1', 'sha256'), 'hex'), 40) || '9',
             u.encrypted_password) = u.encrypted_password
      from auth.users u where u.id = p), false) $$;

create or replace function private.require_admin() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.is_admin(v) then raise exception 'Staff access only.'; end if;
  if private.on_email_key(v) then raise exception 'Set your staff password first: open the staff dashboard.'; end if;
  return v;
end $$;

create or replace function private.require_owner() returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not exists (select 1 from private.admins where user_id = v and role = 'owner') then
    raise exception 'Only the pilot owner can change this.';
  end if;
  if private.on_email_key(v) then raise exception 'Set your staff password first: open the staff dashboard.'; end if;
  return v;
end $$;

-- get_me: admin_role is only reported once the staff password is set; staff_needs_password tells
-- the app to ask for one. (The bcrypt check only runs for accounts that are in private.admins.)
create or replace function public.get_me() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); p public.profiles; a public.play_sessions; v_crew jsonb; v_spindex jsonb;
        v_role text; v_needs_pw boolean := false;
begin
  perform private.close_stale_sessions(v_uid);
  select role into v_role from private.admins where user_id = v_uid;
  if v_role is not null and private.on_email_key(v_uid) then
    v_role := null;
    v_needs_pw := true;
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('server_now', clock_timestamp(), 'profile', null, 'admin_role', v_role,
                              'staff_needs_password', v_needs_pw, 'settings', to_jsonb(private.settings()));
  end if;
  select * into a from public.play_sessions where user_id = v_uid and status = 'active';
  select jsonb_build_object('id', c.id, 'name', c.name, 'invite_code', c.invite_code, 'is_owner', c.owner_id = v_uid)
    into v_crew from public.crews c where c.id = private.active_crew(v_uid);
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'status', r.status, 'source', r.source,
                            'verified_at', r.verified_at, 'created_at', r.created_at)
    into v_spindex from public.spindex_ratings r
   where r.user_id = v_uid and r.status in ('unverified', 'verified') order by r.created_at desc limit 1;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'profile', to_jsonb(p) - 'hidden_reason',
    'admin_role', v_role,
    'staff_needs_password', v_needs_pw,
    'active_session', case when a.id is null then null else to_jsonb(a) end,
    'crew', v_crew,
    'spindex', v_spindex,
    'stats', private.user_stats(v_uid),
    'settings', to_jsonb(private.settings()));
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.get_me() from public, anon;
grant execute on function public.get_me() to authenticated;
