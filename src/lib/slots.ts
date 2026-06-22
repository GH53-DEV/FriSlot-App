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
  discussionRequesterIds: string[];
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
  id: string;
  status: SlotBookingStatus;
  requestedBy: string;
  requesterLabel: string;
};

export type UserCancellableBooking = {
  bookingId: string;
  slotId: string;
  slotDate: string;
  timeBlock: string;
  slotOwnerLabel: string;
  status: SlotBookingStatus;
};

export type UserCancellableItem = {
  itemKey: string;
  kind: 'booking' | 'ownSlot';
  bookingId?: string;
  bookingRefs?: Array<{ slotId: string; bookingId: string }>;
  slotId: string;
  slotIds?: string[];
  slotDate: string;
  timeBlock: string;
  slotOwnerLabel: string;
  status?: SlotBookingStatus;
  note?: string | null;
  activeBookingCount?: number;
};

export function cancellableItemKey(kind: UserCancellableItem['kind'], id: string): string {
  return `${kind}:${id}`;
}

function ownSlotDedupeKey(slotDate: string, timeBlock: string): string {
  return `${slotDate}|${timeBlock.trim()}`;
}

function ownerDateTimeGroupKey(slot: Pick<SlotSummary, 'createdBy' | 'slotDate' | 'timeBlock'>): string {
  return `${slot.createdBy}|${ownSlotDedupeKey(slot.slotDate, slot.timeBlock)}`;
}

function userBookingsForOwnerDateTime(
  slots: SlotSummary[],
  slot: Pick<SlotSummary, 'createdBy' | 'slotDate' | 'timeBlock'>,
  uid: string,
): SlotBookingSummary[] {
  const key = ownerDateTimeGroupKey(slot);
  return slots
    .filter((candidate) => ownerDateTimeGroupKey(candidate) === key)
    .flatMap((candidate) => candidate.activeBookings.filter((booking) => booking.requestedBy === uid));
}

export function applyOptimisticUserBooking(
  slots: SlotSummary[],
  bookedSlot: SlotSummary,
  uid: string,
  bookingId: string,
): SlotSummary[] {
  const key = ownerDateTimeGroupKey(bookedSlot);
  const optimisticBooking: SlotBookingSummary = {
    id: bookingId,
    status: 'requested',
    requestedBy: uid,
    requesterLabel: '',
  };
  return slots.map((slot) => {
    if (ownerDateTimeGroupKey(slot) !== key) {
      return slot;
    }
    if (userBookingsForOwnerDateTime([slot], slot, uid).some(
      (booking) => ['requested', 'accepted'].includes(booking.status),
    )) {
      return slot;
    }
    return {
      ...slot,
      activeBookings: [...slot.activeBookings, optimisticBooking],
    };
  });
}

export function findOwnActiveSlotsForDateTime(
  slots: SlotSummary[],
  uid: string,
  slotDate: string,
  timeBlock: string,
): SlotSummary[] {
  const targetKey = ownSlotDedupeKey(slotDate, timeBlock);
  return slots.filter((slot) => (
    slot.createdBy === uid
    && slot.status !== 'cancelled'
    && !isSlotExpired(slot)
    && ownSlotDedupeKey(slot.slotDate, slot.timeBlock) === targetKey
  ));
}

export function applyOptimisticBookSlotUpdate(
  slots: SlotSummary[],
  bookedSlot: SlotSummary,
  uid: string,
  bookingId: string,
  keepBookingIds: string[] = [],
): SlotSummary[] {
  const keepSet = new Set(keepBookingIds);
  const targetKey = ownSlotDedupeKey(bookedSlot.slotDate, bookedSlot.timeBlock);
  return applyOptimisticUserBooking(slots, bookedSlot, uid, bookingId).map((slot) => {
    if (
      slot.createdBy !== uid
      || ownSlotDedupeKey(slot.slotDate, slot.timeBlock) !== targetKey
    ) {
      return slot;
    }
    const nextBookings = slot.activeBookings.filter((booking) => (
      booking.requestedBy === uid
      || keepSet.has(booking.id)
      || !['requested', 'accepted'].includes(booking.status)
    ));
    const hasKeptIncoming = nextBookings.some(
      (booking) => (
        booking.requestedBy !== uid
        && keepSet.has(booking.id)
        && ['requested', 'accepted'].includes(booking.status)
      ),
    );
    return {
      ...slot,
      activeBookings: nextBookings,
      status: hasKeptIncoming ? slot.status : 'cancelled',
    };
  });
}

