import { useEffect, useState } from 'react';
import { getGoogleOAuthRedirectUri } from '../lib/authRedirect';
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

export type LoginScreenProps = {
  busy: boolean;
  authError: string | null;
  onGooglePress: () => void;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  devConnectionMessage?: string;
  devTesting?: boolean;
  onDevTestConnection?: () => void;
  invitePendingMessage?: string | null;
};

export function LoginScreen({
  busy,
  authError,
  onGooglePress,
  onEmailSignIn,
  onForgotPassword,
  devConnectionMessage,
  devTesting,
  onDevTestConnection,
  invitePendingMessage,
}: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');

  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    setOauthRedirectUri(getGoogleOAuthRedirectUri());
  }, []);

  const handleEmailLogin = async () => {
    const trimmed = email.trim();
    if (!trimmed || !password) {
      Alert.alert('登入', '請輸入電子郵件與密碼');
      return;
    }
    await onEmailSignIn(trimmed, password);
  };

  const handleForgot = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('忘記密碼', '請先在上方輸入電子郵件');
      return;
    }
    await onForgotPassword(trimmed);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Text style={styles.logoPlaceholder}>[ Logo ]</Text>
        {invitePendingMessage ? (
          <Text style={styles.inviteBanner}>{invitePendingMessage}</Text>
        ) : null}
        {authError ? <Text style={styles.errorBanner}>{authError}</Text> : null}

        <TouchableOpacity
          style={[styles.socialBtn, busy && styles.disabled]}
          onPress={onGooglePress}
          disabled={busy}
        >
          <Text style={styles.socialText}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.socialBtn, styles.socialMuted, busy && styles.disabled]}
          onPress={() => Alert.alert('即將推出', 'Apple 登入稍後開放')}
          disabled={busy}
        >
          <Text style={styles.socialText}>Continue with Apple</Text>
        </TouchableOpacity>

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>Or</Text>
          <View style={styles.orLine} />
        </View>

        <Text style={styles.label}>email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          editable={!busy}
        />

        <Text style={styles.label}>password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          editable={!busy}
        />

        <View style={styles.actions}>
          <Button title={busy ? '登入中…' : '登入'} onPress={handleEmailLogin} disabled={busy} />
        </View>

        <TouchableOpacity onPress={handleForgot} disabled={busy}>
          <Text style={styles.link}>忘記密碼</Text>
        </TouchableOpacity>

        {__DEV__ && onDevTestConnection ? (
          <View style={styles.devBox}>
            <Text style={styles.devLabel}>開發者</Text>
            <Text style={styles.devStatus}>{devConnectionMessage ?? ''}</Text>
            <Text style={styles.devRedirect} selectable>
              OAuth Redirect URL（請加入 Supabase Redirect URLs）：{'\n'}
              {oauthRedirectUri || 'frislotnew://auth/callback'}
            </Text>
            <Text style={styles.devHint}>
              若 Expo Go 顯示 Something went wrong，請確認手機與電腦同一 Wi‑Fi，並用 Metro 終端機上的 LAN QR 重新掃描（避免不穩定的 tunnel）。
            </Text>
            <Button
              title={devTesting ? '測試中…' : '測試 Supabase 連線'}
              onPress={onDevTestConnection}
              disabled={!!devTesting || busy}
            />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
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
  logoPlaceholder: {
    textAlign: 'center',
    marginBottom: 16,
    color: '#94a3b8',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },
  inviteBanner: {
    backgroundColor: '#ecfdf5',
    color: '#047857',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
    textAlign: 'center',
  },
  socialBtn: {
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  socialMuted: {
    backgroundColor: '#334155',
  },
  socialText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#cbd5e1',
  },
  orText: {
    marginHorizontal: 12,
    color: '#64748b',
    fontSize: 13,
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
  actions: {
    marginTop: 4,
    marginBottom: 12,
  },
  link: {
    color: '#2563eb',
    textAlign: 'center',
    fontSize: 14,
  },
  devBox: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  devLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
  },
  devStatus: {
    fontSize: 12,
    color: '#334155',
    marginBottom: 8,
    textAlign: 'center',
  },
  devRedirect: {
    fontSize: 11,
    color: '#475569',
    marginBottom: 8,
    lineHeight: 16,
  },
  devHint: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 16,
  },
});
