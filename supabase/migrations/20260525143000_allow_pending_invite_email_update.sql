-- Allow a pending invitation form to correct the invitee email before accept.

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
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'email required';
  end if;

  select i.status
    into v_status
  from public.invitations i
  where i.invite_token = p_token
  limit 1;

  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'invitation already responded';
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
