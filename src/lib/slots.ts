import { supabase } from './supabase';
import { T } from './schema';
import { listAccessibleCircles } from './circleAccess';

export type SlotStatus = 'open' | 'booked' | 'cancelled';
export type SlotBookingStatus = 'requested' | 'accepted' | 'declined' | 'cancelled';

export type SlotSummary = {
  id: string;
  slotDate: string;
  timeBlock: string;
  createdBy: string;
  sourceCircleRef: string | null;
  status: SlotStatus;
  note: string | null;
  createdAt: string;
  visibleCircleIds: string[];
};

export type SlotBooking = {
  id: string;
  slotId: string;
  circleRef: string;
  requestedBy: string;
  requesterLabel: string;
  status: SlotBookingStatus;
  message: string | null;
  createdAt: string;
};

export type SlotDetail = SlotSummary & {
  bookings: SlotBooking[];
};

type SlotRow = {
  id: string;
  slot_date: string;
  time_block: string;
  created_by: string;
  source_circle_ref: string | null;
  status: SlotStatus;
  note: string | null;
  created_at: string;
};

type SlotVisibilityRow = {
  slot_id: string;
  circle_ref: string;
};

type SlotBookingRow = {
  id: string;
  slot_id: string;
  circle_ref: string;
  requested_by: string;
  status: SlotBookingStatus;
  message: string | null;
  created_at: string;
};

type UserLabelRow = {
  uid: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
};

