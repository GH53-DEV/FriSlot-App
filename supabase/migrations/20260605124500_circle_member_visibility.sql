-- Let every active member of a circle read that circle, its active members,
-- and safe display labels used by chat/boards.

alter table if exists public.circles enable row level security;
alter table if exists public.circle_members enable row level security;

drop policy if exists "circles_select_owner_or_active_member" on public.circles;
create policy "circles_select_owner_or_active_member"
on public.circles
for select
to authenticated
using (public.is_active_circle_member(id));

drop policy if exists "circle_members_select_same_circle" on public.circle_members;
create policy "circle_members_select_same_circle"
on public.circle_members
for select
to authenticated
using (public.is_active_circle_member(circle_ref));

create or replace function public.list_user_display_labels(
  p_user_ids uuid[]
)
returns table(
  uid uuid,
  label text
)
language sql
security definer
set search_path = public
as $$
  select
    u.uid,
    coalesce(
      public.clean_member_label(u.display_name, false),
      public.clean_member_label(u.real_name, false),
      public.clean_member_label(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'), false),
      public.clean_member_label(u.email, true),
      public.clean_member_label(au.email, true),
      '密友'
    ) as label
  from unnest(coalesce(p_user_ids, array[]::uuid[])) as requested(user_id)
  join public.users u on u.uid = requested.user_id
  left join auth.users au on au.id = requested.user_id
  where auth.uid() is not null;
$$;

revoke execute on function public.list_user_display_labels(uuid[]) from public;
grant execute on function public.list_user_display_labels(uuid[]) to authenticated;
