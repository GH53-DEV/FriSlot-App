-- Leisure-slot discussions are private between the slot owner and people who join that discussion.
-- Event discussions remain visible to active members of the event's circle.

create table if not exists public.discussion_participants (
  scope text not null,
  target_id uuid not null,
  user_id uuid not null references public.users(uid) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scope, target_id, user_id),
  constraint discussion_participants_scope_check check (scope in ('slot', 'event'))
);

create index if not exists idx_discussion_participants_user
  on public.discussion_participants(user_id, scope, target_id);

alter table public.discussion_participants enable row level security;

drop policy if exists "discussion_participants_select_own_or_slot_owner" on public.discussion_participants;
create policy "discussion_participants_select_own_or_slot_owner"
on public.discussion_participants
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    scope = 'slot'
    and public.user_owns_slot(target_id)
  )
);

drop policy if exists "discussion_participants_insert_self_accessible" on public.discussion_participants;
create policy "discussion_participants_insert_self_accessible"
on public.discussion_participants
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    (
      scope = 'slot'
      and public.can_access_slot(target_id)
    )
    or (
      scope = 'event'
      and exists (
        select 1
        from public.events e
        where e.id = target_id
          and public.is_active_circle_member(e.circle_ref)
      )
    )
  )
);

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
    when p_scope = 'slot' then
      public.user_owns_slot(p_target_id, p_uid)
      or exists (
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

insert into public.discussion_participants(scope, target_id, user_id)
select distinct dm.scope, dm.target_id, dm.sender_id
from public.discussion_messages dm
where dm.scope = 'slot'
on conflict (scope, target_id, user_id) do nothing;
