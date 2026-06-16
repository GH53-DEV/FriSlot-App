-- Circle member exit actions: self leave and owner member removal.

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.circle_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.circle_members drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.circle_members
  add constraint circle_members_status_check
  check (status in ('active', 'quit', 'removed'))
  not valid;

create or replace function public.leave_circle(
  p_circle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.circle_members cm
  set status = 'quit'
  where cm.circle_ref = p_circle_id
    and cm.user_id = v_uid
    and cm.status = 'active'
    and coalesce(cm.role, 'member') <> 'owner';

  if not found then
    raise exception 'active member not found or owner cannot leave this way';
  end if;
end;
$$;

revoke execute on function public.leave_circle(uuid) from public;
grant execute on function public.leave_circle(uuid) to authenticated;

create or replace function public.remove_circle_members(
  p_circle_id uuid,
  p_user_ids uuid[],
  p_scope text default 'circle'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, 'circle')));
  v_target_circle_ids uuid[];
  v_removed_count integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_scope not in ('circle', 'owner_circles') then
    raise exception 'invalid removal scope';
  end if;

  if coalesce(array_length(p_user_ids, 1), 0) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.owner_id = v_uid
  ) then
    raise exception 'only circle owner can remove members';
  end if;

  if v_scope = 'owner_circles' then
    select array_agg(c.id)
    into v_target_circle_ids
    from public.circles c
    where c.owner_id = v_uid;
  else
    v_target_circle_ids := array[p_circle_id];
  end if;

  update public.circle_members cm
  set status = 'removed'
  where cm.circle_ref = any(v_target_circle_ids)
    and cm.user_id = any(p_user_ids)
    and cm.user_id <> v_uid
    and cm.status = 'active'
    and coalesce(cm.role, 'member') <> 'owner';

  get diagnostics v_removed_count = row_count;

  update public.invitations i
  set status = 'cancelled'
  where i.circle_ref = any(v_target_circle_ids)
    and (
      i.accepted_by_uid = any(p_user_ids)
      or exists (
        select 1
        from public.users u
        where u.uid = any(p_user_ids)
          and lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(i.invited_email, '')))
      )
    )
    and i.status in ('pending', 'accepted', 'active');

  return v_removed_count;
end;
$$;

revoke execute on function public.remove_circle_members(uuid, uuid[], text) from public;
grant execute on function public.remove_circle_members(uuid, uuid[], text) to authenticated;

create or replace function public.remove_circle(
  p_circle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_event_ids uuid[];
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.owner_id = v_uid
  ) then
    raise exception 'only circle owner can remove circle';
  end if;

  select coalesce(array_agg(e.id), array[]::uuid[])
  into v_event_ids
  from public.events e
  where e.circle_ref = p_circle_id;

  if coalesce(array_length(v_event_ids, 1), 0) > 0 then
    delete from public.discussion_message_reads dmr
    where dmr.scope = 'event'
      and dmr.target_id = any(v_event_ids);

    delete from public.discussion_participants dp
    where dp.scope = 'event'
      and dp.target_id = any(v_event_ids);

    delete from public.discussion_messages dm
    where dm.scope = 'event'
      and dm.target_id = any(v_event_ids);
  end if;

  delete from public.event_participants ep
  where ep.event_id = any(v_event_ids);

  delete from public.events e
  where e.circle_ref = p_circle_id;

  delete from public.slot_bookings sb
  where sb.circle_ref = p_circle_id;

  delete from public.slot_visibility_circles svc
  where svc.circle_ref = p_circle_id;

  update public.slots s
  set source_circle_ref = null
  where s.source_circle_ref = p_circle_id;

  delete from public.invitations i
  where i.circle_ref = p_circle_id;

  delete from public.circle_members cm
  where cm.circle_ref = p_circle_id;

  delete from public.circles c
  where c.id = p_circle_id
    and c.owner_id = v_uid;
end;
$$;

revoke execute on function public.remove_circle(uuid) from public;
grant execute on function public.remove_circle(uuid) to authenticated;
