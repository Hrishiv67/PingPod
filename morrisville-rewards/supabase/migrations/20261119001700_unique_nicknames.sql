-- No repeated nicknames: names are compared ignoring capitals, spaces and punctuation, so "Hrishiv",
-- "hrishiv." and "H-rishiv" count as the same name. (Already case-insensitive before; this closes lookalikes.)
create or replace function private.name_key(p text) returns text
language sql immutable set search_path = '' as $$ select lower(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create unique index profiles_display_name_key on public.profiles (lower(regexp_replace(display_name, '[^A-Za-z0-9]', '', 'g')));

-- save_profile already turns the unique violation into "That nickname is taken. Try another."
-- Staff renames use the same comparison so they get a friendly message too.
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
    if exists (select 1 from public.profiles where private.name_key(display_name) = private.name_key(v_name) and id <> p_user_id) then
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

revoke execute on all functions in schema private from public, anon, authenticated;
