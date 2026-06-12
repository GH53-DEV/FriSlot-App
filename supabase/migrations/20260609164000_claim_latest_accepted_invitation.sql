-- Let the signed-in app recover an already-accepted invitation even when the deep-link token was lost.
create or replace function public.claim_latest_accepted_invitation(
  p_uid uuid,
  p_email text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text,
  email text,
  real_name text,
  display_name text,
  mobile text
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
    return;
  end if;

  select
    i.id,
    i.circle_ref,
    i.status,
    coalesce(nullif(lower(trim(i.invited_email)), ''), v_email),
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into
    invitation_id,
    circle_ref,
    status,
    email,
    real_name,
    display_name,
    mobile
  from public.invitations i
  where i.status = 'accepted'
    and (
      i.accepted_by_uid = v_uid
      or lower(trim(coalesce(i.invited_email, ''))) = v_email
    )
  order by i.responded_at desc nulls last, i.created_at desc nulls last, i.id desc
  limit 1;

  if invitation_id is null then
    return;
  end if;

  update public.invitations i
  set
    accepted_by_uid = v_uid,
    invited_email = coalesce(nullif(i.invited_email, ''), nullif(v_email, '')),
    invitee_real_name = coalesce(i.invitee_real_name, public.clean_member_label(real_name, false)),
    invitee_display_name = coalesce(
      i.invitee_display_name,
      public.clean_member_label(display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    invitee_mobile = coalesce(i.invitee_mobile, nullif(btrim(coalesce(mobile, v_auth_mobile, '')), ''))
  where i.id = invitation_id
  returning
    i.circle_ref,
    i.status,
    coalesce(nullif(lower(trim(i.invited_email)), ''), v_email),
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into circle_ref, status, email, real_name, display_name, mobile;

  insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
  values (
    v_uid,
    nullif(email, ''),
    public.clean_member_label(real_name, false),
    coalesce(
      public.clean_member_label(display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    nullif(btrim(coalesce(v_auth_photo_url, '')), ''),
    coalesce(
      nullif(btrim(coalesce(mobile, '')), ''),
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

revoke execute on function public.claim_latest_accepted_invitation(uuid, text) from public;
grant execute on function public.claim_latest_accepted_invitation(uuid, text) to authenticated;
