import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export type ProfileCircleFormPayload = {
  email: string;
  realName: string;
  displayName: string;
  mobile: string;
  circleName: string;
};

export type JoiningOnboardingPayload = ProfileCircleFormPayload & {
  inviteEmails: string[];
  inviteMethod: 'none' | 'line' | 'email';
};

export type CirclesOnboardingScreenProps = {
  busy: boolean;
  joiningViaInvitation?: boolean;
  initialEmail?: string | null;
  initialRealName?: string;
  initialDisplayName?: string;
  initialMobile?: string;
  /** 經由邀請連結加入：單步完成資料（沿用既有 create + claim） */
  onJoiningSubmit: (payload: JoiningOnboardingPayload) => Promise<void>;
  /** 新帳號：僅建立個人資料 + 第一個密友圈，不建立邀請 */
  onProfileAndCircleOnly: (payload: ProfileCircleFormPayload) => Promise<void>;
  onCancel: () => Promise<void>;
};

export function CirclesOnboardingScreen({
  busy,
  joiningViaInvitation,
  initialEmail,
  initialRealName,
  initialDisplayName,
  initialMobile,
  onJoiningSubmit,
  onProfileAndCircleOnly,
  onCancel,
}: CirclesOnboardingScreenProps) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [realName, setRealName] = useState(initialRealName ?? '');
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [mobile, setMobile] = useState(initialMobile ?? '');
  const [circleName, setCircleName] = useState('');

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    if (initialRealName) {
      setRealName(initialRealName);
    }
  }, [initialRealName]);

  useEffect(() => {
    if (initialDisplayName) {
      setDisplayName(initialDisplayName);
    }
  }, [initialDisplayName]);

  useEffect(() => {
    if (initialMobile) {
      setMobile(initialMobile);
    }
  }, [initialMobile]);

  const handleCreate = async () => {
    if (!email.trim()) {
      Alert.alert('建立密友圈', '請輸入 email');
      return;
    }
    if (!joiningViaInvitation && !circleName.trim()) {
      Alert.alert('建立密友圈', '請輸入圈名');
      return;
    }
    const base: ProfileCircleFormPayload = {
      email: email.trim(),
      realName: realName.trim(),
      displayName: displayName.trim(),
      mobile: mobile.trim(),
      circleName: circleName.trim(),
    };
    if (joiningViaInvitation) {
      await onJoiningSubmit({
        ...base,
        inviteEmails: [],
        inviteMethod: 'none',
      });
      return;
    }
    await onProfileAndCircleOnly(base);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>擁有密友圈成為圈主</Text>
        <Text style={styles.hint}>
          {joiningViaInvitation
            ? '你是被邀請加入圈子，資料會自動帶出；缺少的欄位再補填即可。'
            : '建立自己的密友圈後，你就是圈主；也可以稍後再建圈。'}
        </Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="電子郵件"
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={realName}
          onChangeText={setRealName}
          placeholder="真實姓名_以免暱稱重複"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="暱稱_喜歡大家怎麼稱呼你"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={mobile}
          onChangeText={setMobile}
          placeholder="手機號碼"
          keyboardType="phone-pad"
          editable={!busy}
        />

        {!joiningViaInvitation ? (
          <TextInput
            style={styles.input}
            value={circleName}
            onChangeText={setCircleName}
            placeholder="幫密友圈取個名字"
            editable={!busy}
          />
        ) : null}

        <View style={styles.row}>
          <View style={styles.rowBtn}>
            <Button
              title={busy ? '處理中…' : joiningViaInvitation ? '進入密友圈' : '建立密友圈'}
              onPress={handleCreate}
              disabled={busy}
            />
          </View>
          <View style={styles.rowBtn}>
            <Button title="稍後再建圈" onPress={() => void onCancel()} disabled={busy} color="#64748b" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export type PostCircleInviteChannel = 'line' | 'whatsapp' | 'telegram' | 'mail' | 'system';

export type PostCircleInviteStepProps = {
  busy: boolean;
  circleId: string;
  circleName: string;
  onShareSocial: (channel: PostCircleInviteChannel) => Promise<void>;
  onSubmitEmails: (emails: string[]) => Promise<void>;
  onSkip: () => Promise<void>;
};

/** 流程圖：建立圈子後 → 選擇社群／Email，此時後端才建立對應 invitations */
export function PostCircleInviteStep({
  busy,
  circleName,
  onShareSocial,
  onSubmitEmails,
  onSkip,
}: PostCircleInviteStepProps) {
  const [inviteMode, setInviteMode] = useState<'idle' | 'line' | 'email'>('idle');
  const [invite1, setInvite1] = useState('');
  const [invite2, setInvite2] = useState('');
  const [invite3, setInvite3] = useState('');

  const methodCard = (mode: 'line' | 'email', title: string, subtitle: string) => (
    <TouchableOpacity
      style={[styles.methodCard, inviteMode === mode && styles.methodCardSelected]}
      onPress={() => setInviteMode((prev) => (prev === mode ? 'idle' : mode))}
      disabled={busy}
      activeOpacity={0.85}
    >
      <Text style={styles.methodTitle}>{title}</Text>
      <Text style={styles.methodSubtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );

  const socialBtn = (
    channel: PostCircleInviteChannel,
    label: string,
    bg: string,
    textColor = '#ffffff',
  ) => (
    <TouchableOpacity
      key={channel}
      style={[styles.socialChannelBtn, { backgroundColor: bg }, busy && styles.disabled]}
      onPress={() => void onShareSocial(channel)}
      disabled={busy}
      activeOpacity={0.85}
    >
      <Text style={[styles.socialChannelBtnText, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );

  const handleEmailSend = async () => {
    const emails = [invite1, invite2, invite3].map((v) => v.trim()).filter(Boolean);
    if (emails.length === 0) {
      Alert.alert('Email 邀請', '請至少輸入一組有效的 email。');
      return;
    }
    await onSubmitEmails(emails);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.title}>邀請密友</Text>
        <Text style={styles.hint}>
          密友圈「{circleName}」已建立。請選擇邀請方式：選 LINE／其他社群時，會先在伺服器產生邀請函，再開啟分享讓你選對象。
        </Text>

        {methodCard('line', 'LINE／其他社群', '通用邀請連結，不需事先填 email；展開後選擇要開啟的 App')}
        {inviteMode === 'line' ? (
          <View style={styles.socialList}>
            {socialBtn('line', 'LINE', '#06c755')}
            {socialBtn('whatsapp', 'WhatsApp', '#128C7E')}
            {socialBtn('telegram', 'Telegram', '#229ED9')}
            {socialBtn('mail', 'Email', '#475569')}
            {socialBtn('system', '更多／系統分享', '#64748b')}
          </View>
        ) : null}

        {methodCard('email', 'Email 邀請', '建立後依你填的 email 產生專屬邀請並嘗試寄信')}
        {inviteMode === 'email' ? (
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
            <Button title={busy ? '送出中…' : '送出 Email 邀請'} onPress={() => void handleEmailSend()} disabled={busy} />
          </>
        ) : null}

        <View style={styles.skipWrap}>
          <Button title="稍後再邀請" onPress={() => void onSkip()} disabled={busy} color="#64748b" />
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
  methodCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  methodCardSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#f5f3ff',
  },
  methodTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  methodSubtitle: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 17,
  },
  socialList: {
    gap: 10,
    marginBottom: 16,
  },
  socialChannelBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  socialChannelBtnText: {
    fontWeight: '700',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.6,
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
  skipWrap: {
    marginTop: 20,
  },
});
