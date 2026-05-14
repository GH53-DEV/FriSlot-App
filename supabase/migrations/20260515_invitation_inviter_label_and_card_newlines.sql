-- 1) 邀請函「邀請人」顯示：真實姓名（暱稱）優先，否則暱稱／email／好友
-- 2) 修正邀請函內文換行：PostgreSQL 一般字串中 \n 為字面反斜線+n，改為真正換行（chr(10)）

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
    (r.invited_email is null or r.invited_email = '') as is_share_link
  from row_data r
  cross join settings s;
$$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- 將後台已存成字面「\n」的範本改為真正換行（不影響已使用 chr(10) 的正確內容）
update public.app_runtime_settings
set value_text = replace(value_text, E'\\n', chr(10))
where key = 'invitation_card_message'
  and position(E'\\n' in value_text) > 0;
