import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { formatErrorMessage } from '../lib/formatErrorMessage';
import { getCircleForUser, type CircleDetail } from '../lib/circleAccess';

export type CircleDetailScreenProps = {
  circleId: string;
  userId: string;
  onBack: () => void;
};

export function CircleDetailScreen({ circleId, userId, onBack }: CircleDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setCircle(row);
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
        <Text style={styles.note}>此頁先留白，之後會放朋友圈內容。</Text>

        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>小型回憶_短片或照片</Text>
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>活動時間線</Text>
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>成員</Text>
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderTitle}>顯示</Text>
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
