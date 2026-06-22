-- Prevent duplicate active leisure slots for the same owner/date/time block.
-- One user may only have one non-cancelled slot per (slot_date, time_block).

create temp table tmp_slot_dedupe_losers (
  loser_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into tmp_slot_dedupe_losers (loser_id, keeper_id)
with active_slots as (
  select
    s.id,
    s.created_by,
    s.slot_date,
    btrim(s.time_block) as time_block_norm,
    s.created_at,
    (
      select count(*)
      from public.slot_bookings sb
      where sb.slot_id = s.id
        and sb.status in ('requested', 'accepted')
    ) as active_booking_count
  from public.slots s
  where s.status <> 'cancelled'
),
ranked as (
  select
    id,
    row_number() over (
      partition by created_by, slot_date, time_block_norm
      order by active_booking_count desc, created_at asc, id asc
    ) as rn,
    first_value(id) over (
      partition by created_by, slot_date, time_block_norm
      order by active_booking_count desc, created_at asc, id asc
    ) as keeper_id
  from active_slots
)
select id as loser_id, keeper_id
from ranked
where rn > 1;

insert into public.slot_visibility_circles (slot_id, circle_ref)
select l.keeper_id, svc.circle_ref
from tmp_slot_dedupe_losers l
join public.slot_visibility_circles svc on svc.slot_id = l.loser_id
on conflict (slot_id, circle_ref) do nothing;

update public.slot_bookings sb
set slot_id = l.keeper_id
from tmp_slot_dedupe_losers l
where sb.slot_id = l.loser_id
  and not exists (
    select 1
    from public.slot_bookings existing
    where existing.slot_id = l.keeper_id
      and existing.requested_by = sb.requested_by
      and existing.status in ('requested', 'accepted')
      and sb.status in ('requested', 'accepted')
  );

update public.slot_bookings sb
set status = 'cancelled'
from tmp_slot_dedupe_losers l
where sb.slot_id = l.loser_id
  and sb.status in ('requested', 'accepted');

delete from public.slots s
using tmp_slot_dedupe_losers l
where s.id = l.loser_id;

drop index if exists public.uq_slots_owner_date_time_active;

create unique index uq_slots_owner_date_time_active
  on public.slots (created_by, slot_date, btrim(time_block))
  where status <> 'cancelled';

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
  v_time_block text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_created_by is distinct from v_uid then
    raise exception 'p_created_by must match authenticated user';
  end if;

  v_time_block := nullif(btrim(coalesce(p_time_block, '')), '');
  if v_time_block is null then
    raise exception 'time block required';
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

  if exists (
    select 1
    from public.slots s
    where s.created_by = v_uid
      and s.slot_date = p_slot_date
      and btrim(s.time_block) = v_time_block
      and s.status <> 'cancelled'
  ) then
    raise exception 'duplicate active slot for same date and time block';
  end if;

  insert into public.slots(slot_date, time_block, created_by, source_circle_ref, note)
  values (
    p_slot_date,
    v_time_block,
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
