import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatErrorMessage } from '../lib/formatErrorMessage';
import {
  fetchUserProfilePrefill,
  updateUserProfile,
  type UserProfilePrefill,
} from '../lib/profileBootstrap';

export type WhoAmIScreenProps = {
  userId: string;
  onSaved: () => void | Promise<void>;
  onBack: () => void;
};

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readOnlyField}>
      <Text style={styles.readOnlyLabel}>{label}</Text>
      <Text style={styles.readOnlyValue}>{value || '—'}</Text>
    </View>
  );
}

export function WhoAmIScreen({ userId, onSaved, onBack }: WhoAmIScreenProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<UserProfilePrefill | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchUserProfilePrefill(userId);
        if (cancelled) {
          return;
        }
        setProfile(row);
        setDisplayName(row?.displayName ?? '');
        setMobile(row?.mobile ?? '');
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

  const handleSave = async () => {
    try {
      setBusy(true);
      await updateUserProfile({
        displayName,
        mobile,
      });
      await onSaved();
      Alert.alert('Who am I', '已更新個人資料。');
      onBack();
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
        <Text style={styles.hint}>載入個人資料…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Button title="返回" onPress={onBack} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>Who am I</Text>
        <Text style={styles.hint}>可修改暱稱與手機號碼；Email 與真實姓名僅供查看，避免登入與邀請資料錯亂。</Text>

        <ReadOnlyField label="Email" value={profile?.email ?? ''} />
        <ReadOnlyField label="真實姓名" value={profile?.realName ?? ''} />

        <Text style={styles.inputLabel}>暱稱</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="暱稱"
          placeholderTextColor="#94a3b8"
          editable={!busy}
        />

        <Text style={styles.inputLabel}>手機號碼</Text>
        <TextInput
          style={styles.input}
          value={mobile}
          onChangeText={setMobile}
          placeholder="手機號碼"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
          editable={!busy}
        />

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title={busy ? '儲存中…' : '儲存'} onPress={() => void handleSave()} disabled={busy} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="返回" onPress={onBack} disabled={busy} color="#64748b" />
          </View>
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
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  error: {
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  readOnlyLabel: {
    color: '#64748b',
    fontSize: 12,
    marginBottom: 4,
  },
  readOnlyValue: {
    color: '#334155',
    fontSize: 15,
  },
  inputLabel: {
    color: '#64748b',
    fontSize: 13,
    marginBottom: 6,
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
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  rowBtn: {
    flex: 1,
  },
});