function toSlotSummary(row: SlotRow, visibleCircleIds: string[] = []): SlotSummary {
  return {
    id: row.id,
    slotDate: row.slot_date,
    timeBlock: row.time_block,
    createdBy: row.created_by,
    sourceCircleRef: row.source_circle_ref,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    visibleCircleIds,
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

async function fetchSlotVisibility(slotIds: string[]): Promise<Map<string, string[]>> {
  const bySlot = new Map<string, string[]>();
  if (slotIds.length === 0) {
    return bySlot;
  }

  const { data, error } = await supabase
    .from(T.slotVisibilityCircles)
    .select('slot_id, circle_ref')
    .in('slot_id', slotIds);

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as SlotVisibilityRow[]) {
    bySlot.set(row.slot_id, [...(bySlot.get(row.slot_id) ?? []), row.circle_ref]);
  }
  return bySlot;
}

export async function createSlot(input: {
  slotDate: string;
  timeBlock: string;
  createdBy: string;
  sourceCircleId?: string | null;
  visibleCircleIds: string[];
  note?: string | null;
}): Promise<string> {
  const visibleCircleIds = unique(
    input.visibleCircleIds.length > 0
      ? input.visibleCircleIds
      : input.sourceCircleId
        ? [input.sourceCircleId]
        : [],
  );
  if (visibleCircleIds.length === 0) {
    throw new Error('請至少選擇一個可看見悠閒時光的小圈。');
  }

  const { data: slotId, error } = await supabase.rpc('create_slot_with_visibility', {
    p_slot_date: input.slotDate,
    p_time_block: input.timeBlock.trim(),
    p_created_by: input.createdBy,
    p_source_circle_ref: input.sourceCircleId ?? visibleCircleIds[0] ?? null,
    p_visible_circle_ids: visibleCircleIds,
    p_note: input.note?.trim() || null,
  });

  if (error) {
    throw error;
  }

  return String(slotId);
}

export async function listSlotsForCircle(circleId: string): Promise<SlotSummary[]> {
  const { data: visibleRows, error: visibleErr } = await supabase
    .from(T.slotVisibilityCircles)
    .select('slot_id, circle_ref')
    .eq('circle_ref', circleId);

  if (visibleErr) {
    throw visibleErr;
  }

  const slotIds = unique(((visibleRows ?? []) as SlotVisibilityRow[]).map((row) => row.slot_id));
  if (slotIds.length === 0) {
    return [];
  }

  const { data: slots, error: slotsErr } = await supabase
    .from(T.slots)
    .select('id, slot_date, time_block, created_by, source_circle_ref, status, note, created_at')
    .in('id', slotIds)
    .order('slot_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (slotsErr) {
    throw slotsErr;
  }

  const visibilityBySlot = await fetchSlotVisibility(slotIds);
  return ((slots ?? []) as SlotRow[]).map((row) => toSlotSummary(row, visibilityBySlot.get(row.id) ?? []));
}

export async function listVisibleSlotsForUser(uid: string): Promise<SlotSummary[]> {
  const circles = await listAccessibleCircles(uid);
  const circleIds = circles.map((circle) => circle.id);
  if (circleIds.length === 0) {
    return [];
  }

  const { data: visibleRows, error: visibleErr } = await supabase
    .from(T.slotVisibilityCircles)
    .select('slot_id, circle_ref')
    .in('circle_ref', circleIds);

  if (visibleErr) {
    throw visibleErr;
  }

  const slotIds = unique(((visibleRows ?? []) as SlotVisibilityRow[]).map((row) => row.slot_id));
  if (slotIds.length === 0) {
    return [];
  }

  const { data: slots, error: slotsErr } = await supabase
    .from(T.slots)
    .select('id, slot_date, time_block, created_by, source_circle_ref, status, note, created_at')
    .in('id', slotIds)
    .order('slot_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (slotsErr) {
    throw slotsErr;
  }

  const visibilityBySlot = await fetchSlotVisibility(slotIds);
  return ((slots ?? []) as SlotRow[]).map((row) => toSlotSummary(row, visibilityBySlot.get(row.id) ?? []));
}

export async function getSlotDetail(slotId: string): Promise<SlotDetail | null> {
  const { data: slot, error: slotErr } = await supabase
    .from(T.slots)
    .select('id, slot_date, time_block, created_by, source_circle_ref, status, note, created_at')
    .eq('id', slotId)
    .maybeSingle();

  if (slotErr) {
    throw slotErr;
  }
  if (!slot) {
    return null;
  }

  const visibilityBySlot = await fetchSlotVisibility([slotId]);
  const { data: bookingsData, error: bookingsErr } = await supabase
    .from(T.slotBookings)
    .select('id, slot_id, circle_ref, requested_by, status, message, created_at')
    .eq('slot_id', slotId)
    .order('created_at', { ascending: true });

  if (bookingsErr) {
    throw bookingsErr;
  }

  const bookings = (bookingsData ?? []) as SlotBookingRow[];
  const requesterIds = unique(bookings.map((booking) => booking.requested_by));
  const usersById = new Map<string, UserLabelRow>();
  if (requesterIds.length > 0) {
    const { data: users, error: usersErr } = await supabase
      .from(T.users)
      .select('uid, email, real_name, display_name')
      .in('uid', requesterIds);
    if (usersErr) {
      throw usersErr;
    }
    for (const row of (users ?? []) as UserLabelRow[]) {
      usersById.set(row.uid, row);
    }
  }

  return {
    ...toSlotSummary(slot as SlotRow, visibilityBySlot.get(slotId) ?? []),
    bookings: bookings.map((booking) => ({
      id: booking.id,
      slotId: booking.slot_id,
      circleRef: booking.circle_ref,
      requestedBy: booking.requested_by,
      requesterLabel: userLabel(usersById.get(booking.requested_by), booking.requested_by),
      status: booking.status,
      message: booking.message,
      createdAt: booking.created_at,
    })),
  };
}

export async function createSlotBooking(input: {
  slotId: string;
  circleId: string;
  requestedBy: string;
  message?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from(T.slotBookings)
    .insert({
      slot_id: input.slotId,
      circle_ref: input.circleId,
      requested_by: input.requestedBy,
      message: input.message?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }
  return String(data.id);
}

export async function updateSlotBookingStatus(
  bookingId: string,
  status: SlotBookingStatus,
): Promise<void> {
  const { error } = await supabase
    .from(T.slotBookings)
    .update({ status })
    .eq('id', bookingId);

  if (error) {
    throw error;
  }
}
