-- Slots and Events: independent booking slots plus circle activities.

create extension if not exists pgcrypto;

create or replace function public.is_active_circle_member(
  p_circle_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.owner_id = p_uid
  )
  or exists (
    select 1
    from public.circle_members cm
    where cm.circle_ref = p_circle_id
      and cm.user_id = p_uid
      and cm.status = 'active'
  );
$$;

revoke execute on function public.is_active_circle_member(uuid, uuid) from public;
grant execute on function public.is_active_circle_member(uuid, uuid) to authenticated;

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  time_block text not null,
  created_by uuid not null references public.users(uid) on delete cascade,
  source_circle_ref uuid references public.circles(id) on delete set null,
  status text not null default 'open',
  note text,
  created_at timestamptz not null default now(),
  constraint slots_status_check check (status in ('open', 'booked', 'cancelled')),
  constraint slots_time_block_not_blank check (btrim(time_block) <> '')
);

create table if not exists public.slot_visibility_circles (
  slot_id uuid not null references public.slots(id) on delete cascade,
  circle_ref uuid not null references public.circles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot_id, circle_ref)
);

create table if not exists public.slot_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  circle_ref uuid not null references public.circles(id) on delete cascade,
  requested_by uuid not null references public.users(uid) on delete cascade,
  status text not null default 'requested',
  message text,
  created_at timestamptz not null default now(),
  constraint slot_bookings_status_check check (status in ('requested', 'accepted', 'declined', 'cancelled'))
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  time_block text not null,
  status text not null default 'open',
  circle_ref uuid not null references public.circles(id) on delete cascade,
  created_by uuid not null references public.users(uid) on delete cascade,
  max_people integer,
  budget_amount integer,
  description text,
  created_at timestamptz not null default now(),
  constraint events_status_check check (status in ('open', 'full', 'cancelled', 'completed')),
  constraint events_title_not_blank check (btrim(title) <> ''),
  constraint events_time_block_not_blank check (btrim(time_block) <> ''),
  constraint events_max_people_positive check (max_people is null or max_people > 0),
  constraint events_budget_amount_non_negative check (budget_amount is null or budget_amount >= 0)
);

create table if not exists public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(uid) on delete cascade,
  status text not null default 'joined',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  constraint event_participants_status_check check (status in ('joined', 'interested', 'cancelled'))
);

create index if not exists idx_slots_created_by_date
  on public.slots(created_by, slot_date);
create index if not exists idx_slots_source_circle_ref
  on public.slots(source_circle_ref);
create index if not exists idx_slot_visibility_circle_ref
  on public.slot_visibility_circles(circle_ref);
create index if not exists idx_slot_bookings_slot_id
  on public.slot_bookings(slot_id);
create index if not exists idx_slot_bookings_requested_by
  on public.slot_bookings(requested_by);
create unique index if not exists idx_slot_bookings_one_active_request
  on public.slot_bookings(slot_id, requested_by)
  where status in ('requested', 'accepted');
create index if not exists idx_events_circle_ref_date
  on public.events(circle_ref, event_date);
create index if not exists idx_events_created_by
  on public.events(created_by);
create index if not exists idx_event_participants_user_id
  on public.event_participants(user_id);

create or replace function public.user_owns_slot(
  p_slot_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.slots s
    where s.id = p_slot_id
      and s.created_by = p_uid
  );
$$;

create or replace function public.slot_is_visible_to_circle(
  p_slot_id uuid,
  p_circle_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.slot_visibility_circles svc
    where svc.slot_id = p_slot_id
      and svc.circle_ref = p_circle_id
  );
$$;

create or replace function public.can_access_slot(
  p_slot_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_owns_slot(p_slot_id, p_uid)
  or exists (
    select 1
    from public.slot_visibility_circles svc
    where svc.slot_id = p_slot_id
      and public.is_active_circle_member(svc.circle_ref, p_uid)
  );
$$;

revoke execute on function public.user_owns_slot(uuid, uuid) from public;
revoke execute on function public.slot_is_visible_to_circle(uuid, uuid) from public;
revoke execute on function public.can_access_slot(uuid, uuid) from public;
grant execute on function public.user_owns_slot(uuid, uuid) to authenticated;
grant execute on function public.slot_is_visible_to_circle(uuid, uuid) to authenticated;
grant execute on function public.can_access_slot(uuid, uuid) to authenticated;

alter table public.slots enable row level security;
alter table public.slot_visibility_circles enable row level security;
alter table public.slot_bookings enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;

drop policy if exists "slots_select_visible_or_owned" on public.slots;
create policy "slots_select_visible_or_owned"
on public.slots
for select
to authenticated
using (public.can_access_slot(id));

drop policy if exists "slots_insert_self" on public.slots;
create policy "slots_insert_self"
on public.slots
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    source_circle_ref is null
    or public.is_active_circle_member(source_circle_ref)
  )
);

