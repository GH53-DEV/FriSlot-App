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
      real_name: null,
      display_name: displayName,
      photo_url: photoUrl,
      mobile: user.phone ?? null,
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

export async function userIsCircleMember(circleId: string, uid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(T.circleMembers)
    .select('id')
    .eq('circle_ref', circleId)
    .eq('user_id', uid)
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

export type InvitationByTokenRow = {
  invitation_id: string;
  circle_ref: string;
  circle_name: string;
  invited_email: string;
  status: string;
  invitee_real_name: string;
  invitee_display_name: string;
  invitee_mobile: string;
};

export async function fetchInvitationByToken(token: string): Promise<InvitationByTokenRow | null> {
  const { data, error } = await supabase.rpc('get_invitation_by_token', {
    p_token: token,
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) {
    return null;
  }
  return {
    invitation_id: String(row.invitation_id ?? ''),
    circle_ref: String(row.circle_ref ?? ''),
    circle_name: String(row.circle_name ?? ''),
    invited_email: String(row.invited_email ?? ''),
    status: String(row.status ?? ''),
    invitee_real_name: String(row.invitee_real_name ?? ''),
    invitee_display_name: String(row.invitee_display_name ?? ''),
    invitee_mobile: String(row.invitee_mobile ?? ''),
  };
}

export async function claimInvitationForExistingProfile(input: {
  uid: string;
  email: string;
  token: string;
}) {
  const { data, error } = await supabase.rpc('claim_accepted_invitation', {
    p_token: input.token,
    p_uid: input.uid,
    p_email: input.email,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return {
    invitationId: row?.invitation_id ?? null,
    circleRef: row?.circle_ref ?? null,
    status: row?.status ?? null,
  };
}

export type CreateFirstCircleInput = {
  uid: string;
  email?: string | null;
  circleName: string;
  realName?: string | null;
  displayName: string;
  photoUrl?: string | null;
  mobile: string;
  inviteEmails: string[];
  inviteBaseUrl: string;
  acceptedInviteToken?: string | null;
  /**
   * 邀請模式：
   * - 'email' = 用個別 email 建立可寄送的邀請（既有流程）
   * - 'line'  = 建立一張通用分享邀請函連結，後續由 owner 透過 LINE 等社群分享
   * - 'none'  = 不建立邀請
   */
  inviteMethod?: 'none' | 'email' | 'line';
};

export type InvitationLinkPayload = {
  invitedEmail: string;
  inviteUrl: string;
};

export async function createFirstCircleAndInvites(input: CreateFirstCircleInput) {
  const { error: uErr } = await supabase.from(T.users).upsert(
    {
      uid: input.uid,
      email: input.email ?? null,
      real_name: input.realName?.trim() || null,
      display_name: input.displayName.trim() || null,
      photo_url: input.photoUrl ?? null,
      mobile: input.mobile.trim() || null,
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
      invitationLinks: [] as string[],
      invitationPayloads: [] as InvitationLinkPayload[],
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
    return {
      circleId: existing.id as string,
      invitationLinks: [] as string[],
      invitationPayloads: [] as InvitationLinkPayload[],
      joinedViaInvitation: false,
    };
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

  const inviteMethod = input.inviteMethod ?? 'email';
  const emails = input.inviteEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);

  // LINE / 社群分享：建立一張不帶 email 的通用邀請函連結
  if (inviteMethod === 'line') {
    const { data: shareData, error: shareErr } = await supabase.rpc('create_share_invitation', {
      p_circle_id: circleId,
      p_base_url: input.inviteBaseUrl,
    });
    if (shareErr) {
      throw shareErr;
    }
    const shareRow = Array.isArray(shareData) && shareData.length > 0 ? shareData[0] : null;
    const shareUrl = typeof shareRow?.invite_url === 'string' ? shareRow.invite_url : '';
    return {
      circleId,
      invitationLinks: shareUrl ? [shareUrl] : [],
      invitationPayloads: shareUrl
        ? [{ invitedEmail: '', inviteUrl: shareUrl } as InvitationLinkPayload]
        : [],
      joinedViaInvitation: false,
    };
  }

  if (inviteMethod !== 'email' || emails.length === 0) {
    return {
      circleId,
      invitationLinks: [] as string[],
      invitationPayloads: [] as InvitationLinkPayload[],
      joinedViaInvitation: false,
    };
  }

  const { data: linksData, error: linksErr } = await supabase.rpc('create_invitation_links', {
    p_circle_id: circleId,
    p_emails: emails,
    p_base_url: input.inviteBaseUrl,
  });

  if (linksErr) {
    throw linksErr;
  }

  const invitationPayloads: InvitationLinkPayload[] =
    Array.isArray(linksData) && linksData.length > 0
      ? linksData
          .map((row) => ({
            invitedEmail: typeof row.invited_email === 'string' ? row.invited_email : '',
            inviteUrl: typeof row.invite_url === 'string' ? row.invite_url : '',
          }))
          .filter((row) => row.invitedEmail && row.inviteUrl)
      : [];

  return {
    circleId,
    invitationLinks: invitationPayloads.map((row) => row.inviteUrl),
    invitationPayloads,
    joinedViaInvitation: false,
  };
}

export async function createShareInvitationForCircle(
  circleId: string,
  inviteBaseUrl: string
): Promise<{ invitationLinks: string[]; invitationPayloads: InvitationLinkPayload[] }> {
  const { data: shareData, error: shareErr } = await supabase.rpc('create_share_invitation', {
    p_circle_id: circleId,
    p_base_url: inviteBaseUrl,
  });
  if (shareErr) {
    throw shareErr;
  }
  const shareRow = Array.isArray(shareData) && shareData.length > 0 ? shareData[0] : null;
  const shareUrl = typeof shareRow?.invite_url === 'string' ? shareRow.invite_url : '';
  return {
    invitationLinks: shareUrl ? [shareUrl] : [],
    invitationPayloads: shareUrl ? [{ invitedEmail: '', inviteUrl: shareUrl }] : [],
  };
}

export async function createEmailInvitationsForCircle(
  circleId: string,
  inviteEmails: string[],
  inviteBaseUrl: string
): Promise<{ invitationLinks: string[]; invitationPayloads: InvitationLinkPayload[] }> {
  const emails = inviteEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    return { invitationLinks: [], invitationPayloads: [] };
  }
  const { data: linksData, error: linksErr } = await supabase.rpc('create_invitation_links', {
    p_circle_id: circleId,
    p_emails: emails,
    p_base_url: inviteBaseUrl,
  });
  if (linksErr) {
    throw linksErr;
  }
  const invitationPayloads: InvitationLinkPayload[] =
    Array.isArray(linksData) && linksData.length > 0
      ? linksData
          .map((row) => ({
            invitedEmail: typeof row.invited_email === 'string' ? row.invited_email : '',
            inviteUrl: typeof row.invite_url === 'string' ? row.invite_url : '',
          }))
          .filter((row) => row.invitedEmail && row.inviteUrl)
      : [];
  return {
    invitationLinks: invitationPayloads.map((row) => row.inviteUrl),
    invitationPayloads,
  };
}
