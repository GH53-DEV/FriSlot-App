-- Slot private chats can use synthetic target IDs for 1:1/group conversations.
-- Access is granted through discussion_participants, not by the target_id being the slot id.
create or replace function public.ensure_slot_discussion_participants(
  p_slot_id uuid,
  p_target_id uuid,
  p_participant_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_participant_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if not public.can_access_slot(p_slot_id, v_uid) then
    raise exception 'not allowed to access slot';
  end if;
  if not v_uid = any(p_participant_ids) then
    raise exception 'caller must be a participant';
  end if;

  foreach v_participant_id in array p_participant_ids loop
    if not exists (
      select 1
      from public.slots s
      where s.id = p_slot_id
        and s.created_by = v_participant_id
    )
    and not exists (
      select 1
      from public.slot_bookings sb
      where sb.slot_id = p_slot_id
        and sb.requested_by = v_participant_id
        and sb.status in ('requested', 'accepted')
    ) then
      raise exception 'participant is not related to this booking';
    end if;

    insert into public.discussion_participants(scope, target_id, user_id)
    values ('slot', p_target_id, v_participant_id)
    on conflict (scope, target_id, user_id) do nothing;
  end loop;
end;
$$;

revoke execute on function public.ensure_slot_discussion_participants(uuid, uuid, uuid[]) from public;
grant execute on function public.ensure_slot_discussion_participants(uuid, uuid, uuid[]) to authenticated;

create or replace function public.can_access_discussion_message(
  p_scope text,
  p_target_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when p_scope = 'slot' then exists (
      select 1
      from public.discussion_participants dp
      where dp.scope = 'slot'
        and dp.target_id = p_target_id
        and dp.user_id = p_uid
    )
    when p_scope = 'event' then exists (
      select 1
      from public.events e
      where e.id = p_target_id
        and public.is_active_circle_member(e.circle_ref, p_uid)
    )
    else false
  end;
$$;

revoke execute on function public.can_access_discussion_message(text, uuid, uuid) from public;
grant execute on function public.can_access_discussion_message(text, uuid, uuid) to authenticated;
