-- When an invitation is accepted on web, add the invitee to circle_members if their account exists.

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
begin
  select
    i.circle_ref,
    lower(trim(coalesce(i.invited_email, ''))),
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into
    v_circle_ref,
    v_email,
    v_invitee_real_name,
    v_invitee_display_name,
    v_invitee_mobile
  from public.invitations i
  where i.invite_token = p_token
    and i.status = 'accepted'
  limit 1;

  if v_circle_ref is null or v_email = '' then
    return;
  end if;

  select u.uid
    into v_uid
  from public.users u
  where lower(trim(coalesce(u.email, ''))) = v_email
  limit 1;

  if v_uid is null then
    select au.id
      into v_uid
    from auth.users au
    where lower(trim(coalesce(au.email, ''))) = v_email
    limit 1;
  end if;

  if v_uid is null then
    return;
  end if;

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (v_circle_ref, v_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = excluded.status,
        role = excluded.role;

  insert into public.users(uid, email, real_name, display_name, mobile, created_time)
  values (
    v_uid,
    v_email,
    nullif(btrim(coalesce(v_invitee_real_name, '')), ''),
    nullif(btrim(coalesce(v_invitee_display_name, '')), ''),
    nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
    now()
  )
  on conflict (uid) do update
  set
    email = coalesce(excluded.email, public.users.email),
    real_name = coalesce(excluded.real_name, public.users.real_name),
    display_name = coalesce(excluded.display_name, public.users.display_name),
    mobile = coalesce(excluded.mobile, public.users.mobile);

  update public.invitations i
  set accepted_by_uid = v_uid
  where i.invite_token = p_token
    and i.status = 'accepted';
end;
$$;

revoke execute on function public.sync_circle_member_for_invitation(text) from public;
grant execute on function public.sync_circle_member_for_invitation(text) to anon, authenticated;

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
begin
  v_action := lower(trim(p_action));
  if v_action not in ('accept', 'reject') then
    raise exception 'p_action must be accept or reject';
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

-- Backfill: accepted invitations that never created circle_members rows.
do $$
declare
  r record;
begin
  for r in
    select i.invite_token
    from public.invitations i
    where i.status = 'accepted'
      and coalesce(i.invited_email, '') <> ''
  loop
    perform public.sync_circle_member_for_invitation(r.invite_token);
  end loop;
end;
$$;
