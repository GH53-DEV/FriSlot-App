-- Force-repair accepted invitations that already have accepted_by_uid but are still missing circle_members.

with ranked_members as (
  select
    cm.id,
    row_number() over (
      partition by cm.circle_ref, cm.user_id
      order by
        case when cm.status = 'active' then 0 else 1 end,
        case when cm.role = 'owner' then 0 else 1 end,
        cm.joined_at desc nulls last,
        cm.id desc
    ) as rn
  from public.circle_members cm
)
delete from public.circle_members cm
using ranked_members r
where cm.id = r.id
  and r.rn > 1;

create unique index if not exists uq_circle_members_circle_user
  on public.circle_members(circle_ref, user_id);

insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
select distinct on (i.accepted_by_uid)
  i.accepted_by_uid,
  coalesce(nullif(lower(trim(i.invited_email)), ''), nullif(lower(trim(au.email)), '')),
  public.clean_member_label(i.invitee_real_name, false),
  coalesce(
    public.clean_member_label(i.invitee_display_name, false),
    public.clean_member_label(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'), false)
  ),
  nullif(btrim(coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture', '')), ''),
  coalesce(
    nullif(btrim(coalesce(i.invitee_mobile, '')), ''),
    nullif(btrim(coalesce(au.phone, '')), '')
  ),
  now()
from public.invitations i
left join auth.users au on au.id = i.accepted_by_uid
where i.status = 'accepted'
  and i.accepted_by_uid is not null
order by
  i.accepted_by_uid,
  i.responded_at desc nulls last,
  i.created_at desc nulls last,
  i.id desc
on conflict (uid) do update
set
  email = coalesce(nullif(public.users.email, ''), excluded.email),
  real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
  display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
  photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
  mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
select distinct on (i.circle_ref, i.accepted_by_uid)
  i.circle_ref,
  i.accepted_by_uid,
  'member',
  'active',
  coalesce(i.responded_at, now())
from public.invitations i
where i.status = 'accepted'
  and i.accepted_by_uid is not null
order by
  i.circle_ref,
  i.accepted_by_uid,
  i.responded_at desc nulls last,
  i.created_at desc nulls last,
  i.id desc
on conflict (circle_ref, user_id) do update
  set status = 'active',
      role = case
        when public.circle_members.role = 'owner' then 'owner'
        else excluded.role
      end;

create or replace function public.repair_claimed_invitation_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
  select distinct on (i.accepted_by_uid)
    i.accepted_by_uid,
    coalesce(nullif(lower(trim(i.invited_email)), ''), nullif(lower(trim(au.email)), '')),
    public.clean_member_label(i.invitee_real_name, false),
    coalesce(
      public.clean_member_label(i.invitee_display_name, false),
      public.clean_member_label(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'), false)
    ),
    nullif(btrim(coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture', '')), ''),
    coalesce(
      nullif(btrim(coalesce(i.invitee_mobile, '')), ''),
      nullif(btrim(coalesce(au.phone, '')), '')
    ),
    now()
  from public.invitations i
  left join auth.users au on au.id = i.accepted_by_uid
  where i.status = 'accepted'
    and i.accepted_by_uid is not null
  order by
    i.accepted_by_uid,
    i.responded_at desc nulls last,
    i.created_at desc nulls last,
    i.id desc
  on conflict (uid) do update
  set
    email = coalesce(nullif(public.users.email, ''), excluded.email),
    real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
    display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
    photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
    mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  select distinct on (i.circle_ref, i.accepted_by_uid)
    i.circle_ref,
    i.accepted_by_uid,
    'member',
    'active',
    coalesce(i.responded_at, now())
  from public.invitations i
  where i.status = 'accepted'
    and i.accepted_by_uid is not null
  order by
    i.circle_ref,
    i.accepted_by_uid,
    i.responded_at desc nulls last,
    i.created_at desc nulls last,
    i.id desc
  on conflict (circle_ref, user_id) do update
    set status = 'active',
        role = case
          when public.circle_members.role = 'owner' then 'owner'
          else excluded.role
        end;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.repair_claimed_invitation_memberships() from public;
grant execute on function public.repair_claimed_invitation_memberships() to authenticated;
