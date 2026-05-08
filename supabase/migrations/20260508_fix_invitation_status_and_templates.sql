-- Fix invitation status transition constraint and add admin-editable email templates.

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'invitations'
      and c.conname = 'invitations_status_check'
  ) then
    alter table public.invitations
      drop constraint invitations_status_check;
  end if;
end
$$;

alter table public.invitations
  add constraint invitations_status_check
  check (status in ('pending', 'accepted', 'rejected', 'declined', 'expired', 'cancelled', 'active'));

create table if not exists public.app_runtime_settings (
  key text primary key,
  value_text text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_runtime_settings enable row level security;

revoke all on table public.app_runtime_settings from anon, authenticated;

insert into public.app_runtime_settings(key, value_text)
values
  ('invitation_email_subject', 'FriSlot 邀請你加入 {{circle_name}}'),
  ('invitation_email_body', '嗨，\n\n{{owner_email}} 邀請你加入 FriSlot 密友圈：{{circle_name}}\n請點擊連結：{{invite_url}}\n')
on conflict (key) do nothing;

create or replace function public.get_invitation_email_templates()
returns table(
  subject_template text,
  body_template text
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(
      (select value_text from public.app_runtime_settings where key = 'invitation_email_subject'),
      'FriSlot 邀請你加入 {{circle_name}}'
    ) as subject_template,
    coalesce(
      (select value_text from public.app_runtime_settings where key = 'invitation_email_body'),
      '嗨，\n\n{{owner_email}} 邀請你加入 FriSlot 密友圈：{{circle_name}}\n請點擊連結：{{invite_url}}\n'
    ) as body_template;
$$;

grant execute on function public.get_invitation_email_templates() to authenticated;

create or replace function public.update_invitation_email_templates(
  p_subject_template text,
  p_body_template text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(auth.jwt() ->> 'role', '');
  if v_role <> 'service_role' then
    raise exception 'service_role required';
  end if;

  update public.app_runtime_settings
  set value_text = coalesce(nullif(trim(p_subject_template), ''), value_text),
      updated_at = now()
  where key = 'invitation_email_subject';

  update public.app_runtime_settings
  set value_text = coalesce(nullif(trim(p_body_template), ''), value_text),
      updated_at = now()
  where key = 'invitation_email_body';
end;
$$;

revoke execute on function public.update_invitation_email_templates(text, text) from public;
grant execute on function public.update_invitation_email_templates(text, text) to service_role;

drop function if exists public.get_invitation_by_token(text);

create or replace function public.get_invitation_by_token(
  p_token text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  circle_name text,
  invited_email text,
  status text,
  invited_by uuid,
  inviter_name text,
  inviter_email text
)
language sql
security definer
set search_path = public
as $$
  select
    i.id as invitation_id,
    i.circle_ref,
    c.circle_name,
    i.invited_email,
    i.status,
    i.invited_by,
    coalesce(u.display_name, u.email, '好友') as inviter_name,
    u.email as inviter_email
  from public.invitations i
  join public.circles c on c.id = i.circle_ref
  left join public.users u on u.uid = i.invited_by
  where i.invite_token = p_token
  limit 1;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
