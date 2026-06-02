-- Recreate the circle/email uniqueness rule so it only applies to active pending invitations.
-- Some deployed DBs have uq_invitations_circle_email_pending as a broader unique constraint.

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'invitations'
      and c.conname = 'uq_invitations_circle_email_pending'
  ) then
    alter table public.invitations
      drop constraint uq_invitations_circle_email_pending;
  end if;
end;
$$;

drop index if exists public.uq_invitations_circle_email_pending;

with ranked as (
  select
    i.id,
    row_number() over (
      partition by i.circle_ref, lower(trim(i.invited_email))
      order by i.created_at desc, i.id desc
    ) as rn
  from public.invitations i
  where i.status = 'pending'
    and nullif(trim(coalesce(i.invited_email, '')), '') is not null
)
update public.invitations i
set
  status = 'cancelled',
  responded_at = coalesce(i.responded_at, now())
from ranked r
where i.id = r.id
  and r.rn > 1;

create unique index uq_invitations_circle_email_pending
  on public.invitations(circle_ref, lower(trim(invited_email)))
  where status = 'pending'
    and nullif(trim(coalesce(invited_email, '')), '') is not null;