drop policy if exists "slots_update_owned" on public.slots;
create policy "slots_update_owned"
on public.slots
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "slots_delete_owned" on public.slots;
create policy "slots_delete_owned"
on public.slots
for delete
to authenticated
using (created_by = auth.uid());

drop policy if exists "slot_visibility_select_member_or_owner" on public.slot_visibility_circles;
create policy "slot_visibility_select_member_or_owner"
on public.slot_visibility_circles
for select
to authenticated
using (
  public.is_active_circle_member(circle_ref)
  or public.user_owns_slot(slot_id)
);

drop policy if exists "slot_visibility_insert_slot_owner_member" on public.slot_visibility_circles;
create policy "slot_visibility_insert_slot_owner_member"
on public.slot_visibility_circles
for insert
to authenticated
with check (
  public.is_active_circle_member(circle_ref)
  and public.user_owns_slot(slot_id)
);

drop policy if exists "slot_visibility_delete_slot_owner" on public.slot_visibility_circles;
create policy "slot_visibility_delete_slot_owner"
on public.slot_visibility_circles
for delete
to authenticated
using (
  public.user_owns_slot(slot_id)
);

drop policy if exists "slot_bookings_select_related" on public.slot_bookings;
create policy "slot_bookings_select_related"
on public.slot_bookings
for select
to authenticated
using (
  requested_by = auth.uid()
  or public.is_active_circle_member(circle_ref)
  or public.user_owns_slot(slot_id)
);

drop policy if exists "slot_bookings_insert_visible_member" on public.slot_bookings;
create policy "slot_bookings_insert_visible_member"
on public.slot_bookings
for insert
to authenticated
with check (
  requested_by = auth.uid()
  and public.is_active_circle_member(circle_ref)
  and public.slot_is_visible_to_circle(slot_id, circle_ref)
);

drop policy if exists "slot_bookings_update_requester_or_slot_owner" on public.slot_bookings;
create policy "slot_bookings_update_requester_or_slot_owner"
on public.slot_bookings
for update
to authenticated
using (
  requested_by = auth.uid()
  or public.user_owns_slot(slot_id)
)
with check (
  requested_by = auth.uid()
  or public.user_owns_slot(slot_id)
);

drop policy if exists "events_select_circle_members" on public.events;
create policy "events_select_circle_members"
on public.events
for select
to authenticated
using (public.is_active_circle_member(circle_ref));

drop policy if exists "events_insert_circle_members" on public.events;
create policy "events_insert_circle_members"
on public.events
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.is_active_circle_member(circle_ref)
);

drop policy if exists "events_update_creator_or_circle_owner" on public.events;
create policy "events_update_creator_or_circle_owner"
on public.events
for update
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.circles c
    where c.id = events.circle_ref
      and c.owner_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1
    from public.circles c
    where c.id = events.circle_ref
      and c.owner_id = auth.uid()
  )
);

drop policy if exists "events_delete_creator_or_circle_owner" on public.events;
create policy "events_delete_creator_or_circle_owner"
on public.events
for delete
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.circles c
    where c.id = events.circle_ref
      and c.owner_id = auth.uid()
  )
);

drop policy if exists "event_participants_select_circle_members" on public.event_participants;
create policy "event_participants_select_circle_members"
on public.event_participants
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_participants.event_id
      and public.is_active_circle_member(e.circle_ref)
  )
);

drop policy if exists "event_participants_insert_self_circle_member" on public.event_participants;
create policy "event_participants_insert_self_circle_member"
on public.event_participants
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.events e
    where e.id = event_participants.event_id
      and public.is_active_circle_member(e.circle_ref)
  )
);

drop policy if exists "event_participants_update_self_or_event_creator" on public.event_participants;
create policy "event_participants_update_self_or_event_creator"
on public.event_participants
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.events e
    where e.id = event_participants.event_id
      and e.created_by = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.events e
    where e.id = event_participants.event_id
      and e.created_by = auth.uid()
  )
);

drop policy if exists "event_participants_delete_self_or_event_creator" on public.event_participants;
create policy "event_participants_delete_self_or_event_creator"
on public.event_participants
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.events e
    where e.id = event_participants.event_id
      and e.created_by = auth.uid()
  )
);
