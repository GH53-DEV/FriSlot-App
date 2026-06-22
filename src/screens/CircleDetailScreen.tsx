import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatErrorMessage } from '../lib/formatErrorMessage';
import {
  getCircleForUser,
  leaveCircle,
  listCircleMembers,
  removeCircle,
  removeCircleMembers,
  type CircleDetail,
  type CircleMemberSummary,
  type RemoveCircleMembersScope,
} from '../lib/circleAccess';
import { dedupeSlotsByOwnerDateTime, isSlotExpired, listSlotsForCircle, type SlotSummary } from '../lib/slots';
import { listEventsForCircle, type EventSummary } from '../lib/events';
import {
  discussionKey,
  listDiscussionSummaries,
  slotDiscussionTargetsForUser,
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
  onOpenSlot: (slotId: string, unreadCount?: number, relatedTargetIds?: string[]) => void;
  onOpenEvent: (eventId: string, unreadCount?: number, relatedEventIds?: string[]) => void;
  onMembershipChanged?: () => void | Promise<void>;
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
  onMembershipChanged,
}: CircleDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [members, setMembers] = useState<CircleMemberSummary[]>([]);
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [discussionSummaries, setDiscussionSummaries] = useState<Map<string, DiscussionSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showMemberManager, setShowMemberManager] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [removeScope, setRemoveScope] = useState<RemoveCircleMembersScope>('circle');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const eventTimeline = useMemo(() => buildEventTimeline(events.filter(isEventLatestVisible)), [events]);
  const visibleSlots = useMemo(
    () => dedupeSlotsByOwnerDateTime(
      slots.filter((slot) => slot.status !== 'cancelled' && !isSlotExpired(slot)),
    ),
    [slots],
  );
  const removableMembers = useMemo(
    () => members.filter((member) => member.role !== 'owner'),
    [members],
  );
  const filteredRemovableMembers = useMemo(() => {
    const keyword = memberSearch.trim().toLowerCase();
    if (!keyword) {
      return removableMembers;
    }
    return removableMembers.filter((member) => member.label.toLowerCase().includes(keyword));
  }, [memberSearch, removableMembers]);
  const slotBookingCounts = useMemo(
    () => visibleSlots.reduce(
      (counts, slot) => {
        const relevantBookings = slot.activeBookings.filter(
          (booking) => booking.requestedBy === userId || slot.createdBy === userId,
        );
        if (relevantBookings.some((booking) => booking.status === 'requested')) {
          counts.requested += 1;
        }
        if (relevantBookings.some((booking) => booking.status === 'accepted')) {
          counts.accepted += 1;
        }
        return counts;
      },
      { requested: 0, accepted: 0 },
    ),
    [userId, visibleSlots],
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
          ...slotRows.flatMap((slot) => slotDiscussionTargetsForUser(slot, userId)),
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

  const toggleSelectedMember = (memberId: string) => {
    setSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  };

  const refreshMembers = async () => {
    const nextMembers = await listCircleMembers(circleId, userId);
    setMembers(nextMembers);
    setSelectedMemberIds((current) => current.filter((id) => nextMembers.some((member) => member.userId === id)));
  };

  const handleLeaveCircle = () => {
    if (!circle) {
      return;
    }
    setShowLeaveConfirm(true);
  };

  const confirmLeaveCircle = async () => {
    if (!circle) {
      return;
    }
    try {
      setActionBusy(true);
      await leaveCircle(circle.id);
      await onMembershipChanged?.();
      setShowLeaveConfirm(false);
      Alert.alert('退出密友圈', '已退出這個密友圈。');
      onBack();
    } catch (err) {
      Alert.alert('退圈失敗', formatErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleHushPress = () => {
    if (!circle) {
      return;
    }
    if (circle.role === 'owner') {
      setShowMemberManager((current) => !current);
      return;
    }
    handleLeaveCircle();
  };

  const handleRemoveSelectedMembers = () => {
    if (!circle || selectedMemberIds.length === 0) {
      return;
    }
    const scopeText = removeScope === 'owner_circles' ? '圈主所有圈' : '此圈';
    Alert.alert('移除成員', `確定要從${scopeText}移除 ${selectedMemberIds.length} 位成員嗎？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          try {
            setActionBusy(true);
            await removeCircleMembers({
              circleId: circle.id,
              userIds: selectedMemberIds,
              scope: removeScope,
            });
            await refreshMembers();
            await onMembershipChanged?.();
            setShowMemberManager(false);
            setMemberSearch('');
            Alert.alert('移除成員', '已更新成員名單。');
          } catch (err) {
            Alert.alert('移除失敗', formatErrorMessage(err));
          } finally {
            setActionBusy(false);
          }
        },
      },
    ]);
  };

  const handleRemoveCircle = () => {
    if (!circle) {
      return;
    }
    Alert.alert('移除密友圈', `確定要移除「${circle.circleName}」整個圈嗎？圈內成員、邀請與活動會一併移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除整個圈',
        style: 'destructive',
        onPress: async () => {
          try {
            setActionBusy(true);
            await removeCircle(circle.id);
            await onMembershipChanged?.();
            Alert.alert('移除密友圈', '已移除這個密友圈。');
            onBack();
          } catch (err) {
            Alert.alert('移除失敗', formatErrorMessage(err));
          } finally {
            setActionBusy(false);
          }
        },
      },
    ]);
  };

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
    <>
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
          {slotBookingCounts.requested > 0 ? (
            <Text style={styles.bookingLine}>預約 {slotBookingCounts.requested}</Text>
          ) : null}
          {slotBookingCounts.accepted > 0 ? (
            <Text style={styles.bookingLine}>已約 {slotBookingCounts.accepted}</Text>
          ) : null}
          {visibleSlots.length === 0 ? (
            <Text style={styles.placeholderMuted}>尚無悠閒時光</Text>
          ) : (
            visibleSlots.map((slot) => {
              const targets = slotDiscussionTargetsForUser(slot, userId);
              const unreadCount = targets.reduce((total, target) => {
                const key = discussionKey(target.scope, target.targetId);
                return total + (locallyReadDiscussionKeys[key] ? 0 : slotUnreadCounts[target.targetId] ?? discussionSummaries.get(key)?.unreadCount ?? 0);
              }, 0);
              const relatedTargetIds = targets.map((target) => target.targetId);
              return (
                <TouchableOpacity key={slot.id} onPress={() => onOpenSlot(slot.id, unreadCount, relatedTargetIds)}>
                  <Text style={unreadCount ? styles.unreadLinkLine : styles.linkLine}>
                    {slot.createdByLabel} · {slot.slotDate} · {slot.timeBlock}
                    {slot.note ? ` · ${slot.note}` : ''}
                    {unreadCount ? ` · 新對話 ${unreadCount}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onCreateSlot(circle.id)}>
            <View style={styles.actionLabelRow}>
              <View style={styles.actionSymbolStack}>
                <Text style={styles.actionSymbol}>+</Text>
                <Text style={styles.actionSymbol}>-</Text>
              </View>
              <Text style={styles.actionText}>悠閒時光</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onCreateEvent(circle.id)}>
            <Text style={styles.actionText}>+ 新活動</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => onInviteFriend(circle.id, circle.circleName)}>
            <Text style={styles.actionText}>+ 密友</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.hushBtn]} onPress={handleHushPress} disabled={actionBusy}>
            <Text style={styles.hushText}>噓</Text>
          </TouchableOpacity>
        </View>

        {circle.role === 'owner' && showMemberManager ? (
          <View style={styles.managerBox}>
            <Text style={styles.placeholderTitle}>移除成員</Text>
            <TextInput
              style={styles.input}
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder="搜尋成員"
              editable={!actionBusy}
            />
            <View style={styles.scopeRow}>
              <TouchableOpacity
                style={[styles.scopeBtn, removeScope === 'circle' && styles.scopeBtnActive]}
                onPress={() => setRemoveScope('circle')}
                disabled={actionBusy}
              >
                <Text style={[styles.scopeText, removeScope === 'circle' && styles.scopeTextActive]}>只移除此圈</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scopeBtn, removeScope === 'owner_circles' && styles.scopeBtnActive]}
                onPress={() => setRemoveScope('owner_circles')}
                disabled={actionBusy}
              >
                <Text style={[styles.scopeText, removeScope === 'owner_circles' && styles.scopeTextActive]}>圈主所有圈</Text>
              </TouchableOpacity>
            </View>
            {filteredRemovableMembers.length === 0 ? (
              <Text style={styles.placeholderMuted}>沒有可移除的成員</Text>
            ) : (
              filteredRemovableMembers.map((member) => {
                const selected = selectedMemberIds.includes(member.userId);
                return (
                  <TouchableOpacity
                    key={member.userId}
                    style={styles.memberSelectRow}
                    onPress={() => toggleSelectedMember(member.userId)}
                    disabled={actionBusy}
                  >
                    <Text style={styles.memberSelectMark}>{selected ? '☑' : '☐'}</Text>
                    <Text style={styles.memberSelectLabel}>{member.label}</Text>
                  </TouchableOpacity>
                );
              })
            )}
            <View style={styles.managerActionRow}>
              <View style={styles.managerActionBtn}>
                <Button
                  title={`移除選取成員${selectedMemberIds.length ? ` (${selectedMemberIds.length})` : ''}`}
                  onPress={handleRemoveSelectedMembers}
                  disabled={actionBusy || selectedMemberIds.length === 0}
                  color="#dc2626"
                />
              </View>
              <View style={styles.managerActionBtn}>
                <Button title="取消" onPress={() => setShowMemberManager(false)} disabled={actionBusy} color="#64748b" />
              </View>
            </View>
            <TouchableOpacity
              style={[styles.removeCircleBtn, actionBusy && styles.disabledAction]}
              onPress={handleRemoveCircle}
              disabled={actionBusy}
            >
              <Text style={styles.removeCircleText}>移除整個圈</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.backBtn}>
          <Button title="返回首頁" onPress={onBack} />
        </View>
      </View>
    </ScrollView>

    <Modal
      visible={showLeaveConfirm}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!actionBusy) {
          setShowLeaveConfirm(false);
        }
      }}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>退出密友圈</Text>
          <Text style={styles.confirmMessage}>真要退 {circle?.circleName} 圈嗎？</Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={[styles.confirmBtn, styles.confirmBtnCancel, actionBusy && styles.disabledAction]}
              onPress={() => setShowLeaveConfirm(false)}
              disabled={actionBusy}
            >
              <Text style={styles.confirmBtnCancelText}>要不再想想</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, styles.confirmBtnDanger, actionBusy && styles.disabledAction]}
              onPress={() => void confirmLeaveCircle()}
              disabled={actionBusy}
            >
              <Text style={styles.confirmBtnDangerText}>後會有期!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
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
  bookingLine: {
    color: '#0ea5e9',
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
  actionLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  actionSymbolStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSymbol: {
    color: '#4f46e5',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 11,
  },
  actionText: {
    color: '#4f46e5',
    fontWeight: '700',
    fontSize: 12,
  },
  hushBtn: {
    backgroundColor: '#fff7ed',
  },
  hushText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
  },
  managerBox: {
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 10,
    padding: 10,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  scopeBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  scopeBtnActive: {
    backgroundColor: '#2563eb',
  },
  scopeText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  scopeTextActive: {
    color: '#ffffff',
  },
  memberSelectRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
  },
  memberSelectMark: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '800',
  },
  memberSelectLabel: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  managerActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  managerActionBtn: {
    flex: 1,
  },
  removeCircleBtn: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  removeCircleText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledAction: {
    opacity: 0.5,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    maxWidth: 360,
    padding: 20,
    width: '100%',
  },
  confirmTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  confirmMessage: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmBtn: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  confirmBtnCancel: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  confirmBtnDanger: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  confirmBtnCancelText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  confirmBtnDangerText: {
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
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
