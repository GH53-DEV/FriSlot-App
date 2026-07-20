-- LINE / share invitations must stay reusable (pending) for every invitee.
-- Accept/claim forks a personal accepted invitation and writes circle_members,
-- without flipping the shared token to a terminal "accepted" status.
-- Also repairs orphaned accepted invites that never got a membership row.

alter table public.invitations
  add column if not exists is_share_link boolean not null default false;

comment on column public.invitations.is_share_link is
  'True for reusable LINE/social share tokens. These stay pending; acceptors get a forked personal invitation.';

-- Open share links still have null email.
update public.invitations
set is_share_link = true
where invited_email is null
  and status = 'pending';

-- Orphaned accepts: status accepted but matching member never joined.
-- Prefer reopening to pending; if that would violate circle/email uniqueness, cancel instead.
with orphans as (
  select i.id, i.circle_ref, lower(trim(i.invited_email)) as email_key
  from public.invitations i
  where i.status = 'accepted'
    and i.accepted_by_uid is null
    and nullif(lower(trim(coalesce(i.invited_email, ''))), '') is not null
    and not exists (
      select 1
      from public.circle_members cm
      join public.users u on u.uid = cm.user_id
      where cm.circle_ref = i.circle_ref
        and cm.status = 'active'
        and lower(trim(coalesce(u.email, ''))) = lower(trim(i.invited_email))
    )
),
conflicted as (
  select o.id
  from orphans o
  where exists (
    select 1
    from public.invitations p
    where p.circle_ref = o.circle_ref
      and p.status = 'pending'
      and lower(trim(coalesce(p.invited_email, ''))) = o.email_key
      and p.id <> o.id
  )
)
update public.invitations i
set
  status = case when c.id is not null then 'cancelled' else 'pending' end,
  responded_at = case when c.id is not null then coalesce(i.responded_at, now()) else null end,
  accepted_by_uid = null
from orphans o
left join conflicted c on c.id = o.id
where i.id = o.id;

-- Share-link rows may temporarily hold an invitee email before fork; exclude them from
-- the pending circle/email uniqueness rule so Accept does not collide with email invites.
drop index if exists public.uq_invitations_circle_email_pending;
create unique index uq_invitations_circle_email_pending
  on public.invitations(circle_ref, lower(trim(invited_email)))
  where status = 'pending'
    and coalesce(is_share_link, false) = false
    and nullif(trim(coalesce(invited_email, '')), '') is not null;

