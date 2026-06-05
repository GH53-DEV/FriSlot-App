-- Shared discussion messages for leisure slots and circle activities.

create extension if not exists pgcrypto;

create table if not exists public.discussion_messages (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  target_id uuid not null,
  sender_id uuid not null references public.users(uid) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint discussion_messages_scope_check check (scope in ('slot', 'event')),
  constraint discussion_messages_body_not_blank check (btrim(body) <> '')
);

create index if not exists idx_discussion_messages_target_created
  on public.discussion_messages(scope, target_id, created_at);
create index if not exists idx_discussion_messages_sender
  on public.discussion_messages(sender_id);

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
    when p_scope = 'slot' then public.can_access_slot(p_target_id, p_uid)
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

alter table public.discussion_messages enable row level security;

drop policy if exists "discussion_messages_select_accessible" on public.discussion_messages;
create policy "discussion_messages_select_accessible"
on public.discussion_messages
for select
to authenticated
using (public.can_access_discussion_message(scope, target_id));

drop policy if exists "discussion_messages_insert_accessible_self" on public.discussion_messages;
create policy "discussion_messages_insert_accessible_self"
on public.discussion_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.can_access_discussion_message(scope, target_id)
);

drop policy if exists "discussion_messages_update_own" on public.discussion_messages;
create policy "discussion_messages_update_own"
on public.discussion_messages
for update
to authenticated
using (sender_id = auth.uid())
with check (
  sender_id = auth.uid()
  and public.can_access_discussion_message(scope, target_id)
);

drop policy if exists "discussion_messages_delete_own" on public.discussion_messages;
create policy "discussion_messages_delete_own"
on public.discussion_messages
for delete
to authenticated
using (sender_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.discussion_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
