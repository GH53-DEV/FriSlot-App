-- Store invitee profile on web accept; apply to users on claim.

alter table if exists public.invitations
  add column if not exists invitee_real_name text,
  add column if not exists invitee_display_name text,
  add column if not exists invitee_mobile text;

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
  v_existing_email text;
  v_status text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select coalesce(i.invited_email, ''), i.status
    into v_existing_email, v_status
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'invitation already responded';
  end if;

  if v_existing_email is not null and v_existing_email <> '' and lower(v_existing_email) <> v_email then
    raise exception 'invitation already bound to another email';
  end if;

  update public.invitations i
  set
    invited_email = v_email,
    invitee_real_name = nullif(btrim(coalesce(p_real_name, '')), ''),
    invitee_display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
    invitee_mobile = nullif(btrim(coalesce(p_mobile, '')), '')
  where i.invite_token = p_token
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  return next;
end;
$$;

revoke execute on function public.submit_invitation_invitee_details(text, text, text, text, text) from public;
grant execute on function public.submit_invitation_invitee_details(text, text, text, text, text) to anon, authenticated;

-- Backward-compatible wrapper for older web builds.
create or replace function public.submit_share_invitation_email(
  p_token text,
  p_email text
)
returns table(
  invitation_id uuid,
  circle_ref uuid,
  status text
)
language sql
security definer
set search_path = public
as $$
  select * from public.submit_invitation_invitee_details(p_token, p_email, null, null, null);
$$;

revoke execute on function public.submit_share_invitation_email(text, text) from public;
grant execute on function public.submit_share_invitation_email(text, text) to anon, authenticated;

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
  inviter_email text,
  card_title text,
  card_message text,
  card_footer text,
  install_hint text,
  ios_store_url text,
  android_store_url text,
  is_share_link boolean,
  invitee_real_name text,
  invitee_display_name text,
  invitee_mobile text
)
language sql
security definer
set search_path = public
as $$
  with row_data as (
    select
      i.id as invitation_id,
      i.circle_ref,
      c.circle_name,
      coalesce(i.invited_email, '') as invited_email,
      i.status,
      i.invited_by,
      case
        when nullif(btrim(coalesce(u.real_name, '')), '') is not null
          and nullif(btrim(coalesce(u.display_name, '')), '') is not null
          then btrim(u.real_name) || '（' || btrim(u.display_name) || '）'
        when nullif(btrim(coalesce(u.real_name, '')), '') is not null
          then btrim(u.real_name)
        else coalesce(
          nullif(btrim(coalesce(u.display_name, '')), ''),
          nullif(btrim(coalesce(u.email, '')), ''),
          '好友'
        )
      end as inviter_name,
      u.email as inviter_email,
      coalesce(i.invitee_real_name, '') as invitee_real_name,
      coalesce(i.invitee_display_name, '') as invitee_display_name,
      coalesce(i.invitee_mobile, '') as invitee_mobile
    from public.invitations i
    join public.circles c on c.id = i.circle_ref
    left join public.users u on u.uid = i.invited_by
    where i.invite_token = p_token
    limit 1
  ),
  settings as (
    select
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_card_title'),
        '{{inviter_name}} 邀請你加入 {{circle_name}}') as card_title,
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_card_message'),
        '嗨！' || chr(10) || '{{inviter_name}} 正式邀請你加入 {{circle_name}} 密友圈，' || chr(10) || '歡迎加入，等你哦！') as card_message,
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_card_footer'),
        'FriSlot · 把美好時光留給最重要的密友') as card_footer,
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_install_hint'),
        '接受邀請後，請依下列方式繼續：') as install_hint,
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_ios_store_url'),
        'https://apps.apple.com/') as ios_store_url,
      coalesce((select value_text from public.app_runtime_settings where key = 'invitation_android_store_url'),
        'https://play.google.com/store') as android_store_url
  )
  select
    r.invitation_id,
    r.circle_ref,
    r.circle_name,
    r.invited_email,
    r.status,
    r.invited_by,
    r.inviter_name,
    r.inviter_email,
    s.card_title,
    s.card_message,
    s.card_footer,
    s.install_hint,
    s.ios_store_url,
    s.android_store_url,
    (r.invited_email = '') as is_share_link,
    r.invitee_real_name,
    r.invitee_display_name,
    r.invitee_mobile
  from row_data r
  cross join settings s;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

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
  v_claim_email text;
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

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_claim_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'authenticated email required';
  end if;
  if v_claim_email = '' then
    raise exception 'email required to claim invitation';
  end if;
  if v_claim_email <> v_email then
    raise exception 'p_email must match authenticated email';
  end if;

  select
    i.invitee_real_name,
    i.invitee_display_name,
    i.invitee_mobile
  into
    v_invitee_real_name,
    v_invitee_display_name,
    v_invitee_mobile
  from public.invitations i
  where i.invite_token = p_token
    and i.status = 'accepted'
    and lower(i.invited_email) = v_email
  limit 1;

  update public.invitations i
  set
    accepted_by_uid = v_uid
  where i.invite_token = p_token
    and i.status = 'accepted'
    and lower(i.invited_email) = v_email
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  if invitation_id is null then
    raise exception 'Invitation must be accepted before claim';
  end if;

  insert into public.circle_members(circle_ref, user_id, role, status, joined_at)
  values (circle_ref, v_uid, 'member', 'active', now())
  on conflict (circle_ref, user_id) do update
    set status = excluded.status;

  insert into public.users(uid, email, real_name, display_name, mobile, created_time)
  values (
    v_uid,
    v_email,
    nullif(btrim(coalesce(v_invitee_real_name, '')), ''),
    nullif(btrim(coalesce(v_invitee_display_name, '')), ''),
    nullif(btrim(coalesce(v_invitee_mobile, '')), ''),
    now()
  )
  on conflict (uid) do update
  set
    email = coalesce(excluded.email, public.users.email),
    real_name = coalesce(excluded.real_name, public.users.real_name),
    display_name = coalesce(excluded.display_name, public.users.display_name),
    mobile = coalesce(excluded.mobile, public.users.mobile);

  return next;
end;
$$;

revoke execute on function public.claim_accepted_invitation(text, uuid, text) from public;
grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;
