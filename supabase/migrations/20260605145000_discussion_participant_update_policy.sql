-- Allow a user to re-open an existing slot discussion participant row.
-- The app may upsert this row before sending a message.

drop policy if exists "discussion_participants_update_own_accessible" on public.discussion_participants;
create policy "discussion_participants_update_own_accessible"
on public.discussion_participants
for update
to authenticated
using (user_id = auth.uid())
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
