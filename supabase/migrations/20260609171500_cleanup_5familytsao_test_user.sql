-- One-time test cleanup for first-entry invitation testing.
-- Target only: 5familytsao@gmail.com
do $$
declare
  v_email text := '5familytsao@gmail.com';
  v_uids uuid[];
begin
  select coalesce(array_agg(distinct uid), array[]::uuid[])
    into v_uids
  from (
    select u.uid
    from public.users u
    where lower(trim(coalesce(u.email, ''))) = v_email

    union

    select au.id as uid
    from auth.users au
    where lower(trim(coalesce(au.email, ''))) = v_email

    union

    select i.accepted_by_uid as uid
    from public.invitations i
    where lower(trim(coalesce(i.invited_email, ''))) = v_email
      and i.accepted_by_uid is not null
  ) target;

  delete from public.discussion_participants dp
  where dp.user_id = any(v_uids);

  delete from public.discussion_message_reads dmr
  where dmr.user_id = any(v_uids);

  delete from public.discussion_messages dm
  where dm.sender_id = any(v_uids);

  delete from public.event_participants ep
  where ep.user_id = any(v_uids);

  delete from public.slot_bookings sb
  where sb.requested_by = any(v_uids);

  delete from public.slots s
  where s.created_by = any(v_uids);

  delete from public.events e
  where e.created_by = any(v_uids);

  delete from public.circle_members cm
  where cm.user_id = any(v_uids);

  delete from public.invitations i
  where lower(trim(coalesce(i.invited_email, ''))) = v_email
     or i.accepted_by_uid = any(v_uids);

  delete from public.circles c
  where c.owner_id = any(v_uids);

  delete from public.users u
  where u.uid = any(v_uids)
     or lower(trim(coalesce(u.email, ''))) = v_email;

  delete from auth.users au
  where au.id = any(v_uids)
     or lower(trim(coalesce(au.email, ''))) = v_email;

  raise notice 'cleanup complete for %, uid count=%', v_email, coalesce(array_length(v_uids, 1), 0);
end;
$$;
