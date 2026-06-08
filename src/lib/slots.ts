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
  createdByLabel: string;
  sourceCircleRef: string | null;
  status: SlotStatus;
  note: string | null;
  createdAt: string;
  visibleCircleIds: string[];
  activeBookingStatus: SlotBookingStatus | null;
  activeBookingRequestedBy: string | null;
  activeBookingRequesterLabel: string | null;
  activeBookings: SlotBookingSummary[];
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

type UserDisplayLabelRow = {
  uid: string;
  label: string | null;
};

export type SlotBookingSummary = {
  status: SlotBookingStatus;
  requestedBy: string;
  requesterLabel: string;
};

function toSlotSummary(
  row: SlotRow,
  visibleCircleIds: string[] = [],
  createdByLabel = row.created_by,
  bookingSummaries: SlotBookingSummary[] = [],
): SlotSummary {
  const firstBookingSummary = bookingSummaries[0];
  return {
    id: row.id,
    slotDate: row.slot_date,
    timeBlock: row.time_block,
    createdBy: row.created_by,
    createdByLabel,
    sourceCircleRef: row.source_circle_ref,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    visibleCircleIds,
    activeBookingStatus: firstBookingSummary?.status ?? null,
    activeBookingRequestedBy: firstBookingSummary?.requestedBy ?? null,
    activeBookingRequesterLabel: firstBookingSummary?.requesterLabel ?? null,
    activeBookings: bookingSummaries,
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function slotEndHour(timeBlock: string): number {
  const normalized = timeBlock.trim();
  const timeMatches = Array.from(normalized.matchAll(/(\d{1,2})(?::(\d{2}))?/g));
  if (timeMatches.length > 0) {
    const last = timeMatches[timeMatches.length - 1];
    const hour = Number(last[1]);
    const minute = Number(last[2] ?? '0');
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23 && Number.isFinite(minute)) {
      const isAfternoon = /下午|晚上/.test(normalized) && hour < 12;
      return (isAfternoon ? hour + 12 : hour) + minute / 60;
    }
  }
  if (normalized.includes('全天') || normalized.includes('晚上')) {
    return 24;
  }
  if (normalized.includes('下午')) {
    return 18;
  }
  if (normalized.includes('上午')) {
    return 12;
  }
  return 24;
}

function isSlotExpired(slot: Pick<SlotSummary, 'slotDate' | 'timeBlock'>): boolean {
  const today = todayIso();
  if (slot.slotDate < today) {
    return true;
  }
  if (slot.slotDate > today) {
    return false;
  }
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 >= slotEndHour(slot.timeBlock);
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

async function fetchActiveSlotBookings(slotIds: string[]): Promise<Map<string, SlotBookingSummary[]>> {
  const bySlot = new Map<string, SlotBookingRow[]>();
  if (slotIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from(T.slotBookings)
    .select('id, slot_id, circle_ref, requested_by, status, message, created_at')
    .in('slot_id', slotIds)
    .in('status', ['requested', 'accepted'])
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as SlotBookingRow[]) {
    bySlot.set(row.slot_id, [...(bySlot.get(row.slot_id) ?? []), row]);
  }

  const bookings = Array.from(bySlot.values()).flat();
  const requesterLabels = await fetchUserLabels(bookings.map((booking) => booking.requested_by));
  const summaries = new Map<string, SlotBookingSummary[]>();
  for (const [slotId, slotBookings] of bySlot.entries()) {
    summaries.set(slotId, slotBookings.map((booking) => ({
      status: booking.status,
      requestedBy: booking.requested_by,
      requesterLabel: requesterLabels.get(booking.requested_by) ?? booking.requested_by,
    })));
  }
  return summaries;
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
  const rows = (slots ?? []) as SlotRow[];
  const creatorLabels = await fetchUserLabels(rows.map((row) => row.created_by));
  const bookingSummaries = await fetchActiveSlotBookings(rows.map((row) => row.id));
  return rows.map((row) => toSlotSummary(
    row,
    visibilityBySlot.get(row.id) ?? [],
    creatorLabels.get(row.created_by),
    bookingSummaries.get(row.id) ?? [],
  ));
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
  const rows = (slots ?? []) as SlotRow[];
  const creatorLabels = await fetchUserLabels(rows.map((row) => row.created_by));
  const bookingSummaries = await fetchActiveSlotBookings(rows.map((row) => row.id));
  return rows.map((row) => toSlotSummary(
    row,
    visibilityBySlot.get(row.id) ?? [],
    creatorLabels.get(row.created_by),
    bookingSummaries.get(row.id) ?? [],
  ));
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

  const slotRow = slot as SlotRow;
  const visibilityBySlot = await fetchSlotVisibility([slotId]);
  const creatorLabels = await fetchUserLabels([slotRow.created_by]);
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
  const requesterLabels = await fetchUserLabels(requesterIds);

  return {
    ...toSlotSummary(slotRow, visibilityBySlot.get(slotId) ?? [], creatorLabels.get(slotRow.created_by)),
    bookings: bookings.map((booking) => ({
      id: booking.id,
      slotId: booking.slot_id,
      circleRef: booking.circle_ref,
      requestedBy: booking.requested_by,
      requesterLabel: requesterLabels.get(booking.requested_by) ?? booking.requested_by,
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

export async function countActiveSlotBookingsForUser(uid: string): Promise<number> {
  const slots = await listVisibleSlotsForUser(uid);
  return slots.filter((slot) => (
    slot.status !== 'cancelled'
    && !isSlotExpired(slot)
    && slot.activeBookings.some((booking) => booking.requestedBy === uid || slot.createdBy === uid)
  )).length;
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
