-- Staff crew list also returns each crew's color, emblem and motto (so staff can see and clear mottos).
create or replace function public.admin_list_crews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.archived_at nulls first, x.created_at desc) from (
    select c.id, c.name, c.invite_code, c.created_at, c.archived_at, c.hidden_by_admin, c.hidden_reason,
           c.color, c.emblem, c.motto,
           c.owner_id, op.display_name as owner_name,
           (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                    'joined_at', m.joined_at) order by m.joined_at), '[]')
              from public.crew_memberships m join public.profiles p on p.id = m.user_id
             where m.crew_id = c.id and m.left_at is null) as members,
           (select count(*) from public.crew_memberships m where m.crew_id = c.id and m.left_at is not null) as past_members,
           (select b.minutes from private.crew_board('week', 'verified') b where b.crew_id = c.id) as week_verified_minutes
      from public.crews c left join public.profiles op on op.id = c.owner_id) x), '[]');
end $$;
