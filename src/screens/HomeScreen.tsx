import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CircleSummary } from '../lib/circleAccess';

type HomeScreenProps = {
  userLabel: string;
  circles: CircleSummary[];
  circleUnreadCounts: Record<string, number>;
  activityUnreadCount: number;
  slotUnreadCount: number;
  requestedSlotCount: number;
  bookedSlotCount: number;
  circlesLoading: boolean;
  circlesError: string | null;
  onOpenCircle: (circleId: string, activityUnreadCount?: number) => void;
  onCreateSlot: () => void;
  onCreateEvent: () => void;
  onCreateCircle: () => void;
  onOpenWhoAmI: () => void;
  onOpenCircles: () => void;
  onOpenSlots: () => void;
  onOpenEvents: () => void;
  onSignOut: () => void;
};

export function HomeScreen({
  userLabel,
  circles,
  circleUnreadCounts,
  activityUnreadCount,
  slotUnreadCount,
  requestedSlotCount,
  bookedSlotCount,
  circlesLoading,
  circlesError,
  onOpenCircle,
  onCreateSlot,
  onCreateEvent,
  onCreateCircle,
  onOpenWhoAmI,
  onOpenCircles,
  onOpenSlots,
  onOpenEvents,
  onSignOut,
}: HomeScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.panel}>
        <Text style={styles.title}>首頁</Text>
        <Text style={styles.subtitle}>{userLabel}</Text>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>小型回顧</Text>
          <Text style={styles.placeholderMuted}>投片或相片占位</Text>
        </View>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>活動時間軸</Text>
          <Text style={styles.placeholderMuted}>即將到來的活動…</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>最新活動訊息</Text>
          <TouchableOpacity onPress={onOpenEvents}>
            <Text style={styles.linkLine}>查看活動揪人看板</Text>
          </TouchableOpacity>
          {activityUnreadCount > 0 ? (
            <TouchableOpacity onPress={onOpenEvents}>
              <Text style={styles.privateUnreadText}>活動新對話 {activityUnreadCount}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onOpenSlots}>
            <Text style={styles.linkLine}>查看悠閒時光看板</Text>
          </TouchableOpacity>
          {requestedSlotCount > 0 ? (
            <TouchableOpacity onPress={onOpenSlots}>
              <Text style={styles.bookingText}>預約 {requestedSlotCount}</Text>
            </TouchableOpacity>
          ) : null}
          {bookedSlotCount > 0 ? (
            <TouchableOpacity onPress={onOpenSlots}>
              <Text style={styles.bookingText}>已約 {bookedSlotCount}</Text>
            </TouchableOpacity>
          ) : null}
          {slotUnreadCount > 0 ? (
            <TouchableOpacity onPress={onOpenSlots}>
              <Text style={styles.privateUnreadText}>私聊新對話 {slotUnreadCount}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.circleSection}>
          <Text style={styles.section}>我的密友圈</Text>
          {circlesLoading ? (
            <ActivityIndicator style={styles.circleLoader} />
          ) : circlesError ? (
            <Text style={styles.circleError}>{circlesError}</Text>
          ) : circles.length === 0 ? (
            <Text style={styles.listItem}>尚無可進入的密友圈</Text>
          ) : (
            circles.map((circle) => {
              const unreadCount = circleUnreadCounts[circle.id] ?? 0;
              return (
              <TouchableOpacity
                key={circle.id}
                style={styles.circleRow}
                onPress={() => onOpenCircle(circle.id, unreadCount)}
              >
                <Text style={styles.circleName}>
                  {circle.circleName}（{circle.memberCount}）
                </Text>
                <Text style={styles.circleRole}>
                  圈主{circle.ownerLabel ? `：${circle.ownerLabel}` : ''}
                </Text>
                {circle.memberLabels.length > 0 ? (
                  <Text style={styles.circleMembers} numberOfLines={2}>
                    成員：{circle.memberLabels.join('、')}
                  </Text>
                ) : null}
              </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.fabRow}>
          <TouchableOpacity style={styles.fab} onPress={onCreateSlot}>
            <View style={styles.fabLabelRow}>
              <View style={styles.fabSymbolStack}>
                <Text style={styles.fabSymbol}>+</Text>
                <Text style={styles.fabSymbol}>-</Text>
              </View>
              <Text style={styles.fabText}>悠閒時光</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={onCreateEvent}>
            <Text style={styles.fabText}>+ 新活動</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={onCreateCircle}>
            <Text style={styles.fabText}>+ 新密友圈</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.fab, styles.whoAmIFab]} onPress={onOpenWhoAmI}>
            <Text style={[styles.fabText, styles.whoAmIFabText]}>Who am I</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabItem} onPress={onOpenCircles}>
            <Text style={styles.tabIcon}>⌂</Text>
            <Text style={styles.tabLabel}>圈</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={onOpenSlots}>
            <Text style={styles.tabIcon}>○</Text>
            <Text style={styles.tabLabel}>slot</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={onOpenEvents}>
            <Text style={styles.tabIcon}>□</Text>
            <Text style={styles.tabLabel}>events</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={onSignOut}>
            <Text style={styles.tabIcon}>↪</Text>
            <Text style={styles.tabLabel}>logout</Text>
          </TouchableOpacity>
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
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
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
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  cardTitle: {
    fontWeight: '600',
    marginBottom: 6,
  },
  cardLine: {
    fontSize: 13,
    color: '#475569',
  },
  linkLine: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
    marginTop: 6,
  },
  section: {
    fontWeight: '600',
    marginBottom: 8,
    color: '#334155',
  },
  circleSection: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  listItem: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 6,
  },
  circleRow: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  privateUnreadText: {
    alignSelf: 'flex-start',
    backgroundColor: '#dc2626',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bookingText: {
    alignSelf: 'flex-start',
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  circleName: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '700',
  },
  circleRole: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
  },
  circleMembers: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    lineHeight: 17,
  },
  circleLoader: {
    marginVertical: 8,
  },
  circleError: {
    fontSize: 13,
    color: '#b91c1c',
    marginBottom: 8,
  },
  fabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 16,
  },
  fab: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: '47%',
    alignItems: 'center',
  },
  fabLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  fabSymbolStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSymbol: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 11,
  },
  fabText: {
    fontSize: 12,
    color: '#64748b',
  },
  whoAmIFab: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  whoAmIFabText: {
    color: '#c2410c',
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
    marginBottom: 16,
  },
  tabItem: {
    alignItems: 'center',
  },
  tabIcon: {
    fontSize: 16,
    color: '#94a3b8',
  },
  tabLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
});
