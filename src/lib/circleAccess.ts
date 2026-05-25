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

type UserLabelRow = {
  uid: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
};

function userLabel(row: UserLabelRow | undefined, fallback: string): string {
  if (!row) {
    return fallback;
  }
  return row.display_name?.trim() || row.real_name?.trim() || row.email?.trim() || fallback;
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
    const { data: memberRows, error: countErr } = await supabase
      .from(T.circleMembers)
      .select('circle_ref, user_id, role')
      .in('circle_ref', circleIds)
      .eq('status', 'active');

    if (countErr) {
      throw countErr;
    }

    const countsByCircle = new Map<string, number>();
    const userIds = new Set<string>();
    for (const row of memberRows ?? []) {
      const circleId = row.circle_ref as string;
      countsByCircle.set(circleId, (countsByCircle.get(circleId) ?? 0) + 1);
      if (row.user_id) {
        userIds.add(row.user_id as string);
      }
    }
    for (const row of owned ?? []) {
      if (row.owner_id) {
        userIds.add(row.owner_id as string);
      }
    }

    const usersById = new Map<string, UserLabelRow>();
    if (userIds.size > 0) {
      const { data: users, error: usersErr } = await supabase
        .from(T.users)
        .select('uid, email, real_name, display_name')
        .in('uid', Array.from(userIds));
      if (usersErr) {
        throw usersErr;
      }
      for (const row of (users ?? []) as UserLabelRow[]) {
        usersById.set(row.uid, row);
      }
    }

    const ownerByCircle = new Map<string, string>();
    for (const row of owned ?? []) {
      ownerByCircle.set(row.id as string, row.owner_id as string);
    }
    const memberLabelsByCircle = new Map<string, string[]>();
    for (const row of memberRows ?? []) {
      const circleId = row.circle_ref as string;
      const memberId = row.user_id as string;
      const labels = memberLabelsByCircle.get(circleId) ?? [];
      labels.push(userLabel(usersById.get(memberId), memberId));
      memberLabelsByCircle.set(circleId, labels);
      if (row.role === 'owner' && !ownerByCircle.has(circleId)) {
        ownerByCircle.set(circleId, memberId);
      }
    }

    for (const circle of byId.values()) {
      circle.memberCount = Math.max(countsByCircle.get(circle.id) ?? 0, circle.role === 'owner' ? 1 : 0);
      const ownerId = ownerByCircle.get(circle.id);
      circle.ownerLabel = ownerId ? userLabel(usersById.get(ownerId), ownerId) : '';
      circle.memberLabels = memberLabelsByCircle.get(circle.id) ?? [];
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

export async function listCircleMembers(circleId: string): Promise<CircleMemberSummary[]> {
  const { data: memberships, error: memberErr } = await supabase
    .from(T.circleMembers)
    .select('user_id, role')
    .eq('circle_ref', circleId)
    .eq('status', 'active');

  if (memberErr) {
    throw memberErr;
  }

  const memberRows = (memberships ?? []) as Array<{ user_id: string; role: string | null }>;
  const userIds = memberRows.map((row) => row.user_id).filter(Boolean);
  const usersById = new Map<string, UserLabelRow>();

  if (userIds.length > 0) {
    const { data: users, error: usersErr } = await supabase
      .from(T.users)
      .select('uid, email, real_name, display_name')
      .in('uid', userIds);
    if (usersErr) {
      throw usersErr;
    }
    for (const row of (users ?? []) as UserLabelRow[]) {
      usersById.set(row.uid, row);
    }
  }

  return memberRows.map((row) => {
    const user = usersById.get(row.user_id);
    return {
      userId: row.user_id,
      role: row.role === 'owner' ? 'owner' : 'member',
      label: userLabel(user, row.user_id),
    };
  });
}
