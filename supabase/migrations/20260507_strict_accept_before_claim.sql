-- Strict mode: invitee must explicitly accept before claim/join.

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
