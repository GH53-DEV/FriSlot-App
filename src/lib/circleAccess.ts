import { supabase } from './supabase';
import { T } from './schema';

export type CircleSummary = {
  id: string;
  circleName: string;
  role: 'owner' | 'member';
};

export type CircleDetail = CircleSummary;

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
    .select('circle_ref, role')
    .eq('user_id', uid);

  if (memberErr) {
    throw memberErr;
  }

  const byId = new Map<string, CircleSummary>();

  for (const row of owned ?? []) {
    byId.set(row.id as string, {
      id: row.id as string,
      circleName: (row.circle_name as string) ?? '',
      role: 'owner',
    });
  }

  const memberCircleIds = (memberships ?? [])
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
      });
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
    };
  }

  const { data: membership, error: memberErr } = await supabase
    .from(T.circleMembers)
    .select('role')
    .eq('circle_ref', circleId)
    .eq('user_id', uid)
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
  };
}
