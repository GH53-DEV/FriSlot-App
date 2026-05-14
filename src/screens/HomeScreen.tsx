import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { listAccessibleCircles, type CircleSummary } from '../lib/circleAccess';
import { formatErrorMessage } from '../lib/formatErrorMessage';

type HomeScreenProps = {
  userLabel: string;
  userId: string;
  onOpenCircle: (circleId: string) => void;
  onSignOut: () => void;
};

export function HomeScreen({ userLabel, userId, onOpenCircle, onSignOut }: HomeScreenProps) {
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [circlesLoading, setCirclesLoading] = useState(true);
  const [circlesError, setCirclesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setCirclesLoading(true);
      setCirclesError(null);
      try {
        const rows = await listAccessibleCircles(userId);
        if (!cancelled) {
          setCircles(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setCirclesError(formatErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setCirclesLoading(false);
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
        <Text style={styles.title}>首頁</Text>
        <Text style={styles.subtitle}>{userLabel}</Text>
        <Text style={styles.note}>目前這頁先空白（wireframe 占位）</Text>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>小型回顧</Text>
          <Text style={styles.placeholderMuted}>投片或相片占位</Text>
        </View>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>活動時間軸</Text>
          <Text style={styles.placeholderMuted}>即將到來的活動…</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>即將到來</Text>
          <Text style={styles.cardLine}>Amy · 3/8 14:00</Text>
          <Text style={styles.cardLine}>圈內活動 · 北海道旅行</Text>
        </View>

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
              <Text style={styles.listItem}>
                {circle.circleName} ({circle.role === 'owner' ? '圈主' : '成員'})
              </Text>
            </TouchableOpacity>
          ))
        )}

        <View style={styles.fabRow}>
          <TouchableOpacity style={styles.fab} disabled>
            <Text style={styles.fabText}>+ 悠閒時光</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} disabled>
            <Text style={styles.fabText}>+ 新活動</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} disabled>
            <Text style={styles.fabText}>+ 新密友圈</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          {['首頁', '圈', '行事曆', '更多'].map((label) => (
            <View key={label} style={styles.tabItem}>
              <Text style={styles.tabIcon}>○</Text>
              <Text style={styles.tabLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.signOut}>
          <Button title="登出" onPress={onSignOut} />
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
  section: {
    fontWeight: '600',
    marginBottom: 8,
    color: '#334155',
  },
  listItem: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 6,
  },
  circleRow: {
    marginBottom: 4,
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
  signOut: {
    marginTop: 8,
  },
});
