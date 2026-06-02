-- Prefer nickname/name sources for member labels before falling back to email.

create or replace function public.list_circle_members_with_labels(
  p_circle_id uuid,
  p_uid uuid default auth.uid()
)
returns table(
  user_id uuid,
  role text,
  label text
)
language sql
security definer
set search_path = public
as $$
  select
    cm.user_id,
    case when cm.role = 'owner' then 'owner' else 'member' end as role,
    coalesce(
      nullif(btrim(coalesce(u.display_name, '')), ''),
      nullif(btrim(coalesce(u.real_name, '')), ''),
      nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''),
      nullif(btrim(coalesce(u.email, '')), ''),
      nullif(btrim(coalesce(au.email, '')), ''),
      '密友'
    ) as label
  from public.circle_members cm
  join public.circles c on c.id = cm.circle_ref
  left join public.users u on u.uid = cm.user_id
  left join auth.users au on au.id = cm.user_id
  where cm.circle_ref = p_circle_id
    and cm.status = 'active'
    and auth.uid() is not null
    and (
      c.owner_id = auth.uid()
      or exists (
        select 1
        from public.circle_members viewer
        where viewer.circle_ref = p_circle_id
          and viewer.user_id = auth.uid()
          and viewer.status = 'active'
      )
    )
  order by
    case when cm.role = 'owner' then 0 else 1 end,
    cm.joined_at,
    cm.user_id;
$$;

revoke execute on function public.list_circle_members_with_labels(uuid, uuid) from public;
grant execute on function public.list_circle_members_with_labels(uuid, uuid) to authenticated;

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
  invitee_mobile text,
  circle_member_nicknames text[]
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
          nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''),
          nullif(btrim(coalesce(u.email, '')), ''),
          nullif(btrim(coalesce(au.email, '')), ''),
          '好友'
        )
      end as inviter_name,
      coalesce(u.email, au.email) as inviter_email,
      coalesce(i.invitee_real_name, '') as invitee_real_name,
      coalesce(i.invitee_display_name, '') as invitee_display_name,
      coalesce(i.invitee_mobile, '') as invitee_mobile,
      coalesce(
        (
          select array_agg(n.nickname order by n.sort_role, n.joined_at, n.user_id)
          from (
            select
              coalesce(
                nullif(btrim(coalesce(um.display_name, '')), ''),
                nullif(btrim(coalesce(um.real_name, '')), ''),
                nullif(btrim(coalesce(aum.raw_user_meta_data ->> 'full_name', aum.raw_user_meta_data ->> 'name', '')), ''),
                nullif(btrim(coalesce(um.email, '')), ''),
                nullif(btrim(coalesce(aum.email, '')), '')
              ) as nickname,
              case when cm.role = 'owner' then 0 else 1 end as sort_role,
              cm.joined_at,
              cm.user_id
            from public.circle_members cm
            left join public.users um on um.uid = cm.user_id
            left join auth.users aum on aum.id = cm.user_id
            where cm.circle_ref = i.circle_ref
              and cm.status = 'active'
          ) n
          where n.nickname is not null
        ),
        array[]::text[]
      ) as circle_member_nicknames
    from public.invitations i
    join public.circles c on c.id = i.circle_ref
    left join public.users u on u.uid = i.invited_by
    left join auth.users au on au.id = i.invited_by
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
    r.invitee_mobile,
    r.circle_member_nicknames
  from row_data r
  cross join settings s;
$$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
