-- Allow share invitations to be accepted when the same circle/email already has an older pending invite.

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
  v_circle_ref uuid;
  v_invitation_id uuid;
  v_user_real_name text;
  v_user_display_name text;
  v_user_mobile text;
  v_auth_display_name text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select i.id, i.status, lower(trim(coalesce(i.invited_email, ''))), i.circle_ref
    into v_invitation_id, v_status, v_invited_email, v_circle_ref
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

  update public.invitations i
  set
    status = 'cancelled',
    responded_at = coalesce(i.responded_at, now())
  where i.circle_ref = v_circle_ref
    and i.id <> v_invitation_id
    and i.status = 'pending'
    and lower(trim(coalesce(i.invited_email, ''))) = v_email;

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
      public.clean_member_label(v_user_real_name, false),
      public.clean_member_label(p_real_name, false)
    ),
    invitee_display_name = coalesce(
      public.clean_member_label(v_user_display_name, false),
      public.clean_member_label(p_display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    invitee_mobile = coalesce(
      nullif(btrim(coalesce(v_user_mobile, '')), ''),
      nullif(btrim(coalesce(p_mobile, '')), '')
    )
  where i.id = v_invitation_id
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  return next;
end;
$$;

revoke execute on function public.submit_invitation_invitee_details(text, text, text, text, text) from public;
grant execute on function public.submit_invitation_invitee_details(text, text, text, text, text) to anon, authenticated;

create or replace function public.respond_invitation(
  p_token text,
  p_action text
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
  v_action text;
  v_invitation_id uuid;
  v_circle_ref uuid;
  v_email text;
begin
  v_action := lower(trim(p_action));
  if v_action not in ('accept', 'reject') then
    raise exception 'p_action must be accept or reject';
  end if;

  select i.id, i.circle_ref, lower(trim(coalesce(i.invited_email, '')))
    into v_invitation_id, v_circle_ref, v_email
  from public.invitations i
  where i.invite_token = p_token
    and i.status = 'pending'
  limit 1;

  if v_action = 'accept' and v_invitation_id is not null and v_email <> '' then
    update public.invitations i
    set
      status = 'cancelled',
      responded_at = coalesce(i.responded_at, now())
    where i.circle_ref = v_circle_ref
      and i.id <> v_invitation_id
      and i.status = 'pending'
      and lower(trim(coalesce(i.invited_email, ''))) = v_email;
  end if;

  update public.invitations i
  set
    status = case when v_action = 'accept' then 'accepted' else 'rejected' end,
    responded_at = now(),
    accepted_by_uid = case
      when v_action = 'accept' and auth.uid() is not null then auth.uid()
      else i.accepted_by_uid
    end
  where i.invite_token = p_token
    and i.status = 'pending';

  if v_action = 'accept' then
    perform public.sync_circle_member_for_invitation(p_token);
  end if;

  return query
  select i.id, i.circle_ref, i.status
  from public.invitations i
  where i.invite_token = p_token
  limit 1;
end;
$$;

revoke execute on function public.respond_invitation(text, text) from public;
grant execute on function public.respond_invitation(text, text) to anon, authenticated;
