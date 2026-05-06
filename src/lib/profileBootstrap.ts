import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { T } from './schema';

export async function upsertUserFromAuth(user: User) {
  const displayName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    null;
  const photoUrl =
    (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
    (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
    null;

  const { data: existing, error: selErr } = await supabase
    .from(T.users)
    .select('uid')
    .eq('uid', user.id)
    .maybeSingle();

  if (selErr) {
    throw selErr;
  }

  if (!existing) {
    const { error } = await supabase.from(T.users).insert({
      uid: user.id,
      email: user.email ?? null,
      display_name: displayName,
      photo_url: photoUrl,
      phone_number: user.phone ?? null,
      created_time: new Date().toISOString(),
    });
    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await supabase
    .from(T.users)
    .update({
      email: user.email ?? null,
      display_name: displayName,
      photo_url: photoUrl,
    })
    .eq('uid', user.id);

  if (error) {
    throw error;
  }
}

export async function userHasOwnerCircle(uid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(T.circles)
    .select('id')
    .eq('owner_id', uid)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data != null;
}

export async function userExists(uid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(T.users)
    .select('uid')
    .eq('uid', uid)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data != null;
}

export type CreateFirstCircleInput = {
  uid: string;
  email?: string | null;
  circleName: string;
  displayName: string;
  photoUrl?: string | null;
  phoneNumber: string;
  inviteEmails: string[];
  inviteBaseUrl: string;
  acceptedInviteToken?: string | null;
};

export async function createFirstCircleAndInvites(input: CreateFirstCircleInput) {
  const { error: uErr } = await supabase.from(T.users).upsert(
    {
      uid: input.uid,
      email: input.email ?? null,
      display_name: input.displayName.trim() || null,
      photo_url: input.photoUrl ?? null,
      phone_number: input.phoneNumber.trim() || null,
      created_time: new Date().toISOString(),
    },
    { onConflict: 'uid' }
  );

  if (uErr) {
    throw uErr;
  }

  const inviteToken = input.acceptedInviteToken?.trim();
  if (inviteToken) {
    const { data: claimData, error: claimErr } = await supabase.rpc('claim_accepted_invitation', {
      p_token: inviteToken,
      p_uid: input.uid,
      p_email: input.email ?? '',
    });
    if (claimErr) {
      throw claimErr;
    }
    const circleIdFromClaim =
      Array.isArray(claimData) && claimData.length > 0
        ? (claimData[0].circle_ref as string | undefined)
        : undefined;
    return {
      circleId: circleIdFromClaim ?? null,
      invitationLinks: [],
      joinedViaInvitation: true,
    };
  }

  const { data: existing, error: exErr } = await supabase
    .from(T.circles)
    .select('id')
    .eq('owner_id', input.uid)
    .limit(1)
    .maybeSingle();

  if (exErr) {
    throw exErr;
  }

  if (existing) {
    return { circleId: existing.id as string, invitationLinks: [], joinedViaInvitation: false };
  }

  const { data: circle, error: cErr } = await supabase
    .from(T.circles)
    .insert({
      circle_name: input.circleName.trim(),
      owner_id: input.uid,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (cErr) {
    throw cErr;
  }

  const circleId = circle.id as string;

  const { error: mErr } = await supabase.from(T.circleMembers).insert({
    circle_ref: circleId,
    user_id: input.uid,
    role: 'owner',
    status: 'active',
    joined_at: new Date().toISOString(),
  });

  if (mErr) {
    throw mErr;
  }

  const emails = input.inviteEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    return { circleId, invitationLinks: [], joinedViaInvitation: false };
  }

  const { data: linksData, error: linksErr } = await supabase.rpc('create_invitation_links', {
    p_circle_id: circleId,
    p_emails: emails,
    p_base_url: input.inviteBaseUrl,
  });

  if (linksErr) {
    throw linksErr;
  }

  const invitationLinks =
    Array.isArray(linksData) && linksData.length > 0
      ? linksData
          .map((row) => (typeof row.invite_url === 'string' ? row.invite_url : ''))
          .filter(Boolean)
      : [];

  return { circleId, invitationLinks, joinedViaInvitation: false };
}
