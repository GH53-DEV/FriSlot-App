-- Repair accepted invitations that did not create circle_members rows.
-- This migration is intentionally later than 20260602150000 so deployed DBs that already ran it get a new executable fix.

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

create or replace function public.claim_accepted_invitation(
  p_token text,
  p_uid uuid,
  p_email text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_auth_email text;
  v_auth_display_name text;
  v_auth_photo_url text;
  v_auth_mobile text;
  v_invited_email text;
  v_invitee_real_name text;
  v_invitee_display_name text;
  v_invitee_mobile text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_uid is distinct from v_uid then
    raise exception 'p_uid must match authenticated user';
  end if;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', p_email, '')));

  select
    lower(trim(coalesce(au.email, ''))),
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
    coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture'),
    au.phone
  into
    v_auth_email,
    v_auth_display_name,
    v_auth_photo_url,
    v_auth_mobile
  from auth.users au
  where au.id = v_uid
  limit 1;

  if v_email = '' then
    v_email := coalesce(v_auth_email, '');
  end if;
  if v_email = '' then
    raise exception 'email required';
  end if;

  select
    lower(trim(coalesce(i.invited_email, ''))),
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into
    v_invited_email,
    v_invitee_real_name,
    v_invitee_display_name,
    v_invitee_mobile
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_invited_email is null then
    raise exception 'invitation not found';
  end if;
  if v_invited_email <> '' and v_invited_email <> v_email then
    raise exception 'email does not match invitation';
  end if;

  update public.invitations i
  set
    status = 'accepted',
    responded_at = coalesce(i.responded_at, now()),
    accepted_by_uid = v_uid,
    invited_email = coalesce(nullif(i.invited_email, ''), nullif(v_email, '')),
    invitee_real_name = coalesce(i.invitee_real_name, public.clean_member_label(v_auth_display_name, false)),
    invitee_display_name = coalesce(i.invitee_display_name, public.clean_member_label(v_auth_display_name, false)),
    invitee_mobile = coalesce(i.invitee_mobile, nullif(btrim(coalesce(v_auth_mobile, '')), ''))
  where i.invite_token = p_token
    and i.status in ('pending', 'accepted')
    and (
      coalesce(i.invited_email, '') = ''
      or lower(trim(i.invited_email)) = v_email
      or i.accepted_by_uid = v_uid
    )
  returning i.id, i.circle_ref, i.status, i.invitee_real_name, i.invitee_display_name, i.invitee_mobile
  into invitation_id, circle_ref, status, v_invitee_real_name, v_invitee_display_name, v_invitee_mobile;

  if invitation_id is null then
    raise exception 'invitation cannot be claimed';
  end if;

  insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
  values (
    v_uid,
    nullif(v_email, ''),
    public.clean_member_label(v_invitee_real_name, false),
    coalesce(
      public.clean_member_label(v_invitee_display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    nullif(btrim(coalesce(v_auth_photo_url, '')), ''),
    coalesce(
      nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
      nullif(btrim(coalesce(v_auth_mobile, '')), '')
    ),
    now()
  )
  on conflict (uid) do update
  set
    email = coalesce(nullif(public.users.email, ''), excluded.email),
    real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
    display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
    photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
    mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (circle_ref, v_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = 'active',
        role = case
          when public.circle_members.role = 'owner' then 'owner'
          else excluded.role
        end;

  return next;
end;
$$;

revoke execute on function public.claim_accepted_invitation(text, uuid, text) from public;
grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;

with resolved_invites as (
  select
    i.id,
    i.invite_token,
    i.circle_ref,
    lower(trim(coalesce(i.invited_email, ''))) as email,
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile,
    coalesce(i.accepted_by_uid, pu.uid, au.id) as uid,
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name') as auth_display_name,
    coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture') as auth_photo_url,
    au.phone as auth_mobile
  from public.invitations i
  left join lateral (
    select u.uid
    from public.users u
    where lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by u.created_time desc nulls last, u.uid
    limit 1
  ) pu on true
  left join lateral (
    select a.id, a.raw_user_meta_data, a.phone
    from auth.users a
    where lower(trim(coalesce(a.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by a.created_at desc nulls last, a.id
    limit 1
  ) au on true
  where i.status = 'accepted'
)
insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
select
  distinct on (r.uid)
  r.uid,
  nullif(r.email, ''),
  public.clean_member_label(r.invitee_real_name, false),
  coalesce(
    public.clean_member_label(r.invitee_display_name, false),
    public.clean_member_label(r.auth_display_name, false)
  ),
  nullif(btrim(coalesce(r.auth_photo_url, '')), ''),
  coalesce(
    nullif(btrim(coalesce(r.invitee_mobile, '')), ''),
    nullif(btrim(coalesce(r.auth_mobile, '')), '')
  ),
  now()
from resolved_invites r
where r.uid is not null
order by
  r.uid,
  case when r.invitee_display_name is not null or r.invitee_real_name is not null then 0 else 1 end,
  r.id desc
on conflict (uid) do update
set
  email = coalesce(nullif(public.users.email, ''), excluded.email),
  real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
  display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
  photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
  mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

with resolved_invites as (
  select
    i.circle_ref,
    coalesce(i.accepted_by_uid, pu.uid, au.id) as uid
  from public.invitations i
  left join lateral (
    select u.uid
    from public.users u
    where lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by u.created_time desc nulls last, u.uid
    limit 1
  ) pu on true
  left join lateral (
    select a.id
    from auth.users a
    where lower(trim(coalesce(a.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by a.created_at desc nulls last, a.id
    limit 1
  ) au on true
  where i.status = 'accepted'
)
insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
select distinct on (r.circle_ref, r.uid)
  r.circle_ref,
  r.uid,
  'member',
  'active',
  now()
from resolved_invites r
where r.uid is not null
order by r.circle_ref, r.uid
on conflict (circle_ref, user_id) do update
  set status = 'active',
      role = case
        when public.circle_members.role = 'owner' then 'owner'
        else excluded.role
      end;

with resolved_invites as (
  select
    i.id,
    coalesce(i.accepted_by_uid, pu.uid, au.id) as uid
  from public.invitations i
  left join lateral (
    select u.uid
    from public.users u
    where lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by u.created_time desc nulls last, u.uid
    limit 1
  ) pu on true
  left join lateral (
    select a.id
    from auth.users a
    where lower(trim(coalesce(a.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
    order by a.created_at desc nulls last, a.id
    limit 1
  ) au on true
  where i.status = 'accepted'
)
update public.invitations i
set accepted_by_uid = r.uid
from resolved_invites r
where i.id = r.id
  and r.uid is not null
  and i.accepted_by_uid is null;

create or replace function public.debug_invitation_membership(p_token text)
returns table(
  invitation_id uuid,
  invite_status text,
  circle_id uuid,
  invited_email text,
  accepted_by_uid uuid,
  matched_public_uid uuid,
  matched_auth_uid uuid,
  member_user_id uuid,
  diagnosis text
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select 1 as id
  ),
  invite as (
    select
      i.id,
      i.status,
      i.circle_ref,
      lower(trim(coalesce(i.invited_email, ''))) as email,
      i.accepted_by_uid
    from public.invitations i
    where i.invite_token = p_token
    limit 1
  ),
  public_match as (
    select u.uid
    from invite i
    join public.users u on lower(trim(coalesce(u.email, ''))) = i.email
    order by u.created_time desc nulls last, u.uid
    limit 1
  ),
  auth_match as (
    select au.id
    from invite i
    join auth.users au on lower(trim(coalesce(au.email, ''))) = i.email
    order by au.created_at desc nulls last, au.id
    limit 1
  ),
  resolved as (
    select
      i.*,
      pm.uid as public_uid,
      am.id as auth_uid,
      coalesce(i.accepted_by_uid, pm.uid, am.id) as resolved_uid
    from invite i
    left join public_match pm on true
    left join auth_match am on true
  )
  select
    r.id as invitation_id,
    r.status as invite_status,
    r.circle_ref as circle_id,
    r.email as invited_email,
    r.accepted_by_uid,
    r.public_uid as matched_public_uid,
    r.auth_uid as matched_auth_uid,
    cm.user_id as member_user_id,
    case
      when r.id is null then 'invitation not found'
      when r.status <> 'accepted' then 'invitation is not accepted'
      when r.resolved_uid is null then 'no auth/public user matched this invitation email yet; open the app and sign in with the invited email'
      when cm.user_id is null then 'user resolved but circle_members row is missing; run app claim with this token'
      else 'circle member exists'
    end as diagnosis
  from base b
  left join resolved r on true
  left join public.circle_members cm
    on cm.circle_ref = r.circle_ref
   and cm.user_id = r.resolved_uid;
$$;

revoke execute on function public.debug_invitation_membership(text) from public;
grant execute on function public.debug_invitation_membership(text) to authenticated;