create or replace function public.create_share_invitation(
  p_circle_id uuid,
  p_base_url text
)
returns table(
  invitation_id uuid,
  invite_token text,
  invite_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
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
    raise exception 'Only circle owner can create share invitations';
  end if;

  -- Reuse an existing pending share link for this circle when possible.
  select i.id, i.invite_token
    into invitation_id, v_token
  from public.invitations i
  where i.circle_ref = p_circle_id
    and i.is_share_link = true
    and i.status = 'pending'
    and i.invited_email is null
  order by i.created_at desc, i.id desc
  limit 1;

  if invitation_id is null then
    v_token := md5(random()::text || clock_timestamp()::text || auth.uid()::text || p_circle_id::text);

    insert into public.invitations(
      circle_ref,
      invited_email,
      status,
      created_at,
      invited_by,
      invite_token,
      is_share_link
    )
    values (
      p_circle_id,
      null,
      'pending',
      now(),
      auth.uid(),
      v_token,
      true
    )
    returning id into invitation_id;
  end if;

  invite_token := v_token;
  invite_url := v_clean_base_url || '?token=' || v_token;
  return next;
end;
$$;

revoke execute on function public.create_share_invitation(uuid, text) from public;
grant execute on function public.create_share_invitation(uuid, text) to authenticated;

-- Fork personal accepted invitation from a share link; keep share token pending.
create or replace function public.fork_share_invitation_acceptance(
  p_share_invitation_id uuid,
  p_email text,
  p_accepted_by_uid uuid default null,
  p_real_name text default null,
  p_display_name text default null,
  p_mobile text default null
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text,
  invite_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.invitations%rowtype;
  v_email text;
  v_personal_token text;
  v_existing_id uuid;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select *
    into v_share
  from public.invitations i
  where i.id = p_share_invitation_id
  for update;

  if v_share.id is null then
    raise exception 'invitation not found';
  end if;
  if not coalesce(v_share.is_share_link, false) then
    raise exception 'not a share invitation';
  end if;

  select i.id
    into v_existing_id
  from public.invitations i
  where i.circle_ref = v_share.circle_ref
    and not coalesce(i.is_share_link, false)
    and lower(trim(coalesce(i.invited_email, ''))) = v_email
  order by
    case when i.status = 'accepted' then 0 when i.status = 'pending' then 1 else 2 end,
    i.responded_at desc nulls last,
    i.created_at desc nulls last,
    i.id desc
  limit 1;

  if v_existing_id is not null then
    update public.invitations i
    set
      status = 'accepted',
      responded_at = coalesce(i.responded_at, now()),
      accepted_by_uid = coalesce(p_accepted_by_uid, i.accepted_by_uid),
      invitee_real_name = coalesce(
        public.clean_member_label(p_real_name, false),
        i.invitee_real_name
      ),
      invitee_display_name = coalesce(
        public.clean_member_label(p_display_name, false),
        i.invitee_display_name
      ),
      invitee_mobile = coalesce(
        nullif(btrim(coalesce(p_mobile, '')), ''),
        i.invitee_mobile
      )
    where i.id = v_existing_id
    returning i.id, i.circle_ref, i.status, i.invite_token
    into invitation_id, circle_ref, status, invite_token;
  else
    v_personal_token := md5(
      random()::text || clock_timestamp()::text || v_share.id::text || v_email
    );

    insert into public.invitations(
      circle_ref,
      invited_email,
      status,
      created_at,
      responded_at,
      invited_by,
      invite_token,
      accepted_by_uid,
      invitee_real_name,
      invitee_display_name,
      invitee_mobile,
      is_share_link
    )
    values (
      v_share.circle_ref,
      v_email,
      'accepted',
      now(),
      now(),
      v_share.invited_by,
      v_personal_token,
      p_accepted_by_uid,
      public.clean_member_label(
        coalesce(p_real_name, v_share.invitee_real_name),
        false
      ),
      public.clean_member_label(
        coalesce(p_display_name, v_share.invitee_display_name),
        false
      ),
      coalesce(
        nullif(btrim(coalesce(p_mobile, '')), ''),
        v_share.invitee_mobile
      ),
      false
    )
    returning id, circle_ref, status, invite_token
    into invitation_id, circle_ref, status, invite_token;
  end if;

  -- Keep the shared LINE URL reusable.
  update public.invitations i
  set
    status = 'pending',
    invited_email = null,
    responded_at = null,
    accepted_by_uid = null,
    invitee_real_name = null,
    invitee_display_name = null,
    invitee_mobile = null,
    is_share_link = true
  where i.id = v_share.id;

  return next;
end;
$$;

revoke execute on function public.fork_share_invitation_acceptance(uuid, text, uuid, text, text, text) from public;
grant execute on function public.fork_share_invitation_acceptance(uuid, text, uuid, text, text, text) to anon, authenticated;

create or replace function public.submit_invitation_invitee_details(
  p_token text,
  p_email text,
  p_real_name text default null,
  p_display_name text default null,
  p_mobile text default null
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
  v_status text;
  v_invited_email text;
  v_circle_ref uuid;
  v_invitation_id uuid;
  v_is_share_link boolean;
  v_duplicate_id uuid;
  v_duplicate_status text;
  v_replacement_token text;
  v_user_real_name text;
  v_user_display_name text;
  v_user_mobile text;
  v_auth_display_name text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select
    i.id,
    i.status,
    lower(trim(coalesce(i.invited_email, ''))),
    i.circle_ref,
    coalesce(i.is_share_link, false)
  into
    v_invitation_id,
    v_status,
    v_invited_email,
    v_circle_ref,
    v_is_share_link
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_status is null then
    raise exception 'invitation not found';
  end if;

  -- Share links stay pending even if a previous acceptor used the same URL.
  if v_is_share_link then
    if v_status <> 'pending' then
      update public.invitations i
      set
        status = 'pending',
        invited_email = null,
        responded_at = null,
        accepted_by_uid = null,
        invitee_real_name = null,
        invitee_display_name = null,
        invitee_mobile = null
      where i.id = v_invitation_id;
      v_status := 'pending';
      v_invited_email := '';
    end if;
  elsif v_status <> 'pending' then
    raise exception 'invitation already responded';
  end if;

  if (not v_is_share_link) and v_invited_email <> '' and v_invited_email <> v_email then
    raise exception 'email does not match invitation';
  end if;

  select u.real_name, u.display_name, u.mobile
    into v_user_real_name, v_user_display_name, v_user_mobile
  from public.users u
  where lower(trim(coalesce(u.email, ''))) = v_email
  limit 1;

  select coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name')
    into v_auth_display_name
  from auth.users au
  where lower(trim(coalesce(au.email, ''))) = v_email
  limit 1;

  -- Never move a share-link token onto a personal/duplicate invitation.
  if not v_is_share_link then
    select i.id, i.status
      into v_duplicate_id, v_duplicate_status
    from public.invitations i
    where i.circle_ref = v_circle_ref
      and i.id <> v_invitation_id
      and not coalesce(i.is_share_link, false)
      and lower(trim(coalesce(i.invited_email, ''))) = v_email
    order by
      case
        when i.status = 'pending' then 0
        when i.status = 'accepted' then 1
        else 2
      end,
      i.created_at desc,
      i.id
    limit 1;

    if v_duplicate_id is not null then
      v_replacement_token := md5(random()::text || clock_timestamp()::text || v_invitation_id::text);

      update public.invitations i
      set
        invite_token = v_replacement_token,
        status = 'cancelled',
        responded_at = coalesce(i.responded_at, now())
      where i.id = v_invitation_id;

      update public.invitations i
      set
        invite_token = p_token,
        status = case
          when v_duplicate_status = 'accepted' then 'accepted'
          else 'pending'
        end,
        responded_at = case
          when v_duplicate_status = 'accepted' then i.responded_at
          else null
        end,
        invitee_real_name = coalesce(
          public.clean_member_label(v_user_real_name, false),
          public.clean_member_label(p_real_name, false),
          i.invitee_real_name
        ),
        invitee_display_name = coalesce(
          public.clean_member_label(v_user_display_name, false),
          public.clean_member_label(p_display_name, false),
          public.clean_member_label(v_auth_display_name, false),
          i.invitee_display_name
        ),
        invitee_mobile = coalesce(
          nullif(btrim(coalesce(v_user_mobile, '')), ''),
          nullif(btrim(coalesce(p_mobile, '')), ''),
          i.invitee_mobile
        )
      where i.id = v_duplicate_id
      returning i.id, i.circle_ref, i.status
      into invitation_id, circle_ref, status;

      return next;
      return;
    end if;
  end if;

  update public.invitations i
  set
    invited_email = v_email,
    invitee_real_name = coalesce(
      public.clean_member_label(v_user_real_name, false),
      public.clean_member_label(p_real_name, false)
    ),
    invitee_display_name = coalesce(
      public.clean_member_label(v_user_display_name, false),
      public.clean_member_label(p_display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    invitee_mobile = coalesce(
      nullif(btrim(coalesce(v_user_mobile, '')), ''),
      nullif(btrim(coalesce(p_mobile, '')), '')
    )
  where i.id = v_invitation_id
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  return next;
end;
$$;

revoke execute on function public.submit_invitation_invitee_details(text, text, text, text, text) from public;
grant execute on function public.submit_invitation_invitee_details(text, text, text, text, text) to anon, authenticated;

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
  v_current public.invitations%rowtype;
  v_forked_token text;
begin
  v_action := lower(trim(p_action));
  if v_action not in ('accept', 'reject') then
    raise exception 'p_action must be accept or reject';
  end if;

  select *
    into v_current
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_current.id is null then
    raise exception 'invitation not found';
  end if;

  if v_action = 'reject' then
    if coalesce(v_current.is_share_link, false) then
      -- Rejecting a share link only clears temporary invitee fields; URL stays open.
      update public.invitations i
      set
        status = 'pending',
        invited_email = null,
        responded_at = null,
        accepted_by_uid = null,
        invitee_real_name = null,
        invitee_display_name = null,
        invitee_mobile = null
      where i.id = v_current.id;

      invitation_id := v_current.id;
      circle_ref := v_current.circle_ref;
      status := 'rejected';
      return next;
      return;
    end if;

    if v_current.status = 'pending' then
      update public.invitations i
      set
        status = 'rejected',
        responded_at = now()
      where i.id = v_current.id
        and i.status = 'pending';
    end if;

    return query
    select i.id, i.circle_ref, i.status
    from public.invitations i
    where i.invite_token = p_token
    limit 1;
    return;
  end if;

  -- accept
  if coalesce(v_current.is_share_link, false) then
    if nullif(lower(trim(coalesce(v_current.invited_email, ''))), '') is null then
      raise exception 'email required before accepting share invitation';
    end if;

    select f.invitation_id, f.circle_ref, f.status, f.invite_token
      into invitation_id, circle_ref, status, v_forked_token
    from public.fork_share_invitation_acceptance(
      v_current.id,
      v_current.invited_email,
      auth.uid(),
      v_current.invitee_real_name,
      v_current.invitee_display_name,
      v_current.invitee_mobile
    ) f;

    perform public.sync_circle_member_for_invitation(v_forked_token);
    return next;
    return;
  end if;

  if v_current.status = 'pending' then
    update public.invitations i
    set
      status = 'accepted',
      responded_at = now(),
      accepted_by_uid = case
        when auth.uid() is not null then auth.uid()
        else i.accepted_by_uid
      end
    where i.id = v_current.id
      and i.status = 'pending';
  end if;

  perform public.sync_circle_member_for_invitation(p_token);

  return query
  select i.id, i.circle_ref, i.status
  from public.invitations i
  where i.invite_token = p_token
  limit 1;
end;
$$;

revoke execute on function public.respond_invitation(text, text) from public;
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
  v_uid uuid;
  v_email text;
  v_auth_email text;
  v_auth_display_name text;
  v_auth_photo_url text;
  v_auth_mobile text;
  v_invitation public.invitations%rowtype;
  v_personal_token text;
  v_invitee_real_name text;
  v_invitee_display_name text;
  v_invitee_mobile text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authenticated user required';
  end if;
  if p_uid is distinct from v_uid then
    raise exception 'p_uid must match authenticated user';
  end if;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', p_email, '')));

  select
    lower(trim(coalesce(au.email, ''))),
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
    coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture'),
    au.phone
  into
    v_auth_email,
    v_auth_display_name,
    v_auth_photo_url,
    v_auth_mobile
  from auth.users au
  where au.id = v_uid
  limit 1;

  if v_email = '' then
    v_email := coalesce(v_auth_email, '');
  end if;
  if v_email = '' then
    raise exception 'email required';
  end if;

  select *
    into v_invitation
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_invitation.id is null then
    raise exception 'invitation not found';
  end if;

  if coalesce(v_invitation.is_share_link, false) then
    -- Share links must be accepted on the web first (forks a personal accepted row).
    select i.invite_token, i.invitee_real_name, i.invitee_display_name, i.invitee_mobile, i.id, i.circle_ref, i.status
      into v_personal_token, v_invitee_real_name, v_invitee_display_name, v_invitee_mobile,
           invitation_id, circle_ref, status
    from public.invitations i
    where i.circle_ref = v_invitation.circle_ref
      and not coalesce(i.is_share_link, false)
      and i.status = 'accepted'
      and (
        i.accepted_by_uid = v_uid
        or lower(trim(coalesce(i.invited_email, ''))) = v_email
      )
    order by i.responded_at desc nulls last, i.created_at desc nulls last, i.id desc
    limit 1;

    if invitation_id is null then
      raise exception '請先在邀請頁接受邀請';
    end if;

    update public.invitations i
    set accepted_by_uid = coalesce(i.accepted_by_uid, v_uid)
    where i.id = invitation_id;

    perform public.sync_circle_member_for_invitation(v_personal_token);

    insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
    values (
      v_uid,
      nullif(v_email, ''),
      public.clean_member_label(v_invitee_real_name, false),
      coalesce(
        public.clean_member_label(v_invitee_display_name, false),
        public.clean_member_label(v_auth_display_name, false)
      ),
      nullif(btrim(coalesce(v_auth_photo_url, '')), ''),
      coalesce(
        nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
        nullif(btrim(coalesce(v_auth_mobile, '')), '')
      ),
      now()
    )
    on conflict (uid) do update
    set
      email = coalesce(nullif(public.users.email, ''), excluded.email),
      real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
      display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
      photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
      mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

    insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
    values (circle_ref, v_uid, 'member', 'active', now())
    on conflict (circle_ref, user_id) do update
      set status = 'active',
          role = case
            when public.circle_members.role = 'owner' then 'owner'
            else excluded.role
          end;

    -- Ensure share token remains pending for other invitees.
    update public.invitations i
    set
      status = 'pending',
      invited_email = null,
      responded_at = null,
      accepted_by_uid = null,
      invitee_real_name = null,
      invitee_display_name = null,
      invitee_mobile = null,
      is_share_link = true
    where i.id = v_invitation.id;

    return next;
    return;
  end if;

  if v_invitation.status not in ('pending', 'accepted') then
    raise exception 'invitation cannot be claimed';
  end if;
  if v_invitation.accepted_by_uid is not null and v_invitation.accepted_by_uid is distinct from v_uid then
    raise exception 'invitation already claimed by another user';
  end if;
  if v_invitation.status = 'pending'
    and nullif(lower(trim(coalesce(v_invitation.invited_email, ''))), '') is not null
    and lower(trim(v_invitation.invited_email)) <> v_email
  then
    raise exception 'email does not match invitation';
  end if;

  update public.invitations i
  set
    status = 'accepted',
    responded_at = coalesce(i.responded_at, now()),
    accepted_by_uid = v_uid,
    invited_email = coalesce(nullif(i.invited_email, ''), nullif(v_email, '')),
    invitee_real_name = coalesce(i.invitee_real_name, public.clean_member_label(v_auth_display_name, false)),
    invitee_display_name = coalesce(i.invitee_display_name, public.clean_member_label(v_auth_display_name, false)),
    invitee_mobile = coalesce(i.invitee_mobile, nullif(btrim(coalesce(v_auth_mobile, '')), ''))
  where i.invite_token = p_token
    and i.status in ('pending', 'accepted')
    and (
      i.accepted_by_uid is null
      or i.accepted_by_uid = v_uid
    )
    and (
      i.status = 'accepted'
      or coalesce(i.invited_email, '') = ''
      or lower(trim(i.invited_email)) = v_email
    )
  returning i.id, i.circle_ref, i.status, i.invitee_real_name, i.invitee_display_name, i.invitee_mobile
  into invitation_id, circle_ref, status, v_invitee_real_name, v_invitee_display_name, v_invitee_mobile;

  if invitation_id is null then
    raise exception 'invitation cannot be claimed';
  end if;

  insert into public.users(uid, email, real_name, display_name, photo_url, mobile, created_time)
  values (
    v_uid,
    nullif(v_email, ''),
    public.clean_member_label(v_invitee_real_name, false),
    coalesce(
      public.clean_member_label(v_invitee_display_name, false),
      public.clean_member_label(v_auth_display_name, false)
    ),
    nullif(btrim(coalesce(v_auth_photo_url, '')), ''),
    coalesce(
      nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
      nullif(btrim(coalesce(v_auth_mobile, '')), '')
    ),
    now()
  )
  on conflict (uid) do update
  set
    email = coalesce(nullif(public.users.email, ''), excluded.email),
    real_name = coalesce(public.clean_member_label(public.users.real_name, false), excluded.real_name),
    display_name = coalesce(public.clean_member_label(public.users.display_name, false), excluded.display_name),
    photo_url = coalesce(nullif(public.users.photo_url, ''), excluded.photo_url),
    mobile = coalesce(nullif(public.users.mobile, ''), excluded.mobile);

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (circle_ref, v_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = 'active',
        role = case
          when public.circle_members.role = 'owner' then 'owner'
          else excluded.role
        end;

  return next;
end;
$$;

revoke execute on function public.claim_accepted_invitation(text, uuid, text) from public;
grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;

-- Burned share URLs that already joined someone: mint a fresh pending share token
-- only when the accepted row still looks like a former share link (token still on accepted row).
-- Mark historical single-acceptor share rows so new create_share_invitation can add a pending one.
update public.invitations i
set is_share_link = false
where i.status = 'accepted'
  and coalesce(i.is_share_link, false) = true;

-- Enable realtime so inviters see new members without re-login.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'circle_members'
  ) then
    execute 'alter publication supabase_realtime add table public.circle_members';
  end if;
exception
  when undefined_object then
    null;
end;
$$;
