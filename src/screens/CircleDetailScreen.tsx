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

export type CircleDetailScreenProps = {
  circleId: string;
  userId: string;
  onBack: () => void;
  onCreateSlot: (circleId: string) => void;
  onCreateEvent: (circleId: string) => void;
  onInviteFriend: (circleId: string, circleName: string) => void;
  onOpenSlot: (slotId: string) => void;
  onOpenEvent: (eventId: string) => void;
};

type EventTimelineItem = {
  key: string;
  firstEventId: string;
  title: string;
  startDate: string;
  endDate: string;
  timeBlock: string;
  createdAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

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
  ]);
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
        continue;
      }

      current = {
        key: event.id,
        firstEventId: event.id,
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
  const [error, setError] = useState<string | null>(null);
  const eventTimeline = useMemo(() => buildEventTimeline(events), [events]);

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
          listCircleMembers(circleId),
          listSlotsForCircle(circleId),
          listEventsForCircle(circleId),
        ]);
        if (cancelled) {
          return;
        }
        setCircle(row);
        setMembers(memberRows);
        setSlots(slotRows);
        setEvents(eventRows);
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
  }, [circleId, userId]);

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
          {eventTimeline.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無活動</Text>
          ) : (
            eventTimeline.map((event) => (
              <TouchableOpacity key={event.key} onPress={() => onOpenEvent(event.firstEventId)}>
                <Text style={styles.linkLine}>{event.title} · {formatDateRange(event.startDate, event.endDate)} · {event.timeBlock}</Text>
              </TouchableOpacity>
            ))
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
          {slots.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無悠閒時光</Text>
          ) : (
            slots.map((slot) => (
              <TouchableOpacity key={slot.id} onPress={() => onOpenSlot(slot.id)}>
                <Text style={styles.linkLine}>
                  {slot.createdByLabel} · {slot.slotDate} · {slot.timeBlock}
                </Text>
              </TouchableOpacity>
            ))
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
