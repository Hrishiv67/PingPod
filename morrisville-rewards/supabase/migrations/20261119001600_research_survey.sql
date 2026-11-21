-- Research survey: a link shown to new players ("Quick favor?") and on the profile page.
-- Anonymous: the app never adds anything about the player to the link. Owners change or clear it in
-- Admin → Settings (empty = no survey prompt).
alter table public.pilot_settings
  add column survey_url text check (survey_url is null or survey_url ~ '^https://');

update public.pilot_settings
   set survey_url = 'https://docs.google.com/forms/d/e/1FAIpQLSfZQ5hXNSCOuRfwqnv_CcqE36TBGtMDO-XlPapmkmmfj_y86Q/viewform'
 where id = 1;

create or replace function public.admin_update_settings(p_patch jsonb) returns public.pilot_settings
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
      rewards_enabled = coalesce((p_patch ->> 'rewards_enabled')::boolean, rewards_enabled),
      survey_url = case when p_patch ? 'survey_url'
        then nullif(private.clean_text(p_patch ->> 'survey_url'), '') else survey_url end
    where id = 1 returning * into r;
  exception when others then
    raise exception 'One of those settings isn''t valid (%).', sqlerrm;
  end;
  perform private.audit('settings.update', 'settings', '1', p_patch);
  return r;
end $$;

revoke execute on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
