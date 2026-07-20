import { supabase } from './supabase';
import { T } from './schema';

export type CircleSummary = {
  id: string;
  circleName: string;
  role: 'owner' | 'member';
  memberCount: number;
  ownerLabel: string;
  memberLabels: string[];
};

export type CircleDetail = CircleSummary;

export type CircleMemberSummary = {
  userId: string;
  role: 'owner' | 'member';
  label: string;
};

export type RemoveCircleMembersScope = 'circle' | 'owner_circles';

type UserLabelRow = {
  uid: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
};

type CircleMemberLabelRow = {
  user_id: string;
  role: string | null;
  label: string | null;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanLabel(value: string | null | undefined, options?: { allowEmail?: boolean }): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.replace(/^(圈主|成員)\s*[:：]?\s*/, '').trim() || trimmed;
  if (isUuidLike(cleaned)) {
    return null;
  }
  if (!options?.allowEmail && isEmailLike(cleaned)) {
    return null;
  }
  return cleaned;
}

function profileLabel(row: UserLabelRow | undefined): string | null {
  if (!row) {
    return null;
  }
  return cleanLabel(row.display_name) || cleanLabel(row.real_name) || cleanLabel(row.email, { allowEmail: true });
}

function userLabel(row: UserLabelRow | undefined, fallback: string): string {
  return profileLabel(row) || (fallback.includes('@') ? fallback : '密友');
}

async function listCircleMemberLabels(circleId: string, viewerId?: string): Promise<CircleMemberSummary[]> {
  const { data, error } = await supabase.rpc('list_circle_members_with_labels', {
    p_circle_id: circleId,
    ...(viewerId ? { p_uid: viewerId } : {}),
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as CircleMemberLabelRow[]).map((row) => ({
    userId: row.user_id,
    role: row.role === 'owner' ? 'owner' : 'member',
    label: cleanLabel(row.label) || '密友',
  }));
}

export async function listAccessibleCircles(uid: string): Promise<CircleSummary[]> {
  const { data: owned, error: ownedErr } = await supabase
    .from(T.circles)
    .select('id, circle_name, owner_id')
    .eq('owner_id', uid);

  if (ownedErr) {
    throw ownedErr;
  }

  const { data: memberships, error: memberErr } = await supabase
    .from(T.circleMembers)
    .select('circle_ref, role, status')
    .eq('user_id', uid)
    .eq('status', 'active');

  if (memberErr) {
    throw memberErr;
  }

  const byId = new Map<string, CircleSummary>();

  for (const row of owned ?? []) {
    const circleId = row.id as string;
    byId.set(circleId, {
      id: circleId,
      circleName: (row.circle_name as string) ?? '',
      role: 'owner',
      memberCount: 0,
      ownerLabel: '',
      memberLabels: [],
    });
  }

  const memberCircleIds = (memberships ?? [])
    .filter((row) => row.status === 'active')
    .map((row) => row.circle_ref as string)
    .filter((circleId) => circleId && !byId.has(circleId));

  if (memberCircleIds.length > 0) {
    const { data: joinedCircles, error: joinedErr } = await supabase
      .from(T.circles)
      .select('id, circle_name, owner_id')
      .in('id', memberCircleIds);

    if (joinedErr) {
      throw joinedErr;
    }

    const roleByCircle = new Map(
      (memberships ?? []).map((row) => [row.circle_ref as string, row.role]),
    );

    for (const circle of joinedCircles ?? []) {
      const circleId = circle.id as string;
      if (byId.has(circleId)) {
        continue;
      }
      byId.set(circleId, {
        id: circleId,
        circleName: (circle.circle_name as string) ?? '',
        role: roleByCircle.get(circleId) === 'owner' ? 'owner' : 'member',
        memberCount: 0,
        ownerLabel: '',
        memberLabels: [],
      });
    }
  }

  const circleIds = Array.from(byId.keys());
  if (circleIds.length > 0) {
    // Use the same security-definer label RPC as CircleDetail so count/labels stay aligned.
    const memberSummariesByCircle = new Map<string, CircleMemberSummary[]>();
    await Promise.all(
      circleIds.map(async (circleId) => {
        memberSummariesByCircle.set(circleId, await listCircleMemberLabels(circleId, uid));
      }),
    );

    for (const circle of byId.values()) {
      const memberSummaries = memberSummariesByCircle.get(circle.id) ?? [];
      circle.memberCount = Math.max(memberSummaries.length, circle.role === 'owner' ? 1 : 0);
      const owner = memberSummaries.find((member) => member.role === 'owner');
      circle.ownerLabel = owner?.label ?? '';
      circle.memberLabels = memberSummaries
        .filter((member) => member.role !== 'owner')
        .map((member) => member.label);
    }
  }

  return Array.from(byId.values());
}

export async function getCircleForUser(uid: string, circleId: string): Promise<CircleDetail | null> {
  const { data: circle, error: circleErr } = await supabase
    .from(T.circles)
    .select('id, circle_name, owner_id')
    .eq('id', circleId)
    .maybeSingle();

  if (circleErr) {
    throw circleErr;
  }
  if (!circle) {
    return null;
  }

  if (circle.owner_id === uid) {
    return {
      id: circle.id as string,
      circleName: (circle.circle_name as string) ?? '',
      role: 'owner',
      memberCount: 0,
      ownerLabel: '',
      memberLabels: [],
    };
  }

  const { data: membership, error: memberErr } = await supabase
    .from(T.circleMembers)
    .select('role')
    .eq('circle_ref', circleId)
    .eq('user_id', uid)
    .eq('status', 'active')
    .maybeSingle();

  if (memberErr) {
    throw memberErr;
  }
  if (!membership) {
    return null;
  }

  return {
    id: circle.id as string,
    circleName: (circle.circle_name as string) ?? '',
    role: membership.role === 'owner' ? 'owner' : 'member',
    memberCount: 0,
    ownerLabel: '',
    memberLabels: [],
  };
}

export async function listCircleMembers(circleId: string, viewerId?: string): Promise<CircleMemberSummary[]> {
  return listCircleMemberLabels(circleId, viewerId);
}

export async function leaveCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_circle', {
    p_circle_id: circleId,
  });

  if (error) {
    throw error;
  }
}

export async function removeCircleMembers(input: {
  circleId: string;
  userIds: string[];
  scope: RemoveCircleMembersScope;
}): Promise<number> {
  const { data, error } = await supabase.rpc('remove_circle_members', {
    p_circle_id: input.circleId,
    p_user_ids: input.userIds,
    p_scope: input.scope,
  });

  if (error) {
    throw error;
  }
  return Number(data ?? 0);
}

export async function removeCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_circle', {
    p_circle_id: circleId,
  });

  if (error) {
    throw error;
  }
}
