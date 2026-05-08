# Invitation Email Auto-Send Setup

## What changed
- App auto-calls Supabase Edge Function `send-invitation-emails` after invitations are created.
- Email subject/body template is runtime-configurable via table `public.app_runtime_settings`:
  - key `invitation_email_subject`
  - key `invitation_email_body`
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

## Update template without code change
Use Supabase SQL Editor (or table editor):

```sql
update public.app_runtime_settings
set value_text = 'FriSlot 邀請你加入 {{circle_name}}', updated_at = now()
where key = 'invitation_email_subject';

update public.app_runtime_settings
set value_text = '嗨，\n\n{{owner_email}} 邀請你加入 {{circle_name}}\n邀請連結：{{invite_url}}\n', updated_at = now()
where key = 'invitation_email_body';
```

## Notes
- If email dispatch fails, circle creation remains successful and app shows manual share options.
- Invite page now shows inviter name and disables action buttons after first response.
