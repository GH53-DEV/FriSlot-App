-- Fix slots/events creation under RLS and make accepted invitations materialize members.

alter table if exists public.events
  add column if not exists budget_type text not null default 'per_person';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_budget_type_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_budget_type_check
      check (budget_type in ('per_person', 'total'));
  end if;
end;
$$;

create or replace function public.create_slot_with_visibility(
  p_slot_date date,
  p_time_block text,
  p_created_by uuid,
  p_source_circle_ref uuid,
  p_visible_circle_ids uuid[],
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_slot_id uuid;
  v_circle_id uuid;
  v_visible_circle_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_created_by is distinct from v_uid then
    raise exception 'p_created_by must match authenticated user';
  end if;

  select coalesce(array_agg(distinct circle_id), array[]::uuid[])
    into v_visible_circle_ids
  from unnest(coalesce(p_visible_circle_ids, array[]::uuid[])) as visible(circle_id)
  where circle_id is not null;

  if array_length(v_visible_circle_ids, 1) is null then
    raise exception 'visible circles required';
  end if;

  if p_source_circle_ref is not null and not public.is_active_circle_member(p_source_circle_ref, v_uid) then
    raise exception 'not an active member of source circle';
  end if;

  foreach v_circle_id in array v_visible_circle_ids loop
    if not public.is_active_circle_member(v_circle_id, v_uid) then
      raise exception 'not an active member of visible circle';
    end if;
  end loop;

  insert into public.slots(slot_date, time_block, created_by, source_circle_ref, note)
  values (
    p_slot_date,
    nullif(btrim(coalesce(p_time_block, '')), ''),
    v_uid,
    coalesce(p_source_circle_ref, v_visible_circle_ids[1]),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_slot_id;

  insert into public.slot_visibility_circles(slot_id, circle_ref)
  select v_slot_id, circle_id
  from unnest(v_visible_circle_ids) as visible(circle_id)
  on conflict (slot_id, circle_ref) do nothing;

  return v_slot_id;
end;
$$;

revoke execute on function public.create_slot_with_visibility(date, text, uuid, uuid, uuid[], text) from public;
grant execute on function public.create_slot_with_visibility(date, text, uuid, uuid, uuid[], text) to authenticated;

create or replace function public.create_event_with_participant(
  p_title text,
  p_event_date date,
  p_time_block text,
  p_circle_ref uuid,
  p_created_by uuid,
  p_max_people integer default null,
  p_budget_type text default 'per_person',
  p_budget_amount integer default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event_id uuid;
  v_budget_type text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_created_by is distinct from v_uid then
    raise exception 'p_created_by must match authenticated user';
  end if;
  if not public.is_active_circle_member(p_circle_ref, v_uid) then
    raise exception 'not an active member of circle';
  end if;

  v_budget_type := coalesce(nullif(btrim(p_budget_type), ''), 'per_person');
  if v_budget_type not in ('per_person', 'total') then
    raise exception 'invalid budget type';
  end if;

  insert into public.events(
    title,
    event_date,
    time_block,
    status,
    circle_ref,
    created_by,
    max_people,
    budget_type,
    budget_amount,
    description
  )
  values (
    nullif(btrim(coalesce(p_title, '')), ''),
    p_event_date,
    nullif(btrim(coalesce(p_time_block, '')), ''),
    'open',
    p_circle_ref,
    v_uid,
    p_max_people,
    v_budget_type,
    p_budget_amount,
    nullif(btrim(coalesce(p_description, '')), '')
  )
  returning id into v_event_id;

  insert into public.event_participants(event_id, user_id, status)
  values (v_event_id, v_uid, 'joined')
  on conflict (event_id, user_id) do update
    set status = excluded.status;

  return v_event_id;
end;
$$;

revoke execute on function public.create_event_with_participant(text, date, text, uuid, uuid, integer, text, integer, text) from public;
grant execute on function public.create_event_with_participant(text, date, text, uuid, uuid, integer, text, integer, text) to authenticated;

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
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name')
  into
    v_auth_email,
    v_auth_display_name
  from auth.users au
  where au.id = v_uid
  limit 1;

  if v_email = '' then
    v_email := coalesce(v_auth_email, '');
  end if;

  insert into public.users(uid, email, real_name, display_name, mobile, created_time)
  values (
    v_uid,
    nullif(v_email, ''),
    nullif(btrim(coalesce(v_invitee_real_name, '')), ''),
    coalesce(
      nullif(btrim(coalesce(v_invitee_display_name, '')), ''),
      nullif(btrim(coalesce(v_auth_display_name, '')), '')
    ),
    nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
    now()
  )
  on conflict (uid) do update
  set
    email = coalesce(excluded.email, public.users.email),
    real_name = coalesce(excluded.real_name, public.users.real_name),
    display_name = coalesce(excluded.display_name, public.users.display_name),
    mobile = coalesce(excluded.mobile, public.users.mobile);

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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_uid is distinct from v_uid then
    raise exception 'p_uid must match authenticated user';
  end if;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', p_email, '')));

  update public.invitations i
  set accepted_by_uid = v_uid
  where i.invite_token = p_token
    and i.status = 'accepted'
    and (
      i.accepted_by_uid is null
      or i.accepted_by_uid = v_uid
    )
    and (
      coalesce(i.invited_email, '') = ''
      or lower(trim(i.invited_email)) = v_email
      or i.accepted_by_uid = v_uid
    )
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  if invitation_id is null then
    raise exception 'Invitation must be accepted before claim';
  end if;

  perform public.sync_circle_member_for_invitation(p_token);

  return next;
end;
$$;

revoke execute on function public.claim_accepted_invitation(text, uuid, text) from public;
grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;

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
