# Invitation E2E Checklist

## Prerequisites
- Apply SQL migration: `supabase/migrations/20260506_invitation_link_flow.sql`.
- Deploy `web/invite.html` to your invite URL (same as `expo.extra.inviteBaseUrl`).
- Set `SUPABASE_ANON_KEY` in `web/invite.html`.

## Scenario A: Owner sends invitations
1. Login with owner account.
2. Complete onboarding with 1-3 invite emails.
3. Verify `invitations` rows are created with:
   - `status = pending`
   - non-null `invite_token`
   - `invite_url` works.
4. Verify share options:
   - Email opens compose page.
   - LINE opens sharing.
   - Generic share sheet opens.

## Scenario B: Invitee accepts
1. Open invite URL in browser.
2. Click `接受邀請`.
3. Verify `invitations.status = accepted`.
4. Browser tries app deep link:
   - If app installed: app opens.
   - If app not installed: redirects to store.
5. Login invitee account and complete onboarding form.
6. Verify DB:
   - `users` has invitee profile row.
   - `circle_members` has `(circle_ref, user_id)` with `role = member`.

## Scenario C: Invitee rejects
1. Open invite URL in browser.
2. Click `不接受`.
3. Verify `invitations.status = rejected`.
4. Ensure no new row is created in `circle_members`.

## Scenario D: Idempotency
1. Open same invite URL after accepted/rejected.
2. Verify status remains unchanged (no duplicate transitions).
3. Re-submit onboarding does not create duplicate membership because of unique constraint.
