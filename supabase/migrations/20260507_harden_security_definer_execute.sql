-- Harden SECURITY DEFINER function execute privileges.
-- Remove implicit PUBLIC execute grants and re-grant least privilege roles only.

revoke execute on function public.create_invitation_links(uuid, text[], text) from public;
grant execute on function public.create_invitation_links(uuid, text[], text) to authenticated;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

revoke execute on function public.respond_invitation(text, text) from public;
grant execute on function public.respond_invitation(text, text) to anon, authenticated;

revoke execute on function public.claim_accepted_invitation(text, uuid, text) from public;
grant execute on function public.claim_accepted_invitation(text, uuid, text) to authenticated;
