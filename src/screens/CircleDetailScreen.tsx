import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatErrorMessage } from '../lib/formatErrorMessage';
import { getCircleForUser, listCircleMembers, type CircleDetail, type CircleMemberSummary } from '../lib/circleAccess';
import { listSlotsForCircle, type SlotSummary } from '../lib/slots';
import { listEventsForCircle, type EventSummary } from '../lib/events';
import {
  discussionKey,
  listDiscussionSummaries,
  type DiscussionSummary,
} from '../lib/discussions';

export type CircleDetailScreenProps = {
  circleId: string;
  userId: string;
  unreadRefreshKey?: number;
  activityUnreadCount?: number;
  eventUnreadCounts?: Record<string, number>;
  slotUnreadCounts?: Record<string, number>;
  locallyReadDiscussionKeys?: Record<string, true>;
  onBack: () => void;
  onCreateSlot: (circleId: string) => void;
  onCreateEvent: (circleId: string) => void;
  onInviteFriend: (circleId: string, circleName: string) => void;
  onOpenSlot: (slotId: string, unreadCount?: number) => void;
  onOpenEvent: (eventId: string, unreadCount?: number, relatedEventIds?: string[]) => void;
};

type EventTimelineItem = {
  key: string;
  firstEventId: string;
  eventIds: string[];
  title: string;
  startDate: string;
  endDate: string;
  timeBlock: string;
  createdAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function eventDateTime(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return Number.NaN;
  }
  return Date.UTC(year, month - 1, day);
}

function isNextDate(previous: string, current: string): boolean {
  const previousTime = eventDateTime(previous);
  const currentTime = eventDateTime(current);
  return Number.isFinite(previousTime) && Number.isFinite(currentTime) && currentTime - previousTime === DAY_MS;
}

function formatDateRange(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
}

function eventTimelineKey(event: EventSummary): string {
  return JSON.stringify([
    event.title.trim(),
    event.timeBlock.trim(),
    event.circleRef,
    event.createdBy,
    event.maxPeople,
    event.budgetType,
    event.budgetAmount,
    event.description?.trim() ?? null,
    event.eventDeadline,
  ]);
}

function isEventFull(event: EventSummary): boolean {
  return Boolean(event.maxPeople && event.participantCount >= event.maxPeople);
}

function isEventDeadlinePassed(event: EventSummary): boolean {
  return Boolean(event.eventDeadline && event.eventDeadline < todayIso());
}

