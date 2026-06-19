-- Allow authenticated users to update their own nickname and mobile from Who am I.

create or replace function public.update_my_user_profile(
  p_display_name text,
  p_mobile text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.users
  set
    display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
    mobile = nullif(btrim(coalesce(p_mobile, '')), '')
  where uid = v_uid;

  if not found then
    raise exception 'user profile not found';
  end if;
end;
$$;

revoke all on function public.update_my_user_profile(text, text) from public;
grant execute on function public.update_my_user_profile(text, text) to authenticated;
