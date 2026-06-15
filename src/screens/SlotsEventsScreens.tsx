import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { CircleSummary } from '../lib/circleAccess';
import { formatErrorMessage } from '../lib/formatErrorMessage';
import {
  createSlot,
  createSlotBooking,
  getSlotDetail,
  listVisibleSlotsForUser,
  updateSlotBookingStatus,
  type SlotBooking,
  type SlotDetail,
  type SlotSummary,
} from '../lib/slots';
import {
  createEvent,
  getEventDetail,
  joinEvent,
  listVisibleEventsForUser,
  updateEventParticipantStatus,
  type EventDetail,
  type EventSummary,
} from '../lib/events';
import {
  createDiscussionMessage,
  discussionKey,
  ensureSlotDiscussionParticipants,
  listDiscussionSummaries,
  listDiscussionMessages,
  markDiscussionRead,
  subscribeToDiscussionMessages,
  slotDiscussionTargetId,
  slotDiscussionTargetsForUser,
  type DiscussionMessage,
  type DiscussionScope,
  type DiscussionSummary,
} from '../lib/discussions';

type CreateMode = 'slot' | 'event';
type GroupedSlot = SlotSummary & {
  firstSlotId: string;
  slotIds: string[];
  startDate: string;
  endDate: string;
  groupKey: string;
};
type GroupedEvent = EventSummary & {
  firstEventId: string;
  eventIds: string[];
  startDate: string;
  endDate: string;
  groupKey: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeDateInput(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) {
    return null;
  }
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return toIsoDate(date);
}

function formatEventStatus(event: EventSummary): string {
  if (event.status === 'cancelled') {
    return statusLabel(event.status);
  }
  if (isEventFull(event) || isEventDeadlinePassed(event) || isEventExpired(event) || event.status === 'completed' || event.status === 'full') {
    return '結束';
  }
  return statusLabel(event.status);
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return '開放中';
    case 'booked':
      return '已預約';
    case 'requested':
      return '待確認';
    case 'accepted':
      return '已接受';
    case 'declined':
      return '已婉拒';
    case 'cancelled':
      return '已取消';
    case 'full':
      return '已額滿';
    case 'completed':
      return '已完成';
    case 'joined':
      return '參加';
    case 'interested':
      return '有興趣';
    default:
      return status;
  }
}

function isEventFull(event: EventSummary): boolean {
  return Boolean(event.maxPeople && event.participantCount >= event.maxPeople);
}

function isEventDeadlinePassed(event: EventSummary): boolean {
  return Boolean(event.eventDeadline && event.eventDeadline < todayIso());
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
  return now.getHours() + now.getMinutes() / 60 >= slotEndHour(event.timeBlock);
}

function isEventRecruitingVisible(event: EventSummary): boolean {
  return event.status === 'open' && !isEventFull(event) && !isEventDeadlinePassed(event) && !isEventExpired(event);
}

function isEventLatestVisible(event: EventSummary): boolean {
  return event.status !== 'cancelled' && !isEventExpired(event) && (isEventFull(event) || !isEventDeadlinePassed(event));
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

function slotDetailStatusText(slot: Pick<SlotSummary, 'status' | 'slotDate' | 'timeBlock'>): string {
  if (isSlotExpired(slot)) {
    return '已過時間';
  }
  if (slot.status !== 'cancelled') {
    return '可以約喔!';
  }
  return statusLabel(slot.status);
}

function circleNameById(circles: CircleSummary[], circleId: string | null | undefined): string {
  if (!circleId) {
    return '未指定小圈';
  }
  return circles.find((circle) => circle.id === circleId)?.circleName ?? circleId;
}

function dateRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return [start];
  }
  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  const dates: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatDateListLabel(values: string[]): string {
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return formatDateLabel(values[0]);
  }
  return `${formatDateLabel(values[0])} - ${formatDateLabel(values[values.length - 1])}`;
}

function dateTime(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return Number.NaN;
  }
  return Date.UTC(year, month - 1, day);
}

function isNextDate(previous: string, current: string): boolean {
  const previousTime = dateTime(previous);
  const currentTime = dateTime(current);
  return Number.isFinite(previousTime) && Number.isFinite(currentTime) && currentTime - previousTime === DAY_MS;
}

