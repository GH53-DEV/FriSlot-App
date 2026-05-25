import { supabase } from './supabase';
import { T } from './schema';

export type CircleSummary = {
  id: string;
  circleName: string;
  role: 'owner' | 'member';
  memberCount: number;
};

export type CircleDetail = CircleSummary;

export type CircleMemberSummary = {
  userId: string;
  role: 'owner' | 'member';
  label: string;
};

export async function listAccessibleCircles(uid: string): Promise<CircleSummary[]> {
  const { data: owned, error: ownedErr } = await supabase
    .from(T.circles)
    .select('id, circle_name')
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
    });
  }

  const memberCircleIds = (memberships ?? [])
    .filter((row) => row.status === 'active')
    .map((row) => row.circle_ref as string)
    .filter((circleId) => circleId && !byId.has(circleId));

  if (memberCircleIds.length > 0) {
    const { data: joinedCircles, error: joinedErr } = await supabase
      .from(T.circles)
      .select('id, circle_name')
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
      });
    }
  }

  const circleIds = Array.from(byId.keys());
  if (circleIds.length > 0) {
    const { data: memberCounts, error: countErr } = await supabase
      .from(T.circleMembers)
      .select('circle_ref')
      .in('circle_ref', circleIds)
      .eq('status', 'active');

    if (countErr) {
      throw countErr;
    }

    const countsByCircle = new Map<string, number>();
    for (const row of memberCounts ?? []) {
      const circleId = row.circle_ref as string;
      countsByCircle.set(circleId, (countsByCircle.get(circleId) ?? 0) + 1);
    }

    for (const circle of byId.values()) {
      circle.memberCount = Math.max(countsByCircle.get(circle.id) ?? 0, circle.role === 'owner' ? 1 : 0);
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
  const usersById = new Map<string, { email: string | null; real_name: string | null; display_name: string | null }>();

  if (userIds.length > 0) {
    const { data: users, error: usersErr } = await supabase
      .from(T.users)
      .select('uid, email, real_name, display_name')
      .in('uid', userIds);
    if (usersErr) {
      throw usersErr;
    }
    for (const row of (users ?? []) as Array<{ uid: string; email: string | null; real_name: string | null; display_name: string | null }>) {
      usersById.set(row.uid, {
        email: row.email,
        real_name: row.real_name,
        display_name: row.display_name,
      });
    }
  }

  return memberRows.map((row) => {
    const user = usersById.get(row.user_id);
    return {
      userId: row.user_id,
      role: row.role === 'owner' ? 'owner' : 'member',
      label: user?.display_name?.trim() || user?.real_name?.trim() || user?.email?.trim() || row.user_id,
    };
  });
}
