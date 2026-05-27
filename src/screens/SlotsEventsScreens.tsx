import { useEffect, useMemo, useState } from 'react';
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

type CreateMode = 'slot' | 'event';

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

        <Text style={styles.sectionTitle}>顯示給哪些小圈</Text>
        {selectableCircles.length === 0 ? (
          <EmptyText>尚無可選小圈</EmptyText>
        ) : (
          selectableCircles.map((circle) => (
            <TouchableOpacity
              key={circle.id}
              style={[styles.choiceRow, selectedCircleIds.includes(circle.id) && styles.choiceRowSelected]}
              onPress={() => toggleCircle(circle.id)}
              disabled={busy || Boolean(lockCircleSelection)}
            >
              <Text style={styles.choiceText}>
                {selectedCircleIds.includes(circle.id) ? '✓ ' : ''}
                {circle.circleName}
              </Text>
            </TouchableOpacity>
          ))
        )}

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

        <Text style={styles.sectionTitle}>小圈</Text>
        {selectableCircles.map((circle) => (
          <TouchableOpacity
            key={circle.id}
            style={[styles.choiceRow, selectedCircleIds.includes(circle.id) && styles.choiceRowSelected]}
            onPress={() => toggleCircle(circle.id)}
            disabled={busy || Boolean(lockCircleSelection)}
          >
            <Text style={styles.choiceText}>
              {selectedCircleIds.includes(circle.id) ? '✓ ' : ''}
              {circle.circleName}
            </Text>
          </TouchableOpacity>
        ))}

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
  onOpenSlot,
  onBack,
}: {
  userId: string;
  circles: CircleSummary[];
  onOpenSlot: (slotId: string) => void;
  onBack: () => void;
}) {
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listVisibleSlotsForUser(userId);
        if (!cancelled) {
          setSlots(rows);
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

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>悠閒時光看板</Text>
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && slots.length === 0 ? <EmptyText>尚無可看見的悠閒時光</EmptyText> : null}
        {slots.map((slot) => (
          <TouchableOpacity key={slot.id} style={styles.card} onPress={() => onOpenSlot(slot.id)}>
            <Text style={styles.cardTitle}>{slot.createdByLabel} · {formatDateLabel(slot.slotDate)} · {slot.timeBlock}</Text>
            <Text style={styles.cardLine}>狀態：{statusLabel(slot.status)}</Text>
            <Text style={styles.cardLine}>小圈：{slot.visibleCircleIds.map((id) => circleNameById(circles, id)).join('、')}</Text>
            {slot.note ? <Text style={styles.cardLine}>有話要說：{slot.note}</Text> : null}
          </TouchableOpacity>
        ))}
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
  onOpenEvent: (eventId: string) => void;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listVisibleEventsForUser(userId);
        if (!cancelled) {
          setEvents(rows);
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

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>活動看板</Text>
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && events.length === 0 ? <EmptyText>尚無活動</EmptyText> : null}
        {events.map((event) => (
          <TouchableOpacity key={event.id} style={styles.card} onPress={() => onOpenEvent(event.id)}>
            <Text style={styles.cardTitle}>{event.title}</Text>
            <Text style={styles.cardLine}>{formatDateLabel(event.eventDate)} · {event.timeBlock}</Text>
            <Text style={styles.cardLine}>小圈：{circleNameById(circles, event.circleRef)}</Text>
            <Text style={styles.cardLine}>
              參加：{formatNumberWithCommas(event.participantCount)}
              {event.maxPeople ? ` / ${formatNumberWithCommas(event.maxPeople)}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.buttonGap}>
          <Button title="返回首頁" onPress={onBack} color="#64748b" />
        </View>
      </View>
    </ScrollView>
  );
}

export function CirclesScreen({
  circles,
  onOpenCircle,
  onBack,
}: {
  circles: CircleSummary[];
  onOpenCircle: (circleId: string) => void;
  onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>我的密友圈</Text>
        {circles.length === 0 ? <EmptyText>尚無可進入的密友圈</EmptyText> : null}
        {circles.map((circle) => (
          <TouchableOpacity key={circle.id} style={styles.card} onPress={() => onOpenCircle(circle.id)}>
            <Text style={styles.cardTitle}>{circle.circleName}</Text>
            <Text style={styles.cardLine}>
              {circle.role === 'owner' ? '圈主' : '成員'} · 成員 {circle.memberCount}
              {circle.ownerLabel ? ` · 圈主：${circle.ownerLabel}` : ''}
            </Text>
            {circle.memberLabels.length > 0 ? (
              <Text style={styles.cardLine}>成員：{circle.memberLabels.join('、')}</Text>
            ) : null}
          </TouchableOpacity>
        ))}
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
  onBack,
}: {
  slotId: string;
  userId: string;
  circles: CircleSummary[];
  contextCircleId?: string | null;
  onBack: () => void;
}) {
  const [slot, setSlot] = useState<SlotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await getSlotDetail(slotId);
      setSlot(row);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slotId]);

  const handleBook = async (circleId: string, message?: string) => {
    try {
      setBusy(true);
      await createSlotBooking({ slotId, circleId, requestedBy: userId, message });
      await load();
      Alert.alert('悠閒時光', message ? '已送出先聊聊。' : '已送出預約。');
    } catch (err) {
      Alert.alert('預約失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleBookingStatus = async (bookingId: string, status: 'accepted' | 'declined' | 'cancelled') => {
    try {
      setBusy(true);
      await updateSlotBookingStatus(bookingId, status);
      await load();
    } catch (err) {
      Alert.alert('更新失敗', formatErrorMessage(err));
    } finally {
      setBusy(false);
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
  const existingBooking = slot.bookings.find((booking) => booking.requestedBy === userId && booking.status !== 'cancelled');

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>悠閒時光</Text>
        <Text style={styles.cardLine}>誰約的：{slot.createdByLabel}</Text>
        <Text style={styles.cardLine}>約的時間：{formatDateLabel(slot.slotDate)} · {slot.timeBlock}</Text>
        <Text style={styles.cardLine}>有話要說：{slot.note || '無'}</Text>
        <Text style={styles.cardLine}>狀態：{statusLabel(slot.status)}</Text>

        <Text style={styles.sectionTitle}>誰想約這個時間</Text>
        <Text style={styles.cardLine}>可自行點「約」或「先聊聊」；不想約可略過。</Text>
        {!bookingCircle ? <EmptyText>沒有可連結的小圈</EmptyText> : null}
        {bookingCircle ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowBtn}>
                <Button
                  title={existingBooking ? '已送出' : '約'}
                  onPress={() => void handleBook(bookingCircle.id)}
                  disabled={busy || Boolean(existingBooking) || slot.createdBy === userId}
                />
              </View>
              <View style={styles.rowBtn}>
                <Button
                  title="先聊聊"
                  onPress={() => void handleBook(bookingCircle.id, '先聊聊')}
                  disabled={busy || Boolean(existingBooking) || slot.createdBy === userId}
                  color="#7c3aed"
                />
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>預約紀錄</Text>
        {slot.bookings.length === 0 ? <EmptyText>尚無預約</EmptyText> : null}
        {slot.bookings.map((booking) => (
          <View key={booking.id} style={styles.card}>
            <Text style={styles.cardTitle}>{booking.requesterLabel}</Text>
            <Text style={styles.cardLine}>小圈：{circleNameById(circles, booking.circleRef)}</Text>
            <Text style={styles.cardLine}>狀態：{statusLabel(booking.status)}</Text>
            {booking.message ? <Text style={styles.cardLine}>留言：{booking.message}</Text> : null}
            {slot.createdBy === userId && booking.status === 'requested' ? (
              <View style={styles.row}>
                <View style={styles.rowBtn}>
                  <Button title="接受" onPress={() => void handleBookingStatus(booking.id, 'accepted')} disabled={busy} />
                </View>
                <View style={styles.rowBtn}>
                  <Button title="婉拒" onPress={() => void handleBookingStatus(booking.id, 'declined')} disabled={busy} color="#64748b" />
                </View>
              </View>
            ) : null}
            {booking.requestedBy === userId && booking.status === 'requested' ? (
              <View style={styles.buttonGap}>
                <Button title="取消預約" onPress={() => void handleBookingStatus(booking.id, 'cancelled')} disabled={busy} color="#64748b" />
              </View>
            ) : null}
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
  onBack,
}: {
  eventId: string;
  userId: string;
  circles: CircleSummary[];
  onBack: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await getEventDetail(eventId);
      setEvent(row);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [eventId]);

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

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.hint}>{formatDateLabel(event.eventDate)} · {event.timeBlock}</Text>
        <Text style={styles.cardLine}>小圈：{circleNameById(circles, event.circleRef)}</Text>
        <Text style={styles.cardLine}>狀態：{statusLabel(event.status)}</Text>
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
            <Button title="參加" onPress={() => void handleJoin('joined')} disabled={busy || isFull} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="先聊聊" onPress={() => void handleJoin('interested')} disabled={busy} color="#7c3aed" />
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
