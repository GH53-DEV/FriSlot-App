# Invitation Email Auto-Send Setup

## What changed
- App now auto-calls Supabase Edge Function `send-invitation-emails` after invitations are created.
- Email subject/body template is editable via `app.json`:
  - `expo.extra.invitationEmailSubject`
  - `expo.extra.invitationEmailBody`
- Supported placeholders:
  - `{{owner_email}}`
  - `{{circle_name}}`
  - `{{invite_url}}`

## Deploy Edge Function
1. Install Supabase CLI.
2. Login and link project.
3. Deploy:
   - `supabase functions deploy send-invitation-emails`

## Set secrets
- `supabase secrets set RESEND_API_KEY=...`
- `supabase secrets set INVITATION_FROM_EMAIL="FriSlot <noreply@yourdomain.com>"`

## Notes
- Without these secrets, app will show email dispatch error after invitation creation.
- LINE open reliability is improved in `web/invite.html` with manual open button and Android intent fallback.
