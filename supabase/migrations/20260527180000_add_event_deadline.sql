-- Add activity recruiting deadline ("向隅時間") to events.

alter table if exists public.events
  add column if not exists event_deadline date;

create index if not exists idx_events_event_deadline
  on public.events(event_deadline);

drop function if exists public.create_event_with_participant(
  text,
  date,
  text,
  uuid,
  uuid,
  integer,
  text,
  integer,
  text
);

create or replace function public.create_event_with_participant(
  p_title text,
  p_event_date date,
  p_time_block text,
  p_circle_ref uuid,
  p_created_by uuid,
  p_max_people integer default null,
  p_budget_type text default 'per_person',
  p_budget_amount integer default null,
  p_description text default null,
  p_event_deadline date default null
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
    description,
    event_deadline
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
    nullif(btrim(coalesce(p_description, '')), ''),
    p_event_deadline
  )
  returning id into v_event_id;

  insert into public.event_participants(event_id, user_id, status)
  values (v_event_id, v_uid, 'joined')
  on conflict (event_id, user_id) do update
    set status = excluded.status;

  return v_event_id;
end;
$$;

revoke execute on function public.create_event_with_participant(text, date, text, uuid, uuid, integer, text, integer, text, date) from public;
grant execute on function public.create_event_with_participant(text, date, text, uuid, uuid, integer, text, integer, text, date) to authenticated;
