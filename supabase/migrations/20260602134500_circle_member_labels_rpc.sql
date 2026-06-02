-- Provide circle member labels through a security definer RPC so RLS on users does not leak UUIDs in the app UI.

create or replace function public.list_circle_members_with_labels(
  p_circle_id uuid,
  p_uid uuid default auth.uid()
)
returns table(
  user_id uuid,
  role text,
  label text
)
language sql
security definer
set search_path = public
as $$
  select
    cm.user_id,
    case when cm.role = 'owner' then 'owner' else 'member' end as role,
    coalesce(
      nullif(btrim(coalesce(u.display_name, '')), ''),
      nullif(btrim(coalesce(u.real_name, '')), ''),
      nullif(btrim(coalesce(u.email, '')), ''),
      nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''),
      nullif(btrim(coalesce(au.email, '')), ''),
      '密友'
    ) as label
  from public.circle_members cm
  join public.circles c on c.id = cm.circle_ref
  left join public.users u on u.uid = cm.user_id
  left join auth.users au on au.id = cm.user_id
  where cm.circle_ref = p_circle_id
    and cm.status = 'active'
    and auth.uid() is not null
    and (
      c.owner_id = auth.uid()
      or exists (
        select 1
        from public.circle_members viewer
        where viewer.circle_ref = p_circle_id
          and viewer.user_id = auth.uid()
          and viewer.status = 'active'
      )
    )
  order by
    case when cm.role = 'owner' then 0 else 1 end,
    cm.joined_at,
    cm.user_id;
$$;

revoke execute on function public.list_circle_members_with_labels(uuid, uuid) from public;
grant execute on function public.list_circle_members_with_labels(uuid, uuid) to authenticated;