function formatDateRangeLabel(startDate: string, endDate: string): string {
  return startDate === endDate ? formatDateLabel(startDate) : `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;
}

function slotBoardGroupKey(slot: SlotSummary): string {
  return JSON.stringify([
    slot.createdBy,
    slot.timeBlock.trim(),
    slot.note?.trim() ?? null,
    [...slot.visibleCircleIds].sort(),
  ]);
}

function eventBoardGroupKey(event: EventSummary): string {
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

function groupSlotsForBoard(slots: SlotSummary[]): GroupedSlot[] {
  const buckets = new Map<string, SlotSummary[]>();
  for (const slot of slots) {
    const groupKey = slotBoardGroupKey(slot);
    buckets.set(groupKey, [...(buckets.get(groupKey) ?? []), slot]);
  }

  const groups: GroupedSlot[] = [];
  for (const bucketSlots of buckets.values()) {
    const sortedSlots = [...bucketSlots].sort(
      (a, b) =>
        a.slotDate.localeCompare(b.slotDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );

    let current: GroupedSlot | null = null;
    for (const slot of sortedSlots) {
      const groupKey = slotBoardGroupKey(slot);
      if (
        current &&
        slot.timeBlock.trim() === '全天' &&
        current.timeBlock.trim() === '全天' &&
        current.groupKey === groupKey &&
        isNextDate(current.endDate, slot.slotDate)
      ) {
        current.endDate = slot.slotDate;
        current.slotIds.push(slot.id);
        continue;
      }

      current = {
        ...slot,
        firstSlotId: slot.id,
        slotIds: [slot.id],
        startDate: slot.slotDate,
        endDate: slot.slotDate,
        groupKey,
      };
      groups.push(current);
    }
  }

  return groups.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.createdByLabel.localeCompare(b.createdByLabel),
  );
}

function groupEventsForBoard(events: EventSummary[]): GroupedEvent[] {
  const buckets = new Map<string, EventSummary[]>();
  for (const event of events) {
    const groupKey = eventBoardGroupKey(event);
    buckets.set(groupKey, [...(buckets.get(groupKey) ?? []), event]);
  }

  const groups: GroupedEvent[] = [];
  for (const bucketEvents of buckets.values()) {
    const sortedEvents = [...bucketEvents].sort(
      (a, b) =>
        a.eventDate.localeCompare(b.eventDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );

    let current: GroupedEvent | null = null;
    for (const event of sortedEvents) {
      const groupKey = eventBoardGroupKey(event);
      if (current && current.groupKey === groupKey && isNextDate(current.endDate, event.eventDate)) {
        current.endDate = event.eventDate;
        current.participantCount = Math.max(current.participantCount, event.participantCount);
        current.eventIds.push(event.id);
        continue;
      }

      current = {
        ...event,
        firstEventId: event.id,
        eventIds: [event.id],
        startDate: event.eventDate,
        endDate: event.eventDate,
        groupKey,
      };
      groups.push(current);
    }
  }

  return groups.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.title.localeCompare(b.title),
  );
}

function formatNumberWithCommas(value: string | number): string {
  const [integer, decimal] = String(value).split('.');
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal == null ? formattedInteger : `${formattedInteger}.${decimal}`;
}

function formatIntegerInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? formatNumberWithCommas(digits) : '';
}

const TIME_BLOCK_PRESETS = ['上午', '下午', '晚上', '全天'];

function EmptyText({ children }: { children: string }) {
  return <Text style={styles.empty}>{children}</Text>;
}

function TimeBlockPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedValues = value.split('、').map((item) => item.trim()).filter(Boolean);

  const togglePreset = (preset: string) => {
    const next = selectedValues.includes(preset)
      ? selectedValues.filter((item) => item !== preset)
      : [...selectedValues, preset];
    onChange(next.join('、'));
  };

  return (
    <>
      <View style={styles.timePresetWrap}>
        {TIME_BLOCK_PRESETS.map((preset) => {
          const selected = selectedValues.includes(preset);
          return (
            <TouchableOpacity
              key={preset}
              style={[styles.timePreset, selected && styles.timePresetSelected]}
              onPress={() => togglePreset(preset)}
              disabled={disabled}
            >
              <Text style={[styles.timePresetText, selected && styles.timePresetTextSelected]}>
                {selected ? '● ' : '○ '}
                {preset}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value ? <Text style={styles.selectedDateLabel}>已選時段：{value}</Text> : null}
    </>
  );
}

function CircleSearchMultiSelect({
  title,
  circles,
  selectedCircleIds,
  onToggle,
  disabled,
  lockSelection,
  emptyText = '尚無可選小圈',
}: {
  title: string;
  circles: CircleSummary[];
  selectedCircleIds: string[];
  onToggle: (circleId: string) => void;
  disabled?: boolean;
  lockSelection?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCircles = normalizedQuery
    ? circles.filter((circle) => circle.circleName.toLowerCase().includes(normalizedQuery))
    : circles;

  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.searchInputWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="搜尋小圈"
          placeholderTextColor="#94a3b8"
          editable={!disabled && !lockSelection}
        />
      </View>
      {circles.length === 0 ? <EmptyText>{emptyText}</EmptyText> : null}
      {circles.length > 0 && filteredCircles.length === 0 ? <EmptyText>找不到符合的小圈</EmptyText> : null}
      {filteredCircles.map((circle) => (
        <TouchableOpacity
          key={circle.id}
          style={[styles.choiceRow, selectedCircleIds.includes(circle.id) && styles.choiceRowSelected]}
          onPress={() => onToggle(circle.id)}
          disabled={disabled || lockSelection}
        >
          <Text style={styles.choiceText}>
            {selectedCircleIds.includes(circle.id) ? '✓ ' : ''}
            {circle.circleName}
          </Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

export function ChooseDateScreen({
  mode,
  initialDate,
  onPickDates,
  onCancel,
}: {
  mode: CreateMode;
  initialDate?: string;
  onPickDates: (dates: string[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const base = new Date(`${initialDate ?? todayIso()}T00:00:00`);
    return Number.isNaN(base.getTime()) ? new Date() : base;
  });
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string; label: string; date: string | null }> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ key: `blank-${i}`, label: '', date: null });
    }
    for (let day = 1; day <= lastDate; day += 1) {
      const date = new Date(year, month, day);
      cells.push({ key: toIsoDate(date), label: String(day), date: toIsoDate(date) });
    }
    return cells;
  }, [cursor]);

  const monthLabel = `${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  const title = mode === 'slot' ? '挑日子 - 悠閒時光' : '挑日子 - 新活動';

  const handleDatePress = (date: string) => {
    setSelectedDates((current) => {
      if (current.length === 0 || current.length > 1 || current.includes(date)) {
        return [date];
      }
      return dateRange(current[0], date);
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.monthRow}>
          <Button
            title="<"
            onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          />
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Button
            title=">"
            onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          />
        </View>

        <View style={styles.calendarBox}>
          <View style={styles.weekRow}>
            {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
              <Text key={label} style={styles.weekCell}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {days.map((cell) => {
              const selected = Boolean(cell.date && selectedDates.includes(cell.date));
              return (
                <TouchableOpacity
                  key={cell.key}
                  style={[styles.dayCell, !cell.date && styles.dayCellBlank, selected && styles.dayCellSelected]}
                  disabled={!cell.date}
                  onPress={() => cell.date && handleDatePress(cell.date)}
                >
                  <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{cell.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.calendarHint}>點第一天，再點最後一天，可選擇連續多日。</Text>
        {selectedDates.length > 0 ? (
          <Text style={styles.selectedDateLabel}>已選：{formatDateListLabel(selectedDates)}</Text>
        ) : null}
        <View style={styles.buttonGap}>
          <Button
            title="下一步"
            onPress={() => onPickDates(selectedDates)}
            disabled={selectedDates.length === 0}
          />
        </View>
        <View style={styles.buttonGap}>
          <Button title="取消" onPress={onCancel} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function CreateSlotScreen({
  userId,
  selectedDates,
  circles,
  defaultCircleIds,
  lockCircleSelection,
  onCreated,
  onCancel,
}: {
  userId: string;
  selectedDates: string[];
  circles: CircleSummary[];
  defaultCircleIds?: string[];
  lockCircleSelection?: boolean;
  onCreated: (slotId: string) => void;
  onCancel: () => void;
}) {
  const [timeBlock, setTimeBlock] = useState('');
  const [note, setNote] = useState('');
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>(() =>
    defaultCircleIds && defaultCircleIds.length > 0 ? defaultCircleIds : circles.length === 1 ? [circles[0].id] : [],
  );
  const [busy, setBusy] = useState(false);
  const selectableCircles = lockCircleSelection && defaultCircleIds && defaultCircleIds.length > 0
    ? circles.filter((circle) => defaultCircleIds.includes(circle.id))
    : circles;

  const toggleCircle = (circleId: string) => {
    setSelectedCircleIds((current) =>
      current.includes(circleId)
        ? current.filter((id) => id !== circleId)
        : [...current, circleId],
    );
  };

  const handleCreate = async () => {
    if (!timeBlock.trim()) {
      Alert.alert('悠閒時光', '請至少選擇一個時段。');
      return;
    }
    if (selectedDates.length === 0) {
      Alert.alert('悠閒時光', '請先選擇日期。');
      return;
    }
    if (selectedCircleIds.length === 0) {
      Alert.alert('悠閒時光', '請至少選擇一個可看見的小圈。');
      return;
    }
    try {
      setBusy(true);
      let firstSlotId: string | null = null;
      for (const slotDate of selectedDates) {
        const slotId = await createSlot({
          slotDate,
          timeBlock,
          createdBy: userId,
          sourceCircleId: lockCircleSelection ? selectedCircleIds[0] : selectedCircleIds[0],
          visibleCircleIds: selectedCircleIds,
          note,
        });
        firstSlotId = firstSlotId ?? slotId;
      }
      if (firstSlotId) {
        onCreated(firstSlotId);
      }
    } catch (err) {
      Alert.alert('建立失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>建立悠閒時光</Text>
        <Text style={styles.hint}>日期：{formatDateListLabel(selectedDates)}</Text>

        <TimeBlockPicker value={timeBlock} onChange={setTimeBlock} disabled={busy} />
        <Text style={styles.sectionTitle}>有話要說</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={note}
          onChangeText={setNote}
          placeholder="其他細節請在此補充說明，比如 14:15~15:00…"
          placeholderTextColor="#94a3b8"
          editable={!busy}
          multiline
        />

        <CircleSearchMultiSelect
          title="顯示給哪些小圈"
          circles={selectableCircles}
          selectedCircleIds={selectedCircleIds}
          onToggle={toggleCircle}
          disabled={busy}
          lockSelection={lockCircleSelection}
        />

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title={busy ? '建立中…' : '建立'} onPress={() => void handleCreate()} disabled={busy} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="取消" onPress={onCancel} disabled={busy} color="#64748b" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export function CreateEventScreen({
  userId,
  selectedDates,
  circles,
  defaultCircleIds,
  lockCircleSelection,
  onCreated,
  onCancel,
}: {
  userId: string;
  selectedDates: string[];
  circles: CircleSummary[];
  defaultCircleIds?: string[];
  lockCircleSelection?: boolean;
  onCreated: (eventId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [timeBlock, setTimeBlock] = useState('');
  const [maxPeople, setMaxPeople] = useState('');
  const [budgetType, setBudgetType] = useState<'per_person' | 'total'>('per_person');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [description, setDescription] = useState('');
  const [eventDeadline, setEventDeadline] = useState(() => selectedDates[0] ?? todayIso());
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>(() =>
    defaultCircleIds && defaultCircleIds.length > 0 ? defaultCircleIds : circles.length === 1 ? [circles[0].id] : [],
  );
  const [busy, setBusy] = useState(false);
  const selectableCircles = lockCircleSelection && defaultCircleIds && defaultCircleIds.length > 0
    ? circles.filter((circle) => defaultCircleIds.includes(circle.id))
    : circles;

  const toggleCircle = (circleId: string) => {
    setSelectedCircleIds((current) =>
      current.includes(circleId)
        ? current.filter((id) => id !== circleId)
        : [...current, circleId],
    );
  };

  const parseOptionalNumber = (value: string): number | null => {
    const trimmed = value.replace(/,/g, '').trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const handleCreate = async () => {
    const parsedMaxPeople = parseOptionalNumber(maxPeople);
    const parsedBudgetAmount = parseOptionalNumber(budgetAmount);
    const normalizedDeadline = normalizeDateInput(eventDeadline);
    if (!title.trim()) {
      Alert.alert('新活動', '請輸入活動主題。');
      return;
    }
    if (!timeBlock.trim()) {
      Alert.alert('新活動', '請至少選擇一個時段。');
      return;
    }
    if (selectedDates.length === 0) {
      Alert.alert('新活動', '請先選擇活動日期。');
      return;
    }
    if (selectedCircleIds.length === 0) {
      Alert.alert('新活動', '請至少選擇一個小圈。');
      return;
    }
    if (Number.isNaN(parsedMaxPeople) || Number.isNaN(parsedBudgetAmount)) {
      Alert.alert('新活動', '人數與預算請輸入數字。');
      return;
    }
    if (!normalizedDeadline) {
      Alert.alert('新活動', '報名截止日請輸入有效日期，例如 2026-05-29。');
      return;
    }
    if (selectedDates.length > 0 && normalizedDeadline > selectedDates[selectedDates.length - 1]) {
      Alert.alert('新活動', '報名截止日不可晚於活動日期。');
      return;
    }

    try {
      setBusy(true);
      let firstEventId: string | null = null;
      for (const eventDate of selectedDates) {
        for (const circleId of selectedCircleIds) {
          const eventId = await createEvent({
            title,
            eventDate,
            timeBlock,
            circleId,
            createdBy: userId,
            maxPeople: parsedMaxPeople,
            budgetType,
            budgetAmount: parsedBudgetAmount,
            description,
            eventDeadline: normalizedDeadline,
          });
          firstEventId = firstEventId ?? eventId;
        }
      }
      if (firstEventId) {
        onCreated(firstEventId);
      }
    } catch (err) {
      Alert.alert('建立失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>規劃新活動</Text>
        <Text style={styles.hint}>日期：{formatDateListLabel(selectedDates)}</Text>

        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="活動主題" editable={!busy} />
        <TimeBlockPicker value={timeBlock} onChange={setTimeBlock} disabled={busy} />
        <TextInput
          style={styles.input}
          value={maxPeople}
          onChangeText={(value) => setMaxPeople(formatIntegerInput(value))}
          placeholder="人數上限（可留空）"
          keyboardType="number-pad"
          editable={!busy}
        />
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segmentButton, budgetType === 'per_person' && styles.segmentButtonSelected]}
            onPress={() => setBudgetType('per_person')}
            disabled={busy}
          >
            <Text style={[styles.segmentText, budgetType === 'per_person' && styles.segmentTextSelected]}>
              單人
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentButton, budgetType === 'total' && styles.segmentButtonSelected]}
            onPress={() => setBudgetType('total')}
            disabled={busy}
          >
            <Text style={[styles.segmentText, budgetType === 'total' && styles.segmentTextSelected]}>
              總預算
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={budgetAmount}
          onChangeText={(value) => setBudgetAmount(formatIntegerInput(value))}
          placeholder={`${budgetType === 'per_person' ? '單人預算' : '總預算'}（可留空）`}
          keyboardType="number-pad"
          editable={!busy}
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="活動說明（可留空）"
          editable={!busy}
          multiline
        />
        <TextInput
          style={styles.input}
          value={eventDeadline}
          onChangeText={setEventDeadline}
          placeholder="報名截止日（必填，YYYY-MM-DD）"
          placeholderTextColor="#94a3b8"
          editable={!busy}
        />

        <CircleSearchMultiSelect
          title="小圈"
          circles={selectableCircles}
          selectedCircleIds={selectedCircleIds}
          onToggle={toggleCircle}
          disabled={busy}
          lockSelection={lockCircleSelection}
        />

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title={busy ? '建立中…' : '規劃新活動'} onPress={() => void handleCreate()} disabled={busy} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="取消" onPress={onCancel} disabled={busy} color="#64748b" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export function CreateCircleScreen({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (circleName: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [circleName, setCircleName] = useState('');

  const handleCreate = async () => {
    if (!circleName.trim()) {
      Alert.alert('新增密友圈', '請輸入圈名。');
      return;
    }
    await onCreate(circleName.trim());
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>新增密友圈</Text>
        <Text style={styles.hint}>建立後會進入邀請密友流程，可用 LINE、Email 或系統分享。</Text>
        <TextInput
          style={styles.input}
          value={circleName}
          onChangeText={setCircleName}
          placeholder="圈名"
          editable={!busy}
        />
        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title={busy ? '建立中…' : '建立'} onPress={() => void handleCreate()} disabled={busy} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="取消" onPress={onCancel} disabled={busy} color="#64748b" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export function SlotsScreen({
  userId,
  circles,
  locallyReadDiscussionKeys = {},
  onOpenSlot,
  onBack,
}: {
  userId: string;
  circles: CircleSummary[];
  locallyReadDiscussionKeys?: Record<string, true>;
  onOpenSlot: (slotId: string, dateRange?: { startDate: string; endDate: string }, unreadCount?: number, relatedSlotIds?: string[]) => void;
  onBack: () => void;
}) {
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [discussionSummaries, setDiscussionSummaries] = useState<Map<string, DiscussionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listVisibleSlotsForUser(userId);
        const targets = rows.flatMap((slot) => slotDiscussionTargetsForUser(slot, userId));
        const summaries = await listDiscussionSummaries(
          userId,
          targets,
        );
        if (!cancelled) {
          setSlots(rows);
          setDiscussionSummaries(summaries);
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatErrorMessage(err));
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
  }, [userId]);

  const groupedSlots = groupSlotsForBoard(slots.filter((slot) => (
    slot.status !== 'cancelled' && !isSlotExpired(slot)
  )));

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>悠閒時光看板</Text>
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && groupedSlots.length === 0 ? <EmptyText>尚無可看見的悠閒時光</EmptyText> : null}
        {groupedSlots.map((slot) => {
          const groupedSourceSlots = slot.slotIds
            .map((slotId) => slots.find((item) => item.id === slotId))
            .filter((item): item is SlotSummary => Boolean(item));
          const groupedBookings = groupedSourceSlots.flatMap((item) => item.activeBookings);
          const ownsGroupedSlot = groupedSourceSlots.some((item) => item.createdBy === userId);
          const displayBookings = ownsGroupedSlot
            ? groupedBookings
            : groupedBookings.filter((booking) => booking.requestedBy === userId);
          const requestedBookingUserIds = Array.from(new Set(
            displayBookings
              .filter((booking) => booking.status === 'requested')
              .map((booking) => booking.requestedBy),
          ));
          const acceptedBookingLabels = Array.from(new Set(
            displayBookings
              .filter((booking) => booking.status === 'accepted')
              .map((booking) => booking.requesterLabel),
          ));
          const hasBookingBadge = requestedBookingUserIds.length > 0 || acceptedBookingLabels.length > 0;
          const unreadCountBySlotId = new Map(slot.slotIds.map((slotId) => {
            const sourceSlot = slots.find((item) => item.id === slotId);
            const targets = sourceSlot ? slotDiscussionTargetsForUser(sourceSlot, userId) : [];
            const count = targets.reduce(
              (total, target) => {
                const key = discussionKey(target.scope, target.targetId);
                return total + (locallyReadDiscussionKeys[key] ? 0 : discussionSummaries.get(key)?.unreadCount ?? 0);
              },
              0,
            );
            const hasMessages = targets.some((target) => Boolean(discussionSummaries.get(discussionKey(target.scope, target.targetId))?.lastMessageAt));
            return [slotId, { count, hasMessages }] as const;
          }));
          const unreadCount = Array.from(unreadCountBySlotId.values()).reduce((total, item) => total + item.count, 0);
          const slotIdToOpen = slot.slotIds.find((slotId) => (unreadCountBySlotId.get(slotId)?.count ?? 0) > 0)
            ?? slot.slotIds.find((slotId) => unreadCountBySlotId.get(slotId)?.hasMessages)
            ?? slot.firstSlotId;
          const relatedTargetIds = Array.from(new Set(
            groupedSourceSlots.flatMap((sourceSlot) => (
              slotDiscussionTargetsForUser(sourceSlot, userId).map((target) => target.targetId)
            )),
          ));
          return (
            <TouchableOpacity
              key={slot.firstSlotId}
              style={[styles.card, unreadCount || hasBookingBadge ? styles.unreadCard : null]}
              onPress={() => onOpenSlot(
                slotIdToOpen,
                { startDate: slot.startDate, endDate: slot.endDate },
                unreadCount,
                relatedTargetIds.length ? relatedTargetIds : slot.slotIds,
              )}
            >
              <Text style={styles.cardTitle}>
                {slot.createdByLabel} · {formatDateRangeLabel(slot.startDate, slot.endDate)} · {slot.timeBlock}
                {slot.note ? ` · ${slot.note}` : ''}
              </Text>
              {requestedBookingUserIds.length > 0 ? (
                <Text style={styles.requestedBookingBadge}>預約 {requestedBookingUserIds.length}</Text>
              ) : null}
              {acceptedBookingLabels.length > 0 ? (
                <Text style={styles.bookingBadge}>已約（{acceptedBookingLabels.join('、')}）</Text>
              ) : null}
              {unreadCount ? <Text style={styles.unreadText}>新對話 {unreadCount}</Text> : null}
            </TouchableOpacity>
          );
        })}
        <View style={styles.buttonGap}>
          <Button title="返回首頁" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function EventsScreen({
  userId,
  circles,
  onOpenEvent,
  onBack,
}: {
  userId: string;
  circles: CircleSummary[];
  onOpenEvent: (eventId: string, dateRange?: { startDate: string; endDate: string }, unreadCount?: number, relatedEventIds?: string[]) => void;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [discussionSummaries, setDiscussionSummaries] = useState<Map<string, DiscussionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listVisibleEventsForUser(userId);
        const summaries = await listDiscussionSummaries(
          userId,
          rows.map((event) => ({ scope: 'event', targetId: event.id })),
        );
        if (!cancelled) {
          setEvents(rows);
          setDiscussionSummaries(summaries);
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatErrorMessage(err));
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
  }, [userId]);

  const groupedEvents = groupEventsForBoard(events.filter(isEventRecruitingVisible));

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>活動揪人看板</Text>
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && groupedEvents.length === 0 ? <EmptyText>尚無活動</EmptyText> : null}
        {groupedEvents.map((event) => {
          const unreadCount = event.eventIds.reduce(
            (total, eventId) => total + (discussionSummaries.get(discussionKey('event', eventId))?.unreadCount ?? 0),
            0,
          );
          const eventIdToOpen = event.eventIds.find((eventId) => (
            (discussionSummaries.get(discussionKey('event', eventId))?.unreadCount ?? 0) > 0
          )) ?? event.eventIds.find((eventId) => Boolean(discussionSummaries.get(discussionKey('event', eventId))?.lastMessageAt)) ?? event.firstEventId;
          return (
            <TouchableOpacity
              key={event.firstEventId}
              style={[styles.card, unreadCount ? styles.unreadCard : null]}
              onPress={() => onOpenEvent(eventIdToOpen, { startDate: event.startDate, endDate: event.endDate }, unreadCount, event.eventIds)}
            >
              <Text style={styles.cardTitle}>{event.title}</Text>
              {unreadCount ? <Text style={styles.unreadText}>新對話 {unreadCount}</Text> : null}
              <Text style={styles.cardLine}>{formatDateRangeLabel(event.startDate, event.endDate)} · {event.timeBlock}</Text>
              {event.eventDeadline ? (
                <Text style={styles.cardLine}>向隅時間：{formatDateLabel(event.eventDeadline)}</Text>
              ) : null}
              <Text style={styles.cardLine}>主揪：{event.createdByLabel}</Text>
              <Text style={styles.cardLine}>小圈：{circleNameById(circles, event.circleRef)}</Text>
              <Text style={styles.cardLine}>
                參加：{formatNumberWithCommas(event.participantCount)}
                {event.maxPeople ? ` / ${formatNumberWithCommas(event.maxPeople)}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={styles.buttonGap}>
          <Button title="返回首頁" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function CirclesScreen({
  circles,
  circleUnreadCounts,
  onOpenCircle,
  onBack,
}: {
  circles: CircleSummary[];
  circleUnreadCounts: Record<string, number>;
  onOpenCircle: (circleId: string, activityUnreadCount?: number) => void;
  onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>我的密友圈</Text>
        {circles.length === 0 ? <EmptyText>尚無可進入的密友圈</EmptyText> : null}
        {circles.map((circle) => {
          const unreadCount = circleUnreadCounts[circle.id] ?? 0;
          return (
            <TouchableOpacity key={circle.id} style={[styles.card, unreadCount ? styles.unreadCard : null]} onPress={() => onOpenCircle(circle.id, unreadCount)}>
              <Text style={styles.cardTitle}>{circle.circleName}</Text>
              {unreadCount ? <Text style={styles.unreadText}>活動新對話 {unreadCount}</Text> : null}
              <Text style={styles.cardLine}>
                成員 {circle.memberCount}
                {circle.ownerLabel ? ` · 圈主：${circle.ownerLabel}` : ''}
              </Text>
              {circle.memberLabels.length > 0 ? (
                <Text style={styles.cardLine}>成員：{circle.memberLabels.join('、')}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
        <View style={styles.buttonGap}>
          <Button title="返回首頁" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function SlotDetailScreen({
  slotId,
  userId,
  circles,
  contextCircleId,
  displayDateRange,
  unreadRefreshKey = 0,
  unreadCountOverride = 0,
  suppressUnread = false,
  locallyReadDiscussionKeys = {},
  onOpenDiscussion,
  onBookingChanged,
  onBack,
}: {
  slotId: string;
  userId: string;
  circles: CircleSummary[];
  contextCircleId?: string | null;
  displayDateRange?: { startDate: string; endDate: string } | null;
  unreadRefreshKey?: number;
  unreadCountOverride?: number;
  suppressUnread?: boolean;
  locallyReadDiscussionKeys?: Record<string, true>;
  onOpenDiscussion: (targetId: string, title: string, subtitle?: string, relatedTargetIds?: string[]) => void;
  onBookingChanged?: () => void;
  onBack: () => void;
}) {
  const [slot, setSlot] = useState<SlotDetail | null>(null);
  const [availableSlots, setAvailableSlots] = useState<SlotSummary[]>([]);
  const [discussionSummary, setDiscussionSummary] = useState<DiscussionSummary | null>(null);
  const [existingDiscussionTargetId, setExistingDiscussionTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingDiscussion, setOpeningDiscussion] = useState(false);
  const [pendingBookingActionId, setPendingBookingActionId] = useState<string | null>(null);
  const [showBookingList, setShowBookingList] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [row, visibleSlotRows] = await Promise.all([
        getSlotDetail(slotId),
        listVisibleSlotsForUser(userId),
      ]);
      const targets = row ? slotDiscussionTargetsForUser(row, userId) : [];
      const summaries = await listDiscussionSummaries(userId, targets);
      const aggregateSummary: DiscussionSummary = {
        scope: 'slot',
        targetId: slotId,
        lastMessageAt: null,
        lastMessageBody: null,
        hasOtherSender: false,
        unreadCount: 0,
      };
      for (const target of targets) {
        const summary = summaries.get(discussionKey(target.scope, target.targetId));
        if (!summary) {
          continue;
        }
        const hasBeenLocallyRead = Boolean(locallyReadDiscussionKeys[discussionKey(target.scope, target.targetId)]);
        aggregateSummary.lastMessageAt = summary.lastMessageAt ?? aggregateSummary.lastMessageAt;
        aggregateSummary.lastMessageBody = summary.lastMessageBody ?? aggregateSummary.lastMessageBody;
        aggregateSummary.hasOtherSender = aggregateSummary.hasOtherSender || summary.hasOtherSender;
        aggregateSummary.unreadCount += hasBeenLocallyRead ? 0 : summary.unreadCount;
      }
      const unreadTarget = targets.find((target) => (
        !locallyReadDiscussionKeys[discussionKey(target.scope, target.targetId)]
        && (summaries.get(discussionKey(target.scope, target.targetId))?.unreadCount ?? 0) > 0
      ));
      const messagedTarget = targets.find((target) => (
        Boolean(summaries.get(discussionKey(target.scope, target.targetId))?.lastMessageAt)
      ));
      setSlot(row);
      setAvailableSlots(visibleSlotRows);
      setDiscussionSummary(aggregateSummary);
      setExistingDiscussionTargetId(unreadTarget?.targetId ?? messagedTarget?.targetId ?? null);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slotId, userId, unreadRefreshKey, locallyReadDiscussionKeys]);

  const openSlotDiscussion = async (participantIds: string[], title: string, subtitle: string, firstMessage?: string) => {
    if (!slot) {
      return;
    }
    try {
      setOpeningDiscussion(true);
      const targetId = slotDiscussionTargetId(slot.id, participantIds);
      await ensureSlotDiscussionParticipants({ slotId: slot.id, targetId, participantIds });
      if (firstMessage) {
        await createDiscussionMessage({ scope: 'slot', targetId, senderId: userId, body: firstMessage });
      }
      onOpenDiscussion(targetId, title, subtitle, [targetId]);
    } catch (err) {
      Alert.alert('開啟私聊失敗', formatErrorMessage(err));
    } finally {
      setOpeningDiscussion(false);
    }
  };

  const openExistingSlotDiscussion = (targetId: string, title: string, subtitle: string) => {
    onOpenDiscussion(targetId, title, subtitle, [targetId]);
  };

  const sendSlotAutoMessage = async (booking: SlotBooking, body: string) => {
    if (!slot) {
      return;
    }
    const participantIds = [slot.createdBy, booking.requestedBy];
    const targetId = slotDiscussionTargetId(slot.id, participantIds);
    await ensureSlotDiscussionParticipants({ slotId: slot.id, targetId, participantIds });
    await createDiscussionMessage({ scope: 'slot', targetId, senderId: userId, body });
  };

  const handleBook = async (circleId: string, message?: string) => {
    try {
      setBusy(true);
      await createSlotBooking({ slotId, circleId, requestedBy: userId, message });
      await load();
      onBookingChanged?.();
      Alert.alert('悠閒時光', message ? '已送出訊息。' : '已送出預約。');
    } catch (err) {
      Alert.alert('預約失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const handleCancelBooking = async (booking: SlotBooking) => {
    try {
      setBusy(true);
      if (booking.status === 'accepted') {
        await sendSlotAutoMessage(booking, '改天約囉');
      }
      await updateSlotBookingStatus(booking.id, 'cancelled');
      await load();
      onBookingChanged?.();
      Alert.alert('悠閒時光', booking.status === 'accepted' ? '已取消這次預約，並傳送「改天約囉」。' : '已取消這次預約。');
    } catch (err) {
      Alert.alert('取消失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const handleAcceptBooking = async (booking: SlotBooking) => {
    try {
      setPendingBookingActionId(booking.id);
      setBusy(true);
      await updateSlotBookingStatus(booking.id, 'accepted');
      await sendSlotAutoMessage({ ...booking, status: 'accepted' }, '見面聊');
      await load();
      onBookingChanged?.();
      Alert.alert('悠閒時光', `已和 ${booking.requesterLabel} 約好，並傳送「見面聊」。`);
    } catch (err) {
      Alert.alert('更新失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
      setPendingBookingActionId(null);
    }
  };
  const handleDeclineBooking = async (booking: SlotBooking) => {
    try {
      setPendingBookingActionId(booking.id);
      setBusy(true);
      await sendSlotAutoMessage(booking, '改天約囉');
      await updateSlotBookingStatus(booking.id, booking.status === 'accepted' ? 'cancelled' : 'declined');
      await load();
      onBookingChanged?.();
      Alert.alert('悠閒時光', `已回覆 ${booking.requesterLabel}「改天約囉」。`);
    } catch (err) {
      Alert.alert('更新失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
      setPendingBookingActionId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.hint}>載入悠閒時光…</Text>
      </View>
    );
  }

  if (error || !slot) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? '找不到悠閒時光'}</Text>
        <Button title="返回" onPress={onBack} />
      </View>
    );
  }

  const visibleCircleIds = contextCircleId ? [contextCircleId] : slot.visibleCircleIds;
  const visibleCircles = visibleCircleIds
    .map((circleId) => circles.find((circle) => circle.id === circleId))
    .filter((circle): circle is CircleSummary => Boolean(circle));
  const bookingCircle = visibleCircles[0];
  const existingBooking = slot.bookings.find(
    (booking) => booking.requestedBy === userId && ['requested', 'accepted'].includes(booking.status),
  );
  const declinedBooking = slot.bookings.find(
    (booking) => booking.requestedBy === userId && booking.status === 'declined',
  );
  const cannotBookAfterDecline = Boolean(declinedBooking && !existingBooking);
  const activeBookings = slot.bookings.filter((booking) => ['requested', 'accepted'].includes(booking.status));
  const isOwner = slot.createdBy === userId;
  const slotClosed = slot.status === 'cancelled' || isSlotExpired(slot);
  const slotDateLabel = formatDateRangeLabel(displayDateRange?.startDate ?? slot.slotDate, displayDateRange?.endDate ?? slot.slotDate);
  const unreadDiscussionCount = suppressUnread ? 0 : Math.max(unreadCountOverride, discussionSummary?.unreadCount ?? 0);
  const discussionButtonTitle = unreadDiscussionCount > 0 ? `私聊？未讀 ${unreadDiscussionCount}` : '私聊？';
  const discussionButtonColor = unreadDiscussionCount > 0 ? '#dc2626' : '#7c3aed';
  const otherAvailableSlots = availableSlots.filter((item) => (
    item.id !== slot.id
    && item.slotDate === slot.slotDate
    && item.status !== 'cancelled'
    && item.createdBy !== userId
    && !isSlotExpired(item)
  ));
  const handleBookingPress = () => {
    if (isOwner) {
      if (activeBookings.length > 0) {
        setShowBookingList((current) => !current);
      }
      return;
    }
    if (existingBooking) {
      Alert.alert('悠閒時光', '要取消這次預約嗎？', [
        { text: '先不要', style: 'cancel' },
        { text: '改天約囉', style: 'destructive', onPress: () => void handleCancelBooking(existingBooking) },
      ]);
      return;
    }
    if (bookingCircle) {
      void handleBook(bookingCircle.id);
    }
  };
  const handleOpenDiscussion = () => {
    const subtitle = `${slotDateLabel} · ${slot.timeBlock}`;
    if (slot.createdBy !== userId) {
      if (existingDiscussionTargetId) {
        openExistingSlotDiscussion(existingDiscussionTargetId, `${slot.createdByLabel}的悠閒時光`, subtitle);
        return;
      }
      void openSlotDiscussion([slot.createdBy, userId], `${slot.createdByLabel}的悠閒時光`, subtitle);
      return;
    }
    if (activeBookings.length === 0) {
      if (existingDiscussionTargetId) {
        openExistingSlotDiscussion(existingDiscussionTargetId, `${slot.createdByLabel}的悠閒時光`, subtitle);
        return;
      }
      Alert.alert('悠閒時光', '悠閒時間自己的喔~無法自己對話');
      return;
    }
    const actions = activeBookings.map((booking) => ({
      text: booking.requesterLabel,
      onPress: () => void openSlotDiscussion(
        [slot.createdBy, booking.requestedBy],
        `${slot.createdByLabel} 與 ${booking.requesterLabel}`,
        subtitle,
      ),
    }));
    if (activeBookings.length > 1) {
      actions.push({
        text: '多人群聊',
        onPress: () => void openSlotDiscussion(
          [slot.createdBy, ...activeBookings.map((booking) => booking.requestedBy)],
          `${slot.createdByLabel}的悠閒時光群聊`,
          subtitle,
        ),
      });
    }
    Alert.alert('與誰私聊？', '請選擇聊天對象', [
      ...actions,
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>悠閒時光</Text>
        <Text style={styles.cardTitle}>
          {slot.createdByLabel} · {slotDateLabel} · {slot.timeBlock}
        </Text>
        {slot.note ? <Text style={styles.cardLine}>{slot.note}</Text> : null}
        <Text style={styles.cardLine}>{slotDetailStatusText(slot)}</Text>

        {!bookingCircle ? <EmptyText>沒有可連結的小圈</EmptyText> : null}
        {bookingCircle ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowBtn}>
                <Button
                  title={isOwner && activeBookings.length > 0 ? '誰約了？' : existingBooking ? '改天約囉' : '約'}
                  onPress={handleBookingPress}
                  disabled={busy || (isOwner && activeBookings.length === 0) || cannotBookAfterDecline || (!isOwner && !existingBooking && slotClosed)}
                />
              </View>
              <View style={styles.rowBtn}>
                <Button
                  title={discussionButtonTitle}
                  onPress={handleOpenDiscussion}
                  disabled={busy || openingDiscussion}
                  color={discussionButtonColor}
                />
              </View>
            </View>
          </View>
        ) : null}

        {isOwner && showBookingList ? (
          <>
            <Text style={styles.sectionTitle}>誰約了？</Text>
            {activeBookings.map((booking) => (
              (() => {
                const isActionPending = pendingBookingActionId === booking.id;
                const isActionDisabled = busy || Boolean(pendingBookingActionId);
                return (
                  <View key={booking.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{booking.requesterLabel}</Text>
                    <View style={styles.inlineActionRow}>
                      <Text style={styles.cardLine}>狀態：{booking.status === 'accepted' ? '已約' : '預約中'}</Text>
                      <View style={styles.compactActionGroup}>
                        <TouchableOpacity
                          style={[
                            styles.compactActionBtn,
                            (isActionPending || booking.status === 'accepted') && styles.compactActionDisabled,
                          ]}
                          onPress={() => void handleAcceptBooking(booking)}
                          disabled={isActionDisabled || booking.status === 'accepted'}
                        >
                          <Text style={styles.compactActionText}>約</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.compactActionBtn,
                            styles.compactActionSecondary,
                            isActionPending && styles.compactActionDisabled,
                          ]}
                          onPress={() => void handleDeclineBooking(booking)}
                          disabled={isActionDisabled}
                        >
                          <Text style={styles.compactActionText}>改天約囉</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })()
            ))}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>還有誰可約</Text>
        {otherAvailableSlots.length === 0 ? <EmptyText>當天沒有其他可約的悠閒時光</EmptyText> : null}
        {otherAvailableSlots.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.createdByLabel} · {item.timeBlock}</Text>
            {item.note ? <Text style={styles.cardLine}>{item.note}</Text> : null}
            <Text style={styles.cardLine}>可約</Text>
          </View>
        ))}

        <View style={styles.buttonGap}>
          <Button title="返回" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function EventDetailScreen({
  eventId,
  userId,
  circles,
  displayDateRange,
  unreadRefreshKey = 0,
  unreadCountOverride = 0,
  suppressUnread = false,
  onOpenDiscussion,
  onBack,
}: {
  eventId: string;
  userId: string;
  circles: CircleSummary[];
  displayDateRange?: { startDate: string; endDate: string } | null;
  unreadRefreshKey?: number;
  unreadCountOverride?: number;
  suppressUnread?: boolean;
  onOpenDiscussion: (title: string, subtitle?: string) => void;
  onBack: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [discussionSummary, setDiscussionSummary] = useState<DiscussionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [row, summaries] = await Promise.all([
        getEventDetail(eventId),
        listDiscussionSummaries(userId, [{ scope: 'event', targetId: eventId }]),
      ]);
      setEvent(row);
      setDiscussionSummary(summaries.get(discussionKey('event', eventId)) ?? null);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [eventId, userId, unreadRefreshKey]);

  const handleJoin = async (status: 'joined' | 'interested' | 'cancelled') => {
    try {
      setBusy(true);
      const existing = event?.participants.find((participant) => participant.userId === userId);
      if (existing) {
        await updateEventParticipantStatus({ eventId, userId, status });
      } else {
        await joinEvent({ eventId, userId, status });
      }
      await load();
    } catch (err) {
      Alert.alert('活動更新失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.hint}>載入活動…</Text>
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? '找不到活動'}</Text>
        <Button title="返回" onPress={onBack} />
      </View>
    );
  }

  const myParticipant = event.participants.find((participant) => participant.userId === userId);
  const isFull = Boolean(event.maxPeople && event.participantCount >= event.maxPeople && myParticipant?.status !== 'joined');
  const eventClosed = !isEventRecruitingVisible(event);
  const eventDateLabel = formatDateRangeLabel(displayDateRange?.startDate ?? event.eventDate, displayDateRange?.endDate ?? event.eventDate);
  const eventCircleName = circleNameById(circles, event.circleRef);
  const unreadDiscussionCount = suppressUnread ? 0 : Math.max(unreadCountOverride, discussionSummary?.unreadCount ?? 0);
  const discussionButtonTitle = unreadDiscussionCount > 0 ? `聊什麼？未讀 ${unreadDiscussionCount}` : '聊什麼？';
  const discussionButtonColor = unreadDiscussionCount > 0 ? '#dc2626' : '#7c3aed';

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.hint}>{eventDateLabel} · {event.timeBlock}</Text>
        <Text style={styles.cardLine}>小圈：{eventCircleName}</Text>
        {event.eventDeadline ? (
          <Text style={styles.cardLine}>向隅時間：{formatDateLabel(event.eventDeadline)}</Text>
        ) : null}
        <Text style={styles.cardLine}>主揪：{event.createdByLabel}</Text>
        <Text style={styles.cardLine}>狀態：{formatEventStatus(event)}</Text>
        <Text style={styles.cardLine}>
          參加：{formatNumberWithCommas(event.participantCount)}
          {event.maxPeople ? ` / ${formatNumberWithCommas(event.maxPeople)}` : ''}
        </Text>
        {event.budgetAmount != null ? (
          <Text style={styles.cardLine}>
            {event.budgetType === 'total' ? '總預算' : '單人預算'}：{formatNumberWithCommas(event.budgetAmount)}
          </Text>
        ) : null}
        {event.description ? <Text style={styles.cardLine}>說明：{event.description}</Text> : null}

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title="參加" onPress={() => void handleJoin('joined')} disabled={busy || isFull || eventClosed} />
          </View>
          <View style={styles.rowBtn}>
            <Button
              title={discussionButtonTitle}
              onPress={() => onOpenDiscussion(`${eventCircleName} ${event.title} 活動`, `${eventDateLabel} · ${event.timeBlock}`)}
              disabled={busy}
              color={discussionButtonColor}
            />
          </View>
        </View>
        {myParticipant && myParticipant.status !== 'cancelled' ? (
          <View style={styles.buttonGap}>
            <Button title="取消參加" onPress={() => void handleJoin('cancelled')} disabled={busy} color="#64748b" />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>成員</Text>
        {event.participants.length === 0 ? <EmptyText>尚無參加者</EmptyText> : null}
        {event.participants.map((participant) => (
          <View key={participant.userId} style={styles.compactRow}>
            <Text style={styles.cardLine}>{participant.userLabel}</Text>
            <Text style={styles.badge}>{statusLabel(participant.status)}</Text>
          </View>
        ))}

        <View style={styles.buttonGap}>
          <Button title="返回" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function DiscussionScreen({
  scope,
  targetId,
  userId,
  title,
  subtitle,
  targetBackLabel,
  relatedTargetIds = [],
  onHome,
  onBackToTarget,
  onRead,
}: {
  scope: DiscussionScope;
  targetId: string;
  userId: string;
  title: string;
  subtitle?: string;
  targetBackLabel: string;
  relatedTargetIds?: string[];
  onHome: () => void;
  onBackToTarget: () => void;
  onRead?: () => void;
}) {
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const scrollToLatestMessage = () => {
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollToEnd({ animated: true });
    });
  };
  const markRead = async (readMessages = messages) => {
    const targetIdsToRead = Array.from(new Set([targetId, ...relatedTargetIds]));
    onRead?.();
    try {
      await Promise.all(targetIdsToRead.map(async (id) => {
        const targetMessages = id === targetId ? readMessages : await listDiscussionMessages(scope, id);
        const latestMessageAt = targetMessages[targetMessages.length - 1]?.createdAt ?? null;
        await markDiscussionRead({ scope, targetId: id, userId, readAt: latestMessageAt });
      }));
    } catch (err) {
      if (__DEV__) {
        console.warn('[discussion-read]', err);
      }
    }
  };
  const handleHome = async () => {
    await markRead();
    onHome();
  };
  const handleBackToTarget = async () => {
    await markRead();
    onBackToTarget();
  };

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      try {
        setError(null);
        const rows = await listDiscussionMessages(scope, targetId);
        if (!cancelled) {
          setMessages(rows);
          scrollToLatestMessage();
          void markRead(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void loadMessages();
    const unsubscribe = subscribeToDiscussionMessages(scope, targetId, () => {
      void loadMessages();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [scope, targetId]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) {
      return;
    }

    try {
      setSending(true);
      await createDiscussionMessage({ scope, targetId, senderId: userId, body });
      setDraft('');
      const nextMessages = await listDiscussionMessages(scope, targetId);
      setMessages(nextMessages);
      scrollToLatestMessage();
      void markRead(nextMessages);
    } catch (err) {
      Alert.alert('訊息送出失敗', formatErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const counterpartLabels = Array.from(
    new Set(messages.filter((message) => message.senderId !== userId).map((message) => message.senderLabel)),
  );
  const latestCounterpartMessage = [...messages].reverse().find((message) => message.senderId !== userId);

  return (
    <View style={styles.discussionShell}>
      <View style={styles.discussionPanel}>
        <Text style={styles.discussionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.discussionSubtitle}>{subtitle}</Text> : null}
        <View style={styles.discussionMetaBox}>
          <Text style={styles.discussionMetaText}>
            對方：{counterpartLabels.length > 0 ? counterpartLabels.join('、') : '等待對方回覆'}
          </Text>
          {latestCounterpartMessage ? (
            <Text style={styles.discussionMetaText} numberOfLines={1}>
              對方最新訊息：{latestCounterpartMessage.body}
            </Text>
          ) : null}
        </View>

        <View style={styles.messageBox}>
          {loading ? <ActivityIndicator /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!loading && !error && messages.length === 0 ? <EmptyText>尚無訊息，開始聊天吧</EmptyText> : null}
          <ScrollView
            ref={messageScrollRef}
            contentContainerStyle={styles.messageListContent}
            onContentSizeChange={scrollToLatestMessage}
            onLayout={scrollToLatestMessage}
          >
            {messages.map((message) => {
              const isMine = message.senderId === userId;
              return (
                <View key={message.id} style={[styles.messageBubble, isMine ? styles.messageBubbleMine : styles.messageBubbleOther]}>
                  <Text style={styles.messageSender}>{message.senderLabel}{isMine ? '（我）' : ''}</Text>
                  <Text style={styles.messageBody}>{message.body}</Text>
                  <Text style={styles.messageTime} numberOfLines={1}>{formatMessageTime(message.createdAt)}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        <TextInput
          style={[styles.input, styles.discussionInput]}
          value={draft}
          onChangeText={setDraft}
          placeholder="輸入訊息..."
          multiline
        />
        <Button title={sending ? '送出中...' : 'Send'} onPress={() => void handleSend()} disabled={sending || !draft.trim()} />
        <Text style={styles.realtimeHint}>即時更新</Text>

        <View style={styles.discussionNav}>
          <TouchableOpacity style={styles.discussionNavButton} onPress={() => void handleHome()}>
            <Text style={styles.discussionNavIcon}>HOME</Text>
            <Text style={styles.discussionNavText}>首頁</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.discussionNavButton} onPress={() => void handleBackToTarget()}>
            <Text style={styles.discussionNavIcon}>BACK</Text>
            <Text style={styles.discussionNavText}>{targetBackLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    color: '#1e293b',
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
  },
  error: {
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  empty: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 12,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekCell: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  calendarBox: {
    width: '100%',
    alignSelf: 'stretch',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  dayCellBlank: {
    backgroundColor: '#f8fafc',
  },
  dayCellSelected: {
    backgroundColor: '#2563eb',
  },
  dayText: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '600',
  },
  dayTextSelected: {
    color: '#ffffff',
  },
  calendarHint: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  selectedDateLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 15,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '700',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1e293b',
  },
  timePresetWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  timePreset: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  timePresetSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  timePresetText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  timePresetTextSelected: {
    color: '#1d4ed8',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  segmentButtonSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  segmentText: {
    color: '#475569',
    fontWeight: '700',
  },
  segmentTextSelected: {
    color: '#1d4ed8',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  sectionTitle: {
    fontWeight: '700',
    color: '#334155',
    marginTop: 8,
    marginBottom: 8,
  },
  choiceRow: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  choiceRowSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#f5f3ff',
  },
  choiceText: {
    color: '#334155',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  rowBtn: {
    flex: 1,
  },
  inlineActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactActionGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  compactActionBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  compactActionSecondary: {
    backgroundColor: '#64748b',
  },
  compactActionDisabled: {
    opacity: 0.45,
  },
  compactActionText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  buttonGap: {
    marginTop: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  unreadCard: {
    borderColor: '#f97316',
    backgroundColor: '#fff7ed',
  },
  unreadText: {
    alignSelf: 'flex-start',
    backgroundColor: '#f97316',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bookingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requestedBookingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f97316',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  cardLine: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
  },
  discussionShell: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  discussionPanel: {
    flex: 1,
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
  },
  discussionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#a855f7',
    textAlign: 'center',
    marginBottom: 4,
  },
  discussionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 8,
  },
  discussionMetaBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    padding: 8,
    marginBottom: 8,
  },
  discussionMetaText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  messageBox: {
    flex: 1,
    minHeight: 160,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    padding: 8,
    marginBottom: 8,
  },
  messageListContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  messageBubble: {
    maxWidth: '96%',
    minWidth: 120,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  messageBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#eff6ff',
  },
  messageBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
  },
  messageSender: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 2,
  },
  messageBody: {
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
  },
  messageTime: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'right',
  },
  discussionInput: {
    minHeight: 62,
    maxHeight: 92,
    textAlignVertical: 'top',
  },
  realtimeHint: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  discussionNav: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  discussionNavButton: {
    flex: 1,
    alignItems: 'center',
  },
  discussionNavIcon: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 12,
  },
  discussionNavText: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 8,
  },
  badge: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '700',
  },
});
