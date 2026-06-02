import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CircleSummary } from '../lib/circleAccess';

type HomeScreenProps = {
  userLabel: string;
  circles: CircleSummary[];
  circlesLoading: boolean;
  circlesError: string | null;
  onOpenCircle: (circleId: string) => void;
  onCreateSlot: () => void;
  onCreateEvent: () => void;
  onCreateCircle: () => void;
  onOpenCircles: () => void;
  onOpenSlots: () => void;
  onOpenEvents: () => void;
  onSignOut: () => void;
};

export function HomeScreen({
  userLabel,
  circles,
  circlesLoading,
  circlesError,
  onOpenCircle,
  onCreateSlot,
  onCreateEvent,
  onCreateCircle,
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
          <TouchableOpacity onPress={onOpenSlots}>
            <Text style={styles.linkLine}>查看悠閒時光看板</Text>
          </TouchableOpacity>
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
            circles.map((circle) => (
              <TouchableOpacity
                key={circle.id}
                style={styles.circleRow}
                onPress={() => onOpenCircle(circle.id)}
              >
                <Text style={styles.circleName}>
                  {circle.circleName}（{circle.memberCount}）
                </Text>
                <Text style={styles.circleRole}>
                  {circle.role === 'owner' ? '圈主' : '成員'}
                  {circle.ownerLabel ? `：${circle.ownerLabel}` : ''}
                </Text>
                {circle.memberLabels.length > 0 ? (
                  <Text style={styles.circleMembers} numberOfLines={2}>
                    成員：{circle.memberLabels.join('、')}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.fabRow}>
          <TouchableOpacity style={styles.fab} onPress={onCreateSlot}>
            <Text style={styles.fabText}>+ 悠閒時光</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={onCreateEvent}>
            <Text style={styles.fabText}>+ 新活動</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={onCreateCircle}>
            <Text style={styles.fabText}>+ 新密友圈</Text>
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
  },
  fabText: {
    fontSize: 12,
    color: '#64748b',
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
