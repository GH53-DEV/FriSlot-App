import { supabase } from './supabase';
import { T } from './schema';
import { listAccessibleCircles } from './circleAccess';

export type EventStatus = 'open' | 'full' | 'cancelled' | 'completed';
export type EventParticipantStatus = 'joined' | 'interested' | 'cancelled';
export type EventBudgetType = 'per_person' | 'total';

export type EventSummary = {
  id: string;
  title: string;
  eventDate: string;
  timeBlock: string;
  status: EventStatus;
  circleRef: string;
  createdBy: string;
  maxPeople: number | null;
  budgetType: EventBudgetType;
  budgetAmount: number | null;
  description: string | null;
  eventDeadline: string | null;
  createdAt: string;
  createdByLabel: string;
  participantCount: number;
};

export type EventParticipant = {
  eventId: string;
  userId: string;
  userLabel: string;
  status: EventParticipantStatus;
  createdAt: string;
};

export type EventDetail = EventSummary & {
  participants: EventParticipant[];
};

type EventRow = {
  id: string;
  title: string;
  event_date: string;
  time_block: string;
  status: EventStatus;
  circle_ref: string;
  created_by: string;
  max_people: number | null;
  budget_type: EventBudgetType | null;
  budget_amount: number | null;
  description: string | null;
  event_deadline: string | null;
  created_at: string;
};

type EventParticipantRow = {
  event_id: string;
  user_id: string;
  status: EventParticipantStatus;
  created_at: string;
};

type UserLabelRow = {
  uid: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
};

type UserDisplayLabelRow = {
  uid: string;
  label: string | null;
};

function toEventSummary(row: EventRow, participantCount = 0, createdByLabel = row.created_by): EventSummary {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    timeBlock: row.time_block,
    status: row.status,
    circleRef: row.circle_ref,
    createdBy: row.created_by,
    maxPeople: row.max_people,
    budgetType: row.budget_type ?? 'per_person',
    budgetAmount: row.budget_amount,
    description: row.description,
    eventDeadline: row.event_deadline,
    createdAt: row.created_at,
    createdByLabel,
    participantCount,
  };
}