export type OwnSlotIncomingBooking = {
  itemKey: string;
  bookingId: string;
  slotId: string;
  slotDate: string;
  timeBlock: string;
  requesterLabel: string;
  status: SlotBookingStatus;
};

export function collectOwnSlotIncomingBookings(
  slots: SlotSummary[],
  uid: string,
  slotDate: string,
  timeBlock: string,
): OwnSlotIncomingBooking[] {
  const ownSlots = findOwnActiveSlotsForDateTime(slots, uid, slotDate, timeBlock);
  const results: OwnSlotIncomingBooking[] = [];
  const seenBookingIds = new Set<string>();

  for (const slot of ownSlots) {
    for (const booking of slot.activeBookings) {
      if (booking.requestedBy === uid) {
        continue;
      }
      if (!['requested', 'accepted'].includes(booking.status)) {
        continue;
      }
      if (seenBookingIds.has(booking.id)) {
        continue;
      }
      seenBookingIds.add(booking.id);
      results.push({
        itemKey: `incoming:${slot.id}:${booking.id}`,
        bookingId: booking.id,
        slotId: slot.id,
        slotDate: slot.slotDate,
        timeBlock: slot.timeBlock,
        requesterLabel: booking.requesterLabel,
        status: booking.status,
      });
    }
  }

  return results.sort(
    (a, b) =>
      a.slotDate.localeCompare(b.slotDate)
      || a.timeBlock.localeCompare(b.timeBlock)
      || a.requesterLabel.localeCompare(b.requesterLabel),
  );
}

export function applyOptimisticOwnSlotIncomingUpdate(
  slots: SlotSummary[],
  uid: string,
  slotDate: string,
  timeBlock: string,
  keepBookingIds: string[],
  cancelledBookingIds: string[],
): SlotSummary[] {
  const keepSet = new Set(keepBookingIds);
  const cancelledSet = new Set(cancelledBookingIds);
  const targetKey = ownSlotDedupeKey(slotDate, timeBlock);

  return slots.map((slot) => {
    if (
      slot.createdBy !== uid
      || ownSlotDedupeKey(slot.slotDate, slot.timeBlock) !== targetKey
    ) {
      return slot;
    }
    const nextBookings = slot.activeBookings.filter(
      (booking) => !cancelledSet.has(booking.id),
    );
    const hasKeptIncoming = nextBookings.some(
      (booking) => (
        booking.requestedBy !== uid
        && keepSet.has(booking.id)
        && ['requested', 'accepted'].includes(booking.status)
      ),
    );
    return {
      ...slot,
      activeBookings: nextBookings,
      status: hasKeptIncoming ? slot.status : 'cancelled',
    };
  });
}

export type OwnSlotCancellationResult = {
  slotId: string;
  cancelledBookings: SlotBooking[];
  slotCancelled: boolean;
};

export async function cancelOwnActiveSlotsForDateTime(
  slots: SlotSummary[],
  uid: string,
  slotDate: string,
  timeBlock: string,
  keepBookingIds: string[] = [],
): Promise<OwnSlotCancellationResult[]> {
  const keepSet = new Set(keepBookingIds);
  const ownSlots = findOwnActiveSlotsForDateTime(slots, uid, slotDate, timeBlock);
  const results: OwnSlotCancellationResult[] = [];

  for (const slot of ownSlots) {
    const detail = await getSlotDetail(slot.id);
    const cancelledBookings: SlotBooking[] = [];
    let hasKeptIncoming = false;
    if (detail) {
      for (const booking of detail.bookings) {
        if (booking.requestedBy === uid) {
          continue;
        }
        if (!['requested', 'accepted'].includes(booking.status)) {
          continue;
        }
        if (keepSet.has(booking.id)) {
          hasKeptIncoming = true;
          continue;
        }
        await updateSlotBookingStatus(booking.id, 'cancelled');
        cancelledBookings.push(booking);
      }
    }
    const slotCancelled = !hasKeptIncoming;
    if (slotCancelled) {
      await updateSlotStatus(slot.id, 'cancelled');
    }
    results.push({ slotId: slot.id, cancelledBookings, slotCancelled });
  }

  return results;
}

