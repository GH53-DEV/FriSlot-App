-- Per-user read state for slot/event discussion unread badges.

create table if not exists public.discussion_message_reads (
  scope text not null,
  target_id uuid not null,
  user_id uuid not null references public.users(uid) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, target_id, user_id),
  constraint discussion_message_reads_scope_check check (scope in ('slot', 'event'))
);

create index if not exists idx_discussion_message_reads_user_target
  on public.discussion_message_reads(user_id, scope, target_id);

alter table public.discussion_message_reads enable row level security;

drop policy if exists "discussion_message_reads_select_own" on public.discussion_message_reads;
create policy "discussion_message_reads_select_own"
on public.discussion_message_reads
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "discussion_message_reads_insert_own_accessible" on public.discussion_message_reads;
create policy "discussion_message_reads_insert_own_accessible"
on public.discussion_message_reads
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_discussion_message(scope, target_id)
);

drop policy if exists "discussion_message_reads_update_own_accessible" on public.discussion_message_reads;
create policy "discussion_message_reads_update_own_accessible"
on public.discussion_message_reads
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.can_access_discussion_message(scope, target_id)
);

drop policy if exists "discussion_message_reads_delete_own" on public.discussion_message_reads;
create policy "discussion_message_reads_delete_own"
on public.discussion_message_reads
for delete
to authenticated
using (user_id = auth.uid());
