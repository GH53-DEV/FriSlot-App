-- Preserve existing users data during invitation accept and expose matched profile for invite forms.

create or replace function public.get_invitation_invitee_profile(
  p_token text,
  p_email text
)
returns table(
  email text,
  real_name text,
  display_name text,
  mobile text,
  has_user boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_status text;
  v_invited_email text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select i.status, lower(trim(coalesce(i.invited_email, '')))
    into v_status, v_invited_email
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_invited_email <> '' and v_invited_email <> v_email then
    raise exception 'email does not match invitation';
  end if;

  return query
  select
    v_email as email,
    coalesce(u.real_name, '') as real_name,
    coalesce(
      nullif(btrim(coalesce(u.display_name, '')), ''),
      nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''),
      ''
    ) as display_name,
    coalesce(u.mobile, '') as mobile,
    (u.uid is not null or au.id is not null) as has_user
  from (select 1) seed
  left join public.users u
    on lower(trim(coalesce(u.email, ''))) = v_email
  left join auth.users au
    on lower(trim(coalesce(au.email, ''))) = v_email
  order by case when u.uid is not null then 0 else 1 end
  limit 1;
end;
$$;

revoke execute on function public.get_invitation_invitee_profile(text, text) from public;
grant execute on function public.get_invitation_invitee_profile(text, text) to anon, authenticated;

create or replace function public.submit_invitation_invitee_details(
  p_token text,
  p_email text,
  p_real_name text default null,
  p_display_name text default null,
  p_mobile text default null
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
  v_email text;
  v_status text;
  v_invited_email text;
  v_user_real_name text;
  v_user_display_name text;
  v_user_mobile text;
  v_auth_display_name text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select i.status, lower(trim(coalesce(i.invited_email, '')))
    into v_status, v_invited_email
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'invitation already responded';
  end if;
  if v_invited_email <> '' and v_invited_email <> v_email then
    raise exception 'email does not match invitation';
  end if;

  select u.real_name, u.display_name, u.mobile
    into v_user_real_name, v_user_display_name, v_user_mobile
  from public.users u
  where lower(trim(coalesce(u.email, ''))) = v_email
  limit 1;

  select coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name')
    into v_auth_display_name
  from auth.users au
  where lower(trim(coalesce(au.email, ''))) = v_email
  limit 1;

  update public.invitations i
  set
    invited_email = v_email,
    invitee_real_name = coalesce(
      nullif(btrim(coalesce(v_user_real_name, '')), ''),
      nullif(btrim(coalesce(p_real_name, '')), '')
    ),
    invitee_display_name = coalesce(
      nullif(btrim(coalesce(v_user_display_name, '')), ''),
      nullif(btrim(coalesce(p_display_name, '')), ''),
      nullif(btrim(coalesce(v_auth_display_name, '')), '')
    ),
    invitee_mobile = coalesce(
      nullif(btrim(coalesce(v_user_mobile, '')), ''),
      nullif(btrim(coalesce(p_mobile, '')), '')
    )
  where i.invite_token = p_token
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  return next;
end;
$$;

revoke execute on function public.submit_invitation_invitee_details(text, text, text, text, text) from public;
grant execute on function public.submit_invitation_invitee_details(text, text, text, text, text) to anon, authenticated;

create or replace function public.sync_circle_member_for_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_ref uuid;
  v_email text;
  v_uid uuid;
  v_invitee_real_name text;
  v_invitee_display_name text;
  v_invitee_mobile text;
  v_auth_email text;
  v_auth_display_name text;
  v_auth_photo_url text;
  v_auth_mobile text;
begin
  select
    i.circle_ref,
    lower(trim(coalesce(i.invited_email, ''))),
    i.accepted_by_uid,
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into
    v_circle_ref,
    v_email,
    v_uid,
    v_invitee_real_name,
    v_invitee_display_name,
    v_invitee_mobile
  from public.invitations i
  where i.invite_token = p_token
    and i.status = 'accepted'
  limit 1;

  if v_circle_ref is null then
    return;
  end if;

  if v_uid is null and v_email <> '' then
    select u.uid
      into v_uid
    from public.users u
    where lower(trim(coalesce(u.email, ''))) = v_email
    limit 1;
  end if;

  if v_uid is null and v_email <> '' then
    select au.id
      into v_uid
    from auth.users au
    where lower(trim(coalesce(au.email, ''))) = v_email
    limit 1;
  end if;

  if v_uid is null then
    return;
  end if;

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

  insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
  values (
    v_uid,
    nullif(v_email, ''),
    nullif(btrim(coalesce(v_invitee_real_name, '')), ''),
    coalesce(
      nullif(btrim(coalesce(v_invitee_display_name, '')), ''),
      nullif(btrim(coalesce(v_auth_display_name, '')), '')
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
    real_name = coalesce(nullif(public.users.real_name, ''), excluded.real_name),
    display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name),
    photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
    mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (v_circle_ref, v_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = excluded.status,
        role = excluded.role;

  update public.invitations i
  set
    accepted_by_uid = v_uid,
    invited_email = coalesce(nullif(i.invited_email, ''), nullif(v_email, ''))
  where i.invite_token = p_token
    and i.status = 'accepted';
end;
$$;

revoke execute on function public.sync_circle_member_for_invitation(text) from public;
grant execute on function public.sync_circle_member_for_invitation(text) to anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select i.invite_token
    from public.invitations i
    where i.status = 'accepted'
  loop
    perform public.sync_circle_member_for_invitation(r.invite_token);
  end loop;
end;
$$;

insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
select distinct
  au.id,
  nullif(lower(trim(coalesce(au.email, ''))), ''),
  null,
  nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''),
  nullif(btrim(coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture', '')), ''),
  nullif(btrim(coalesce(au.phone, '')), ''),
  now()
from public.circle_members cm
join auth.users au on au.id = cm.user_id
left join public.users u on u.uid = cm.user_id
where cm.status = 'active'
  and u.uid is null
on conflict (uid) do update
set
  email = coalesce(nullif(public.users.email, ''), excluded.email),
  display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name),
  photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
  mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

update public.users u
set
  email = coalesce(nullif(u.email, ''), nullif(lower(trim(coalesce(au.email, ''))), '')),
  display_name = coalesce(
    nullif(u.display_name, ''),
    nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), '')
  ),
  photo_url = coalesce(
    nullif(u.photo_url, ''),
    nullif(btrim(coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture', '')), '')
  ),
  mobile = coalesce(nullif(u.mobile, ''), nullif(btrim(coalesce(au.phone, '')), ''))
from auth.users au
where u.uid = au.id
  and exists (
    select 1
    from public.circle_members cm
    where cm.user_id = u.uid
      and cm.status = 'active'
  );