export async function createSlotBookingWithOwnSlotCleanup(input: {
  slotId: string;
  circleId: string;
  requestedBy: string;
  slotDate: string;
  timeBlock: string;
  visibleSlots: SlotSummary[];
  keepBookingIds?: string[];
  message?: string | null;
}): Promise<{ bookingId: string; ownSlotCancellations: OwnSlotCancellationResult[] }> {
  const keepBookingIds = input.keepBookingIds ?? [];
  const ownSlotCancellations = await cancelOwnActiveSlotsForDateTime(
    input.visibleSlots,
    input.requestedBy,
    input.slotDate,
    input.timeBlock,
    keepBookingIds,
  );
  const bookingId = await createSlotBooking({
    slotId: input.slotId,
    circleId: input.circleId,
    requestedBy: input.requestedBy,
    message: input.message,
  });
  return { bookingId, ownSlotCancellations };
}

export function getOwnActiveSlotDuplicate(
  slots: SlotSummary[],
  uid: string,
  slotDate: string,
  timeBlock: string,
): SlotSummary | null {
  const targetKey = ownSlotDedupeKey(slotDate, timeBlock);
  return slots.find((slot) => (
    slot.createdBy === uid
    && slot.status !== 'cancelled'
    && !isSlotExpired(slot)
    && ownSlotDedupeKey(slot.slotDate, slot.timeBlock) === targetKey
  )) ?? null;
}

export function dedupeSlotsByOwnerDateTime(slots: SlotSummary[]): SlotSummary[] {
  const buckets = new Map<string, SlotSummary>();
  for (const slot of slots) {
    const key = `${slot.createdBy}|${ownSlotDedupeKey(slot.slotDate, slot.timeBlock)}`;
    if (!buckets.has(key)) {
      buckets.set(key, slot);
    }
  }
  return [...buckets.values()].sort(
    (a, b) =>
      a.slotDate.localeCompare(b.slotDate)
      || a.timeBlock.localeCompare(b.timeBlock)
      || a.createdByLabel.localeCompare(b.createdByLabel),
  );
}

function bookingDedupeKey(
  slotDate: string,
  timeBlock: string,
  slotOwnerLabel: string,
  status: SlotBookingStatus,
): string {
  return `${slotDate}|${timeBlock.trim()}|${slotOwnerLabel.trim()}|${status}`;
}

function toSlotSummary(
  row: SlotRow,
  visibleCircleIds: string[] = [],
  createdByLabel = row.created_by,
  bookingSummaries: SlotBookingSummary[] = [],
  discussionRequesterIds: string[] = [],
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
    discussionRequesterIds,
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
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

export function isSlotExpired(slot: Pick<SlotSummary, 'slotDate' | 'timeBlock'>): boolean {
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
      id: booking.id,
      status: booking.status,
      requestedBy: booking.requested_by,
      requesterLabel: requesterLabels.get(booking.requested_by) ?? booking.requested_by,
    })));
  }
  return summaries;
}

