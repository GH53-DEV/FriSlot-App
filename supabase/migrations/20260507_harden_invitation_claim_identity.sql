-- Harden invitation claim flow by trusting auth context only.
-- Keep function signature for backward compatibility, but enforce:
-- 1) caller must be authenticated
-- 2) caller uid must equal p_uid
-- 3) caller email must equal p_email
-- 4) membership row is always written for caller uid only

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

  return next;
end;
$$;
