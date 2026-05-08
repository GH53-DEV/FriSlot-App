-- Invitations phase 2: tokenized links + response lifecycle + claim flow

alter table if exists public.invitations
  add column if not exists invite_token text,
  add column if not exists responded_at timestamptz,
  add column if not exists accepted_by_uid uuid references auth.users(id);

create unique index if not exists idx_invitations_invite_token_unique
  on public.invitations(invite_token)
  where invite_token is not null;

create or replace function public.create_invitation_links(
  p_circle_id uuid,
  p_emails text[],
  p_base_url text
)
returns table(
  invitation_id uuid,
  invited_email text,
  invite_token text,
  invite_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_token text;
  v_invitation_id uuid;
  v_clean_base_url text;
begin
  select trim(both '/' from coalesce(p_base_url, '')) into v_clean_base_url;
  if v_clean_base_url = '' then
    raise exception 'p_base_url is required';
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.owner_id = auth.uid()
  ) then
    raise exception 'Only circle owner can create invitation links';
  end if;

  foreach v_email in array p_emails loop
    v_email := lower(trim(v_email));
    if v_email = '' then
      continue;
    end if;

    v_token := md5(random()::text || clock_timestamp()::text || v_email || auth.uid()::text);

    insert into public.invitations(
      circle_ref,
      invited_email,
      status,
      created_at,
      invited_by,
      invite_token
    )
    values (
      p_circle_id,
      v_email,
      'pending',
      now(),
      auth.uid(),
      v_token
    )
    returning id into v_invitation_id;

    invitation_id := v_invitation_id;
    invited_email := v_email;
    invite_token := v_token;
    invite_url := v_clean_base_url || '?token=' || v_token;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.create_invitation_links(uuid, text[], text) to authenticated;

create or replace function public.get_invitation_by_token(
  p_token text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  circle_name text,
  invited_email text,
  status text,
  invited_by uuid
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
    i.invited_by
  from public.invitations i
  join public.circles c on c.id = i.circle_ref
  where i.invite_token = p_token
  limit 1;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

create or replace function public.respond_invitation(
  p_token text,
  p_action text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  v_action := lower(trim(p_action));
  if v_action not in ('accept', 'reject') then
    raise exception 'p_action must be accept or reject';
  end if;

  update public.invitations i
  set
    status = case when v_action = 'accept' then 'accepted' else 'rejected' end,
    responded_at = now(),
    accepted_by_uid = case
      when v_action = 'accept' and auth.uid() is not null then auth.uid()
      else i.accepted_by_uid
    end
  where i.invite_token = p_token
    and i.status = 'pending';

  return query
  select i.id, i.circle_ref, i.status
  from public.invitations i
  where i.invite_token = p_token
  limit 1;
end;
$$;

grant execute on function public.respond_invitation(text, text) to anon, authenticated;

create or replace function public.claim_accepted_invitation(
  p_token text,
  p_uid uuid,
  p_email text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required to claim invitation';
  end if;

  update public.invitations i
  set
    accepted_by_uid = p_uid
  where i.invite_token = p_token
    and i.status = 'accepted'
    and lower(i.invited_email) = v_email
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  if invitation_id is null then
    raise exception 'Invitation must be accepted before claim';
  end if;

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (circle_ref, p_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = excluded.status;

  return next;
end;
$$;

grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;