async function fetchSlotDiscussionRequesterIds(slotIds: string[]): Promise<Map<string, string[]>> {
  if (slotIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from(T.slotBookings)
    .select('slot_id, requested_by')
    .in('slot_id', slotIds);

  if (error) {
    throw error;
  }

  const requesterIdsBySlot = new Map<string, string[]>();
  for (const row of (data ?? []) as Pick<SlotBookingRow, 'slot_id' | 'requested_by'>[]) {
    requesterIdsBySlot.set(row.slot_id, unique([...(requesterIdsBySlot.get(row.slot_id) ?? []), row.requested_by]));
  }
  return requesterIdsBySlot;
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

  const existingSlots = await listVisibleSlotsForUser(input.createdBy);
  if (getOwnActiveSlotDuplicate(existingSlots, input.createdBy, input.slotDate, input.timeBlock)) {
    throw new Error(`這個時段已有相同的悠閒時光（${input.slotDate} · ${input.timeBlock.trim()}），請勿重複建立。`);
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
    const duplicateSlot = error.code === '23505'
      || /duplicate active slot for same date and time block/i.test(error.message ?? '');
    if (duplicateSlot) {
      throw new Error(`這個時段已有相同的悠閒時光（${input.slotDate} · ${input.timeBlock.trim()}），請勿重複建立。`);
    }
    throw error;
  }

  return String(slotId);
}

async function mapSlotRowsToSummaries(rows: SlotRow[]): Promise<SlotSummary[]> {
  if (rows.length === 0) {
    return [];
  }
  const slotIds = rows.map((row) => row.id);
  const [visibilityBySlot, bookingSummaries, discussionRequesterIds, creatorLabels] = await Promise.all([
    fetchSlotVisibility(slotIds),
    fetchActiveSlotBookings(slotIds),
    fetchSlotDiscussionRequesterIds(slotIds),
    fetchUserLabels(rows.map((row) => row.created_by)),
  ]);
  return rows.map((row) => toSlotSummary(
    row,
    visibilityBySlot.get(row.id) ?? [],
    creatorLabels.get(row.created_by),
    bookingSummaries.get(row.id) ?? [],
    discussionRequesterIds.get(row.id) ?? [],
  ));
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

  return mapSlotRowsToSummaries((slots ?? []) as SlotRow[]);
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

  return mapSlotRowsToSummaries((slots ?? []) as SlotRow[]);
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
    ...toSlotSummary(
      slotRow,
      visibilityBySlot.get(slotId) ?? [],
      creatorLabels.get(slotRow.created_by),
      bookings
        .filter((booking) => ['requested', 'accepted'].includes(booking.status))
        .map((booking) => ({
          id: booking.id,
          status: booking.status,
          requestedBy: booking.requested_by,
          requesterLabel: requesterLabels.get(booking.requested_by) ?? booking.requested_by,
        })),
      requesterIds,
    ),
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

export async function countSlotBookingBucketsForUser(uid: string): Promise<{
  requestedCount: number;
  acceptedCount: number;
}> {
  const slots = await listVisibleSlotsForUser(uid);
  return slots.reduce(
    (counts, slot) => {
      if (slot.status === 'cancelled' || isSlotExpired(slot)) {
        return counts;
      }
      const relevantBookings = slot.activeBookings.filter(
        (booking) => booking.requestedBy === uid || slot.createdBy === uid,
      );
      if (relevantBookings.some((booking) => booking.status === 'requested')) {
        counts.requestedCount += 1;
      }
      if (relevantBookings.some((booking) => booking.status === 'accepted')) {
        counts.acceptedCount += 1;
      }
      return counts;
    },
    { requestedCount: 0, acceptedCount: 0 },
  );
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

export async function updateSlotStatus(slotId: string, status: SlotStatus): Promise<void> {
  const { error } = await supabase
    .from(T.slots)
    .update({ status })
    .eq('id', slotId);

  if (error) {
    throw error;
  }
}

export function collectUserBookedSlotDates(slots: SlotSummary[], uid: string): Set<string> {
  return collectUserSlotCalendarHighlights(slots, uid).bookedDates;
}

function hasUserActiveBooking(slots: SlotSummary[], slot: SlotSummary, uid: string): boolean {
  return userBookingsForOwnerDateTime(slots, slot, uid).some(
    (booking) => ['requested', 'accepted'].includes(booking.status),
  );
}

function isSlotBookableByUser(slots: SlotSummary[], slot: SlotSummary, uid: string): boolean {
  if (slot.status === 'cancelled' || isSlotExpired(slot)) {
    return false;
  }
  if (slot.createdBy === uid) {
    return false;
  }
  const userBookings = userBookingsForOwnerDateTime(slots, slot, uid);
  if (userBookings.some((booking) => ['requested', 'accepted'].includes(booking.status))) {
    return false;
  }
  if (userBookings.some((booking) => booking.status === 'declined')) {
    return false;
  }
  return true;
}

export type UserSlotCalendarHighlights = {
  bookedDates: Set<string>;
  bookedWithOptionsDates: Set<string>;
  bookedFullDates: Set<string>;
  unbookedWithOptionsDates: Set<string>;
  ownAvailabilityDates: Set<string>;
};

export function collectUserSlotCalendarHighlights(
  slots: SlotSummary[],
  uid: string,
): UserSlotCalendarHighlights {
  const activeSlots = slots.filter((slot) => slot.status !== 'cancelled' && !isSlotExpired(slot));
  const byDate = new Map<string, SlotSummary[]>();
  for (const slot of activeSlots) {
    const list = byDate.get(slot.slotDate) ?? [];
    list.push(slot);
    byDate.set(slot.slotDate, list);
  }

  const bookedDates = new Set<string>();
  const bookedWithOptionsDates = new Set<string>();
  const bookedFullDates = new Set<string>();
  const unbookedWithOptionsDates = new Set<string>();
  const ownAvailabilityDates = new Set<string>();

  for (const [date, dateSlots] of byDate) {
    const hasBooking = dateSlots.some((slot) => hasUserActiveBooking(activeSlots, slot, uid));
    const hasBookable = dateSlots.some((slot) => isSlotBookableByUser(activeSlots, slot, uid));
    const hasOwnAvailability = dateSlots.some((slot) => {
      if (slot.createdBy !== uid) {
        return false;
      }
      const timeKey = ownSlotDedupeKey(slot.slotDate, slot.timeBlock);
      const userBookedSameTime = activeSlots.some((candidate) => (
        hasUserActiveBooking(activeSlots, candidate, uid)
        && ownSlotDedupeKey(candidate.slotDate, candidate.timeBlock) === timeKey
      ));
      return !userBookedSameTime;
    });
    if (hasBooking) {
      bookedDates.add(date);
      if (hasBookable) {
        bookedWithOptionsDates.add(date);
      } else {
        bookedFullDates.add(date);
      }
    } else if (hasBookable) {
      unbookedWithOptionsDates.add(date);
    } else if (hasOwnAvailability) {
      ownAvailabilityDates.add(date);
    }
  }

  return {
    bookedDates,
    bookedWithOptionsDates,
    bookedFullDates,
    unbookedWithOptionsDates,
    ownAvailabilityDates,
  };
}

export function collectBookableSlotsForDates(
  slots: SlotSummary[],
  uid: string,
  dates: string[],
): SlotSummary[] {
  const dateSet = new Set(dates);
  const activeSlots = slots.filter((slot) => slot.status !== 'cancelled' && !isSlotExpired(slot));
  const dateFiltered = activeSlots.filter((slot) => dateSet.has(slot.slotDate));
  return dedupeSlotsByOwnerDateTime(dateFiltered)
    .filter((slot) => isSlotBookableByUser(activeSlots, slot, uid))
    .sort(
      (a, b) =>
        a.slotDate.localeCompare(b.slotDate)
        || a.timeBlock.localeCompare(b.timeBlock)
        || a.createdByLabel.localeCompare(b.createdByLabel),
    );
}

export type UserCreateSlotBookingConflict = {
  itemKey: string;
  bookingId: string;
  slotId: string;
  slotDate: string;
  timeBlock: string;
  slotOwnerLabel: string;
  status: SlotBookingStatus;
};

export function collectUserCreateSlotBookingConflicts(
  slots: SlotSummary[],
  uid: string,
  dates: string[],
  timeBlock: string,
): UserCreateSlotBookingConflict[] {
  const dateSet = new Set(dates);
  const normalizedTimeBlock = timeBlock.trim();
  const activeSlots = slots.filter((slot) => slot.status !== 'cancelled' && !isSlotExpired(slot));
  const matchingSlots = dedupeSlotsByOwnerDateTime(
    activeSlots.filter((slot) => (
      dateSet.has(slot.slotDate)
      && ownSlotDedupeKey(slot.slotDate, slot.timeBlock) === ownSlotDedupeKey(slot.slotDate, normalizedTimeBlock)
    )),
  );
  const conflicts: UserCreateSlotBookingConflict[] = [];
  const seenBookingIds = new Set<string>();

  for (const slot of matchingSlots) {
    if (slot.createdBy === uid) {
      continue;
    }
    const userBookings = userBookingsForOwnerDateTime(activeSlots, slot, uid);
    const activeBooking = userBookings.find((booking) => ['requested', 'accepted'].includes(booking.status));
    if (!activeBooking || seenBookingIds.has(activeBooking.id)) {
      continue;
    }
    seenBookingIds.add(activeBooking.id);
    conflicts.push({
      itemKey: `outgoing:${slot.id}:${activeBooking.id}`,
      bookingId: activeBooking.id,
      slotId: slot.id,
      slotDate: slot.slotDate,
      timeBlock: slot.timeBlock,
      slotOwnerLabel: slot.createdByLabel,
      status: activeBooking.status,
    });
  }

  return conflicts.sort(
    (a, b) =>
      a.slotDate.localeCompare(b.slotDate)
      || a.timeBlock.localeCompare(b.timeBlock)
      || a.slotOwnerLabel.localeCompare(b.slotOwnerLabel),
  );
}

export type OutgoingBookingCancellationResult = {
  slotId: string;
  bookingId: string;
  slotOwnerLabel: string;
};

export async function cancelUserOutgoingBookingsForCreate(
  slots: SlotSummary[],
  uid: string,
  dates: string[],
  timeBlock: string,
  keepBookingIds: string[],
): Promise<OutgoingBookingCancellationResult[]> {
  const keepSet = new Set(keepBookingIds);
  const conflicts = collectUserCreateSlotBookingConflicts(slots, uid, dates, timeBlock);
  const cancelled: OutgoingBookingCancellationResult[] = [];

  for (const conflict of conflicts) {
    if (keepSet.has(conflict.bookingId)) {
      continue;
    }
    await updateSlotBookingStatus(conflict.bookingId, 'cancelled');
    cancelled.push({
      slotId: conflict.slotId,
      bookingId: conflict.bookingId,
      slotOwnerLabel: conflict.slotOwnerLabel,
    });
  }

  return cancelled;
}

export function collectUserCancellableBookings(slots: SlotSummary[], uid: string): UserCancellableBooking[] {
  return collectUserCancellableItems(slots, uid)
    .filter((item): item is UserCancellableItem & { bookingId: string; status: SlotBookingStatus } => (
      item.kind === 'booking' && Boolean(item.bookingId) && Boolean(item.status)
    ))
    .map((item) => ({
      bookingId: item.bookingId!,
      slotId: item.slotId,
      slotDate: item.slotDate,
      timeBlock: item.timeBlock,
      slotOwnerLabel: item.slotOwnerLabel,
      status: item.status!,
    }));
}

export function collectUserCancellableItems(slots: SlotSummary[], uid: string): UserCancellableItem[] {
  const ownSlotBuckets = new Map<string, UserCancellableItem>();
  const bookingBuckets = new Map<string, UserCancellableItem>();

  for (const slot of slots) {
    if (slot.status === 'cancelled' || isSlotExpired(slot)) {
      continue;
    }
    if (slot.createdBy === uid) {
      const dedupeKey = ownSlotDedupeKey(slot.slotDate, slot.timeBlock);
      const activeBookingCount = slot.activeBookings.filter(
        (booking) => ['requested', 'accepted'].includes(booking.status),
      ).length;
      const existing = ownSlotBuckets.get(dedupeKey);
      if (existing) {
        existing.slotIds = unique([...(existing.slotIds ?? [existing.slotId]), slot.id]);
        existing.activeBookingCount = (existing.activeBookingCount ?? 0) + activeBookingCount;
        continue;
      }
      ownSlotBuckets.set(dedupeKey, {
        itemKey: cancellableItemKey('ownSlot', dedupeKey),
        kind: 'ownSlot',
        slotId: slot.id,
        slotIds: [slot.id],
        slotDate: slot.slotDate,
        timeBlock: slot.timeBlock,
        slotOwnerLabel: slot.createdByLabel,
        note: slot.note,
        activeBookingCount,
      });
    }
    for (const booking of slot.activeBookings) {
      if (booking.requestedBy !== uid || !['requested', 'accepted'].includes(booking.status)) {
        continue;
      }
      const dedupeKey = bookingDedupeKey(
        slot.slotDate,
        slot.timeBlock,
        slot.createdByLabel,
        booking.status,
      );
      const existing = bookingBuckets.get(dedupeKey);
      if (existing) {
        existing.bookingRefs = [
          ...(existing.bookingRefs ?? (existing.bookingId
            ? [{ slotId: existing.slotId, bookingId: existing.bookingId }]
            : [])),
          { slotId: slot.id, bookingId: booking.id },
        ];
        continue;
      }
      bookingBuckets.set(dedupeKey, {
        itemKey: cancellableItemKey('booking', dedupeKey),
        kind: 'booking',
        bookingId: booking.id,
        bookingRefs: [{ slotId: slot.id, bookingId: booking.id }],
        slotId: slot.id,
        slotDate: slot.slotDate,
        timeBlock: slot.timeBlock,
        slotOwnerLabel: slot.createdByLabel,
        status: booking.status,
      });
    }
  }

  return [...ownSlotBuckets.values(), ...bookingBuckets.values()].sort(
    (a, b) =>
      a.slotDate.localeCompare(b.slotDate)
      || a.timeBlock.localeCompare(b.timeBlock)
      || a.kind.localeCompare(b.kind)
      || a.slotOwnerLabel.localeCompare(b.slotOwnerLabel),
  );
}