function endHour(timeBlock: string): number {
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

function isEventExpired(event: Pick<EventSummary, 'eventDate' | 'timeBlock'>): boolean {
  const today = todayIso();
  if (event.eventDate < today) {
    return true;
  }
  if (event.eventDate > today) {
    return false;
  }
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 >= endHour(event.timeBlock);
}

function isEventLatestVisible(event: EventSummary): boolean {
  return event.status !== 'cancelled' && !isEventExpired(event) && (isEventFull(event) || !isEventDeadlinePassed(event));
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
  return now.getHours() + now.getMinutes() / 60 >= endHour(slot.timeBlock);
}

function buildEventTimeline(events: EventSummary[]): EventTimelineItem[] {
  const buckets = new Map<string, EventSummary[]>();
  for (const event of events) {
    const key = eventTimelineKey(event);
    buckets.set(key, [...(buckets.get(key) ?? []), event]);
  }

  const timeline: EventTimelineItem[] = [];
  for (const bucketEvents of buckets.values()) {
    const sortedEvents = [...bucketEvents].sort(
      (a, b) =>
        a.eventDate.localeCompare(b.eventDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );

    let current: EventTimelineItem | null = null;
    for (const event of sortedEvents) {
      if (current && isNextDate(current.endDate, event.eventDate)) {
        current.endDate = event.eventDate;
        current.eventIds.push(event.id);
        continue;
      }

      current = {
        key: event.id,
        firstEventId: event.id,
        eventIds: [event.id],
        title: event.title,
        startDate: event.eventDate,
        endDate: event.eventDate,
        timeBlock: event.timeBlock,
        createdAt: event.createdAt,
      };
      timeline.push(current);
    }
  }

  return timeline.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.title.localeCompare(b.title),
  );
}

export function CircleDetailScreen({
  circleId,
  userId,
  unreadRefreshKey = 0,
  activityUnreadCount = 0,
  eventUnreadCounts = {},
  slotUnreadCounts = {},
  locallyReadDiscussionKeys = {},
  onBack,
  onCreateSlot,
  onCreateEvent,
  onInviteFriend,
  onOpenSlot,
  onOpenEvent,
}: CircleDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [members, setMembers] = useState<CircleMemberSummary[]>([]);
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [discussionSummaries, setDiscussionSummaries] = useState<Map<string, DiscussionSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const eventTimeline = useMemo(() => buildEventTimeline(events.filter(isEventLatestVisible)), [events]);
  const visibleSlots = useMemo(
    () => slots.filter((slot) => slot.status !== 'cancelled' && !isSlotExpired(slot)),
    [slots],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await getCircleForUser(userId, circleId);
        if (cancelled) {
          return;
        }
        if (!row) {
          setCircle(null);
          setError('你沒有權限查看這個密友圈。');
          return;
        }
        const [memberRows, slotRows, eventRows] = await Promise.all([
          listCircleMembers(circleId, userId),
          listSlotsForCircle(circleId),
          listEventsForCircle(circleId),
        ]);
        const summaries = await listDiscussionSummaries(userId, [
          ...slotRows.map((slot) => ({ scope: 'slot' as const, targetId: slot.id })),
          ...eventRows.map((event) => ({ scope: 'event' as const, targetId: event.id })),
        ]);
        if (cancelled) {
          return;
        }
        setCircle(row);
        setMembers(memberRows);
        setSlots(slotRows);
        setEvents(eventRows);
        setDiscussionSummaries(summaries);
      } catch (err) {
        if (!cancelled) {
          setError(formatErrorMessage(err));
          setCircle(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [circleId, userId, unreadRefreshKey]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>載入密友圈…</Text>
      </View>
    );
  }

  if (error || !circle) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>無法開啟密友圈</Text>
        <Text style={styles.error}>{error ?? '找不到密友圈'}</Text>
        <View style={styles.backBtn}>
          <Button title="返回" onPress={onBack} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>{circle.circleName}</Text>
        <Text style={styles.subtitle}>circleDetail · {circle.role === 'owner' ? '圈主' : '成員'}</Text>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>小型回憶_短片或照片</Text>
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>活動時間線</Text>
          {activityUnreadCount > 0 ? (
            <Text style={styles.unreadLinkLine}>活動新對話 {activityUnreadCount}</Text>
          ) : null}
          {eventTimeline.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無活動</Text>
          ) : (
            eventTimeline.map((event) => {
              const unreadCount = event.eventIds.reduce(
                (total, eventId) => {
                  const key = discussionKey('event', eventId);
                  return total + (locallyReadDiscussionKeys[key] ? 0 : eventUnreadCounts[eventId] ?? discussionSummaries.get(key)?.unreadCount ?? 0);
                },
                0,
              );
              const eventIdToOpen = event.eventIds.find((eventId) => (
                !locallyReadDiscussionKeys[discussionKey('event', eventId)]
                && (eventUnreadCounts[eventId] ?? discussionSummaries.get(discussionKey('event', eventId))?.unreadCount ?? 0) > 0
              )) ?? event.eventIds.find((eventId) => Boolean(discussionSummaries.get(discussionKey('event', eventId))?.lastMessageAt)) ?? event.firstEventId;
              return (
                <TouchableOpacity key={event.key} onPress={() => onOpenEvent(eventIdToOpen, unreadCount, event.eventIds)}>
                  <Text style={unreadCount ? styles.unreadLinkLine : styles.linkLine}>
                    {event.title} · {formatDateRange(event.startDate, event.endDate)} · {event.timeBlock}
                    {unreadCount ? ` · 新對話 ${unreadCount}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>成員({members.length})</Text>
          {members.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無成員資料</Text>
          ) : (
            members.map((member) => (
              <Text key={member.userId} style={styles.memberLine}>
                {member.label}{member.role === 'owner' ? '（圈主）' : ''}
              </Text>
            ))
          )}
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>悠閒時光</Text>
          {visibleSlots.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無悠閒時光</Text>
          ) : (
            visibleSlots.map((slot) => {
              const key = discussionKey('slot', slot.id);
              const summary = discussionSummaries.get(key);
              const unreadCount = locallyReadDiscussionKeys[key] ? 0 : slotUnreadCounts[slot.id] ?? summary?.unreadCount ?? 0;
              return (
                <TouchableOpacity key={slot.id} onPress={() => onOpenSlot(slot.id, unreadCount)}>
                  <Text style={unreadCount ? styles.unreadLinkLine : styles.linkLine}>
                    {slot.createdByLabel} · {slot.slotDate} · {slot.timeBlock}
                    {unreadCount ? ` · 新對話 ${unreadCount}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onCreateSlot(circle.id)}>
            <Text style={styles.actionText}>+ 悠閒時光</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onCreateEvent(circle.id)}>
            <Text style={styles.actionText}>+ 新活動</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onInviteFriend(circle.id, circle.circleName)}>
            <Text style={styles.actionText}>+ 密友</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.backBtn}>
          <Button title="返回首頁" onPress={onBack} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#64748b',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  note: {
    fontSize: 12,
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  placeholderBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    minHeight: 72,
    justifyContent: 'center',
  },
  placeholderTitle: {
    fontWeight: '600',
    color: '#334155',
  },
  placeholderMuted: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 6,
  },
  memberLine: {
    fontSize: 13,
    color: '#475569',
    marginTop: 6,
  },
  linkLine: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  unreadLinkLine: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  actionBtn: {
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  actionText: {
    color: '#4f46e5',
    fontWeight: '700',
    fontSize: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  error: {
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  backBtn: {
    marginTop: 8,
  },
});
