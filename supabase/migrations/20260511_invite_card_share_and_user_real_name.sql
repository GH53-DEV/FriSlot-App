-- 20260511 invitation flow expansion:
--   1) Users 加入 real_name 欄位 (對應 onboarding 表單)
--   2) app_runtime_settings 新增邀請函外觀/文案、App store 連結等可後台調整的設定
--   3) 支援「社群分享」流程：建立無 email 邀請、接受時補登 email
--   4) get_invitation_by_token 額外回傳邀請函卡片內容供 web 頁面渲染

-- 1. Users 表新增 real_name 欄位（若不存在），並補強既有相關欄位
alter table if exists public.users
  add column if not exists real_name text;

-- 為了相容 schema 早期版本，確保以下欄位都存在
alter table if exists public.users
  add column if not exists email text;

alter table if exists public.users
  add column if not exists display_name text;

alter table if exists public.users
  add column if not exists phone_number text;


-- 2. 邀請函卡片內容 / App store 連結 / 安裝引導文案 (皆可從 SQL 改、不需動 code)
insert into public.app_runtime_settings(key, value_text)
values
  ('invitation_card_title', '{{inviter_name}} 邀請你加入 {{circle_name}}'),
  (
    'invitation_card_message',
    '嗨！\n{{inviter_name}} 正式邀請你加入 {{circle_name}} 密友圈，\n歡迎加入，等你哦！'
  ),
  ('invitation_card_footer', 'FriSlot · 把美好時光留給最重要的密友'),
  ('invitation_install_hint', '接受邀請後，請依下列方式繼續：'),
  ('invitation_ios_store_url', 'https://apps.apple.com/'),
  ('invitation_android_store_url', 'https://play.google.com/store')
on conflict (key) do nothing;


-- 3. 拿掉舊版 get_invitation_by_token，重新建立含邀請函內容的版本
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
  is_share_link boolean
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
      coalesce(u.display_name, u.real_name, u.email, '好友') as inviter_name,
      u.email as inviter_email
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
        '嗨！\n{{inviter_name}} 正式邀請你加入 {{circle_name}} 密友圈，\n歡迎加入，等你哦！') as card_message,
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
    (r.invited_email is null or r.invited_email = '') as is_share_link
  from row_data r
  cross join settings s;
$$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;


-- 4. 社群分享：建立一張「不帶 email」的邀請（給 LINE / 其他社群直接貼連結）
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

  v_token := md5(random()::text || clock_timestamp()::text || auth.uid()::text || p_circle_id::text);

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
    null,
    'pending',
    now(),
    auth.uid(),
    v_token
  )
  returning id into invitation_id;

  invite_token := v_token;
  invite_url := v_clean_base_url || '?token=' || v_token;
  return next;
end;
$$;

revoke execute on function public.create_share_invitation(uuid, text) from public;
grant execute on function public.create_share_invitation(uuid, text) to authenticated;


-- 5. 接受社群分享邀請時、由受邀者補登自己的 email
create or replace function public.submit_share_invitation_email(
  p_token text,
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

  if v_existing_email is not null and v_existing_email <> '' and v_existing_email <> v_email then
    raise exception 'invitation already bound to another email';
  end if;

  update public.invitations i
  set invited_email = v_email
  where i.invite_token = p_token
  returning i.id, i.circle_ref, i.status
  into invitation_id, circle_ref, status;

  return next;
end;
$$;

revoke execute on function public.submit_share_invitation_email(text, text) from public;
grant execute on function public.submit_share_invitation_email(text, text) to anon, authenticated;
