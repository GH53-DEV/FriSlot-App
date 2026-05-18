-- Store timestamps in timestamptz (UTC); default to server now(); add Taipei 24h views for SQL Editor.

alter table if exists public.users
  alter column created_time set default now();

alter table if exists public.circles
  alter column created_at set default now();

alter table if exists public.circle_members
  alter column joined_at set default now();

alter table if exists public.invitations
  alter column created_at set default now();

-- Readable local time in Supabase Table Editor / SQL queries (Asia/Taipei, 24-hour clock).
create or replace view public.v_users_local as
select
  u.uid,
  u.email,
  u.real_name,
  u.display_name,
  u.mobile,
  u.created_time as created_time_utc,
  timezone('Asia/Taipei', u.created_time) as created_time_tw,
  to_char(timezone('Asia/Taipei', u.created_time), 'YYYY-MM-DD HH24:MI:SS') as created_time_tw_24h
from public.users u;

create or replace view public.v_circles_local as
select
  c.id,
  c.circle_name,
  c.owner_id,
  c.created_at as created_at_utc,
  timezone('Asia/Taipei', c.created_at) as created_at_tw,
  to_char(timezone('Asia/Taipei', c.created_at), 'YYYY-MM-DD HH24:MI:SS') as created_at_tw_24h
from public.circles c;

create or replace view public.v_circle_members_local as
select
  m.id,
  m.circle_ref,
  m.user_id,
  m.role,
  m.status,
  m.joined_at as joined_at_utc,
  timezone('Asia/Taipei', m.joined_at) as joined_at_tw,
  to_char(timezone('Asia/Taipei', m.joined_at), 'YYYY-MM-DD HH24:MI:SS') as joined_at_tw_24h
from public.circle_members m;

create or replace view public.v_invitations_local as
select
  i.id,
  i.circle_ref,
  i.invited_email,
  i.status,
  i.created_at as created_at_utc,
  timezone('Asia/Taipei', i.created_at) as created_at_tw,
  to_char(timezone('Asia/Taipei', i.created_at), 'YYYY-MM-DD HH24:MI:SS') as created_at_tw_24h,
  i.responded_at as responded_at_utc,
  timezone('Asia/Taipei', i.responded_at) as responded_at_tw,
  to_char(timezone('Asia/Taipei', i.responded_at), 'YYYY-MM-DD HH24:MI:SS') as responded_at_tw_24h
from public.invitations i;

grant select on public.v_users_local to authenticated, service_role;
grant select on public.v_circles_local to authenticated, service_role;
grant select on public.v_circle_members_local to authenticated, service_role;
grant select on public.v_invitations_local to authenticated, service_role;
