import { useState } from 'react';
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export type CirclesOnboardingScreenProps = {
  busy: boolean;
  joiningViaInvitation?: boolean;
  onSubmit: (payload: {
    displayName: string;
    phoneNumber: string;
    circleName: string;
    inviteEmails: string[];
    inviteMethod: 'none' | 'line' | 'email';
  }) => Promise<void>;
  onCancel: () => Promise<void>;
};

export function CirclesOnboardingScreen({
  busy,
  joiningViaInvitation,
  onSubmit,
  onCancel,
}: CirclesOnboardingScreenProps) {
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [circleName, setCircleName] = useState('');
  const [invite1, setInvite1] = useState('');
  const [invite2, setInvite2] = useState('');
  const [invite3, setInvite3] = useState('');
  const [inviteMode, setInviteMode] = useState<'none' | 'line' | 'email'>('none');

  const clearForm = () => {
    setDisplayName('');
    setPhoneNumber('');
    setCircleName('');
    setInvite1('');
    setInvite2('');
    setInvite3('');
  };

  const handleCreate = async () => {
    if (!joiningViaInvitation && !circleName.trim()) {
      Alert.alert('建立密友圈', '請輸入圈名');
      return;
    }
    const normalizedEmails = [invite1, invite2, invite3].map((v) => v.trim()).filter(Boolean);
    if (!joiningViaInvitation && inviteMode !== 'none' && normalizedEmails.length === 0) {
      Alert.alert('邀請密友', '已選擇邀請方式，請至少輸入 1 組 email。');
      return;
    }
    await onSubmit({
      displayName,
      phoneNumber,
      circleName,
      inviteEmails: [invite1, invite2, invite3],
      inviteMethod: inviteMode,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>建立你的第一個密友圈</Text>
        <Text style={styles.hint}>新帳號需先建立起始圈；邀請好友可稍後再補</Text>

        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="顯示名稱"
          editable={!busy}
        />

        <Text style={styles.label}>Your mobile phone</Text>
        <TextInput
          style={styles.input}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="手機號碼"
          keyboardType="phone-pad"
          editable={!busy}
        />

        {joiningViaInvitation ? (
          <Text style={styles.hint}>你是被邀請加入圈子，請完成個人資料即可繼續。</Text>
        ) : (
          <>
            <Text style={styles.section}>建立你的第一個密友圈</Text>
            <TextInput
              style={styles.input}
              value={circleName}
              onChangeText={setCircleName}
              placeholder="輸入密友圈名稱"
              editable={!busy}
            />

            <Text style={styles.section}>邀請密友（選填）</Text>
            <Text style={styles.inviteHint}>點選方式後才會顯示對應欄位</Text>
            <View style={styles.inviteMethodRow}>
              <View style={styles.methodBtn}>
                <Button
                  title="LINE"
                  onPress={() => setInviteMode('line')}
                  disabled={busy}
                  color={inviteMode === 'line' ? '#7c3aed' : '#64748b'}
                />
              </View>
              <View style={styles.methodBtn}>
                <Button
                  title="Email"
                  onPress={() => setInviteMode('email')}
                  disabled={busy}
                  color={inviteMode === 'email' ? '#7c3aed' : '#64748b'}
                />
              </View>
            </View>
            {inviteMode === 'line' ? (
              <Text style={styles.inviteHint}>建立後會直接開 LINE 分享，仍需填 email 才能建立 invitations 紀錄。</Text>
            ) : null}
            {inviteMode !== 'none' ? (
              <>
                <TextInput
                  style={styles.input}
                  value={invite1}
                  onChangeText={setInvite1}
                  placeholder="密友 1 email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!busy}
                />
                <TextInput
                  style={styles.input}
                  value={invite2}
                  onChangeText={setInvite2}
                  placeholder="密友 2 email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!busy}
                />
                <TextInput
                  style={styles.input}
                  value={invite3}
                  onChangeText={setInvite3}
                  placeholder="密友 3 email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!busy}
                />
              </>
            ) : null}
          </>
        )}

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button title={busy ? '建立中…' : '建立'} onPress={handleCreate} disabled={busy} />
          </View>
          <View style={styles.rowBtn}>
            <Button title="取消" onPress={() => void onCancel()} disabled={busy} color="#64748b" />
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
    maxWidth: 360,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  section: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
    color: '#334155',
  },
  inviteHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 10,
  },
  inviteMethodRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  methodBtn: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  rowBtn: {
    flex: 1,
  },
});
