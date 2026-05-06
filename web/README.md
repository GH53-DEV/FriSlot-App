# Invitation Web Page

This folder contains `invite.html` used by invitation links (`?token=...`).

## Setup
1. Host `invite.html` on a public HTTPS URL, for example:
   - `https://frislot.app/invite`
2. Update these constants inside `invite.html`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `APP_DEEPLINK_SCHEME`
   - `IOS_STORE_URL`
   - `ANDROID_STORE_URL`
3. Keep `expo.extra.inviteBaseUrl` in `app.json` aligned with the hosted URL.

## Flow
- Page loads invitation by token via `get_invitation_by_token`.
- User chooses accept/reject:
  - accept -> `respond_invitation(token, 'accept')`, then tries to open app and falls back to store.
  - reject -> `respond_invitation(token, 'reject')`.
