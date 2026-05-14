-- Share-link invitations (LINE / 社群) insert with invited_email = null.
-- Drop NOT NULL so create_share_invitation can succeed.
alter table if exists public.invitations
  alter column invited_email drop not null;