function userLabel(row: UserLabelRow | undefined, fallback: string): string {
  if (!row) {
    return fallback;
  }
  return row.display_name?.trim() || row.real_name?.trim() || row.email?.trim() || fallback;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

async function fetchUserLabels(userIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const uniqueIds = unique(userIds);
  if (uniqueIds.length === 0) {
    return labels;
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('list_user_display_labels', {
    p_user_ids: uniqueIds,
  });
  if (!rpcError) {
    for (const row of (rpcRows ?? []) as UserDisplayLabelRow[]) {
      if (row.label?.trim()) {
        labels.set(row.uid, row.label.trim());
      }
    }
    if (labels.size === uniqueIds.length) {
      return labels;
    }
  }

  const { data, error } = await supabase
    .from(T.users)
    .select('uid, email, real_name, display_name')
    .in('uid', uniqueIds);
  if (error) {
    return labels;
  }
  for (const row of (data ?? []) as UserLabelRow[]) {
    labels.set(row.uid, userLabel(row, row.uid));
  }
  return labels;
}

async function fetchParticipantCounts(eventIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (eventIds.length === 0) {
    return counts;
  }

  const { data, error } = await supabase
    .from(T.eventParticipants)
    .select('event_id, user_id, status')
    .in('event_id', eventIds)
    .eq('status', 'joined');

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as Pick<EventParticipantRow, 'event_id'>[]) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

export async function createEvent(input: {
  title: string;
  eventDate: string;
  timeBlock: string;
  circleId: string;
  createdBy: string;
  maxPeople?: number | null;
  budgetType?: EventBudgetType;
  budgetAmount?: number | null;
  description?: string | null;
  eventDeadline?: string | null;
}): Promise<string> {
  const { data: eventId, error } = await supabase.rpc('create_event_with_participant', {
    p_title: input.title.trim(),
    p_event_date: input.eventDate,
    p_time_block: input.timeBlock.trim(),
    p_circle_ref: input.circleId,
    p_created_by: input.createdBy,
    p_max_people: input.maxPeople ?? null,
    p_budget_type: input.budgetType ?? 'per_person',
    p_budget_amount: input.budgetAmount ?? null,
    p_description: input.description?.trim() || null,
    p_event_deadline: input.eventDeadline ?? null,
  });

  if (error) {
    throw error;
  }

  return String(eventId);
}

export async function listEventsForCircle(circleId: string): Promise<EventSummary[]> {
  const { data, error } = await supabase
    .from(T.events)
    .select('id, title, event_date, time_block, status, circle_ref, created_by, max_people, budget_type, budget_amount, description, event_deadline, created_at')
    .eq('circle_ref', circleId)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as EventRow[];
  const counts = await fetchParticipantCounts(rows.map((row) => row.id));
  const creatorLabels = await fetchUserLabels(rows.map((row) => row.created_by));
  return rows.map((row) => toEventSummary(row, counts.get(row.id) ?? 0, creatorLabels.get(row.created_by)));
}

export async function listVisibleEventsForUser(uid: string): Promise<EventSummary[]> {
  const circles = await listAccessibleCircles(uid);
  const circleIds = circles.map((circle) => circle.id);
  if (circleIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from(T.events)
    .select('id, title, event_date, time_block, status, circle_ref, created_by, max_people, budget_type, budget_amount, description, event_deadline, created_at')
    .in('circle_ref', circleIds)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as EventRow[];
  const counts = await fetchParticipantCounts(rows.map((row) => row.id));
  const creatorLabels = await fetchUserLabels(rows.map((row) => row.created_by));
  return rows.map((row) => toEventSummary(row, counts.get(row.id) ?? 0, creatorLabels.get(row.created_by)));
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  const { data: event, error: eventErr } = await supabase
    .from(T.events)
    .select('id, title, event_date, time_block, status, circle_ref, created_by, max_people, budget_type, budget_amount, description, event_deadline, created_at')
    .eq('id', eventId)
    .maybeSingle();

  if (eventErr) {
    throw eventErr;
  }
  if (!event) {
    return null;
  }

  const { data: participantsData, error: participantsErr } = await supabase
    .from(T.eventParticipants)
    .select('event_id, user_id, status, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (participantsErr) {
    throw participantsErr;
  }

  const participants = (participantsData ?? []) as EventParticipantRow[];
  const eventRow = event as EventRow;
  const userIds = unique([...participants.map((participant) => participant.user_id), eventRow.created_by]);
  const userLabels = await fetchUserLabels(userIds);

  const activeParticipantCount = participants.filter((participant) => participant.status === 'joined').length;
  return {
    ...toEventSummary(eventRow, activeParticipantCount, userLabels.get(eventRow.created_by) ?? eventRow.created_by),
    participants: participants.map((participant) => ({
      eventId: participant.event_id,
      userId: participant.user_id,
      userLabel: userLabels.get(participant.user_id) ?? participant.user_id,
      status: participant.status,
      createdAt: participant.created_at,
    })),
  };
}

export async function joinEvent(input: {
  eventId: string;
  userId: string;
  status?: EventParticipantStatus;
}): Promise<void> {
  const { error } = await supabase.from(T.eventParticipants).upsert(
    {
      event_id: input.eventId,
      user_id: input.userId,
      status: input.status ?? 'joined',
    },
    { onConflict: 'event_id,user_id' },
  );

  if (error) {
    throw error;
  }
}

export async function updateEventParticipantStatus(input: {
  eventId: string;
  userId: string;
  status: EventParticipantStatus;
}): Promise<void> {
  const { error } = await supabase
    .from(T.eventParticipants)
    .update({ status: input.status })
    .eq('event_id', input.eventId)
    .eq('user_id', input.userId);

  if (error) {
    throw error;
  }
}
