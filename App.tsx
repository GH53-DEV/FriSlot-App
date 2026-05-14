import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseKey, supabaseUrl } from './src/lib/supabase';
import { formatErrorMessage } from './src/lib/formatErrorMessage';
import { dispatchInvitationEmails, getInvitationEmailTemplates } from './src/lib/invitationEmailDispatch';
import {
  openEmailForInvitations,
  openLineForInvitations,
  openTelegramShareForInvitations,
  openWhatsAppForInvitations,
  shareInvitationLinksGeneric,
} from './src/lib/invitationShare';
import {
  claimInvitationForExistingProfile,
  createEmailInvitationsForCircle,
  createFirstCircleAndInvites,
  createShareInvitationForCircle,
  userExists,
  userHasOwnerCircle,
} from './src/lib/profileBootstrap';
import { getGoogleOAuthRedirectUri, getOAuthAuthSessionReturnUrl, isMisconfiguredOAuthRedirect } from './src/lib/authRedirect';
import {
  completeOAuthSessionFromUrl,
  getRedirectToFromOAuthUrl,
  isOAuthCallbackUrl,
  waitForOAuthCallbackUrl,
} from './src/lib/oauthCallback';
import { parseInvitationTokenFromUrl } from './src/lib/invitation-links';
import { CircleDetailScreen } from './src/screens/CircleDetailScreen';
import {
  CirclesOnboardingScreen,
  PostCircleInviteStep,
  type PostCircleInviteChannel,
  type ProfileCircleFormPayload,
} from './src/screens/CirclesOnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';

WebBrowser.maybeCompleteAuthSession();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  /** Avoid showing Login before AsyncStorage session is read (prevents OAuth race with stale session). */
  const [authHydrated, setAuthHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('尚未測試連線');
  const [authRouteError, setAuthRouteError] = useState<string | null>(null);
  const [hasOwnerCircle, setHasOwnerCircle] = useState<boolean | null>(null);
  const [hasUserProfile, setHasUserProfile] = useState<boolean | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [acceptedInviteToken, setAcceptedInviteToken] = useState<string | null>(null);
  /** 新帳號：已建立圈子，依流程圖進入「選擇社群／Email 邀請」步驟 */
  const [inviteAfterCircle, setInviteAfterCircle] = useState<{
    circleId: string;
    circleName: string;
  } | null>(null);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const claimingInviteTokenRef = useRef<string | null>(null);
  const postInviteShareUrlRef = useRef<string | null>(null);
  const inviteBaseUrl = (Constants.expoConfig?.extra?.inviteBaseUrl as string | undefined)
    ?? 'https://frislot.app/invite';

  const promptShareOptions = async (invitationLinks: string[]) => {
    await new Promise<void>((resolve) => {
      Alert.alert('邀請已建立', '請選擇分享方式', [
        {
          text: 'Email',
          onPress: () => {
            void openEmailForInvitations(invitationLinks).catch((err) => {
              Alert.alert('Email 分享失敗', formatErrorMessage(err));
            });
            resolve();
          },
        },
        {
          text: 'LINE',
          onPress: () => {
            void openLineForInvitations(invitationLinks).catch((err) => {
              Alert.alert('LINE 分享失敗', formatErrorMessage(err));
            });
            resolve();
          },
        },
        {
          text: '更多分享',
          onPress: () => {
            void shareInvitationLinksGeneric(invitationLinks).catch((err) => {
              Alert.alert('分享失敗', formatErrorMessage(err));
            });
            resolve();
          },
        },
        {
          text: '稍後',
          style: 'cancel',
          onPress: () => resolve(),
        },
      ]);
    });
  };

  const refreshPostAuthRoute = useCallback(async (current: Session | null) => {
    if (!current?.user) {
      setHasOwnerCircle(null);
      setHasUserProfile(null);
      return;
    }
    setRouteLoading(true);
    setAuthRouteError(null);
    try {
      const hasCircle = await userHasOwnerCircle(current.user.id);
      const hasProfile = await userExists(current.user.id);
      setHasOwnerCircle(hasCircle);
      setHasUserProfile(hasProfile);
    } catch (err) {
      if (__DEV__) {
        console.error('[bootstrap]', err);
      }
      setAuthRouteError(formatErrorMessage(err));
      setHasOwnerCircle(null);
      setHasUserProfile(null);
    } finally {
      setRouteLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) {
          return;
        }
        setSession(data.session);
        await refreshPostAuthRoute(data.session);
      } finally {
        if (!cancelled) {
          setAuthHydrated(true);
        }
      }
    };

    void hydrate();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      void refreshPostAuthRoute(currentSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshPostAuthRoute]);

  useEffect(() => {
    postInviteShareUrlRef.current = null;
  }, [inviteAfterCircle?.circleId]);

  const goToCircleDetailAfterInviteStep = useCallback(
    async (circleId: string) => {
      setActiveCircleId(circleId);
      setInviteAfterCircle(null);
      postInviteShareUrlRef.current = null;
      if (session) {
        await refreshPostAuthRoute(session);
      }
    },
    [refreshPostAuthRoute, session],
  );

  useEffect(() => {
    const consumeUrl = (url: string | null) => {
      const token = parseInvitationTokenFromUrl(url);
      if (token) {
        setAcceptedInviteToken(token);
      }
    };

    Linking.getInitialURL().then((url) => consumeUrl(url));
    const sub = Linking.addEventListener('url', (event) => consumeUrl(event.url));

    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const user = session?.user;
    if (!user || !acceptedInviteToken || hasUserProfile !== true) {
      return;
    }
    if (claimingInviteTokenRef.current === acceptedInviteToken) {
      return;
    }

    claimingInviteTokenRef.current = acceptedInviteToken;
    let cancelled = false;

    const claimNow = async () => {
      try {
        setRouteLoading(true);
        const claim = await claimInvitationForExistingProfile({
          uid: user.id,
          email: user.email ?? '',
          token: acceptedInviteToken,
        });
        if (cancelled) {
          return;
        }
        setAcceptedInviteToken(null);
        if (claim.circleRef) {
          setActiveCircleId(claim.circleRef);
        }
        await refreshPostAuthRoute(session);
      } catch (err) {
        if (!cancelled) {
          Alert.alert('邀請處理失敗', formatErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setRouteLoading(false);
        }
        claimingInviteTokenRef.current = null;
      }
    };

    void claimNow();
    return () => {
      cancelled = true;
    };
  }, [acceptedInviteToken, hasUserProfile, refreshPostAuthRoute, session]);

  const signInWithGoogle = async () => {
    let capturedCallbackUrl: string | null = null;
    const linkingSub = Linking.addEventListener('url', (event) => {
      if (isOAuthCallbackUrl(event.url)) {
        capturedCallbackUrl = event.url;
      }
    });

    try {
      setLoading(true);
      setAuthRouteError(null);
      const redirectTo = getGoogleOAuthRedirectUri();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.url) {
        throw new Error('Google OAuth URL was not generated.');
      }

      const requestedRedirect = getRedirectToFromOAuthUrl(data.url);
      const authSessionReturnUrl = getOAuthAuthSessionReturnUrl(redirectTo);
      const callbackWait = waitForOAuthCallbackUrl();
      const result = await WebBrowser.openAuthSessionAsync(data.url, authSessionReturnUrl);
      const callbackUrls = Array.from(
        new Set(
          [
            result.type === 'success' ? result.url : null,
            capturedCallbackUrl,
            await callbackWait,
          ].filter((url): url is string => typeof url === 'string' && url.length > 0),
        ),
      );

      for (const callbackUrl of callbackUrls) {
        if (isMisconfiguredOAuthRedirect(callbackUrl)) {
          Alert.alert(
            'Google 登入設定未完成',
            `瀏覽器被導向 example.com，代表 Supabase 的 Site URL 仍是預設值，或 Redirect URLs 未包含此 App 回呼網址。\n\n請到 Supabase → Authentication → URL Configuration：\n1. 將 Site URL 改為正式網址（勿用 example.com）\n2. 在 Redirect URLs 加入：\n${redirectTo}\n\nGoogle Cloud 的 OAuth 重新導向 URI 仍須為：\n${supabaseUrl}/auth/v1/callback`,
          );
          return;
        }

        if (await completeOAuthSessionFromUrl(callbackUrl)) {
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        return;
      }

      if (result.type !== 'cancel') {
        const returnedUrl = result.type === 'success' ? result.url : undefined;
        const landedOnInviteSite = returnedUrl?.includes('gh53-dev.github.io');
        const redirectMismatch =
          typeof requestedRedirect === 'string' &&
          requestedRedirect.length > 0 &&
          requestedRedirect !== redirectTo;
        const redirectHint = redirectMismatch
          ? `\n\nSupabase 實際 redirect_to 為：\n${requestedRedirect}\n與 App 顯示的 OAuth Redirect URL 不一致，請以登入頁開發者區塊為準更新 Redirect URLs。`
          : redirectTo.startsWith('http')
            ? `\n\n若 Supabase Redirect URLs 已含 oauth/callback.html 仍失敗，請再加一條：\nhttps://gh53-dev.github.io/FriSlot-App/oauth/callback.html**\n若瀏覽器頁面顯示「未收到登入授權碼」，代表 Supabase 沒有把 code 帶回 callback.html。`
            : `\n\n若 Supabase Redirect URLs 已含上述網址仍失敗，多半是 Expo Go 沒接住瀏覽器回呼；請改跑 npm run start:tunnel，並把新的 exp://...exp.direct... 加進 Redirect URLs。`;
        Alert.alert(
          '登入未完成',
          landedOnInviteSite
            ? `Google 登入後瀏覽器被導向 GitHub Pages，App 沒收到 auth code。\n\n請確認 Supabase Redirect URLs 含登入頁開發者區塊的 OAuth Redirect URL：\n${redirectTo}${redirectHint}`
            : `Google 登入後 App 沒收到 auth code。\n\n請確認 Supabase Redirect URLs 含：\n${redirectTo}${redirectHint}`,
        );
      }
    } catch (err) {
      Alert.alert('Google 登入失敗', formatErrorMessage(err));
    } finally {
      linkingSub.remove();
      setLoading(false);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      setLoading(true);
      setAuthRouteError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthRouteError(error.message);
        return;
      }
    } catch (err) {
      setAuthRouteError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        Alert.alert('重設密碼', error.message);
        return;
      }
      Alert.alert('重設密碼', '已寄出重設信，請檢查信箱');
    } catch (err) {
      Alert.alert('重設密碼', formatErrorMessage(err));
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
    setHasOwnerCircle(null);
    setHasUserProfile(null);
    setAuthRouteError(null);
    setActiveCircleId(null);
    setInviteAfterCircle(null);
  };

  const testSupabaseConnection = async () => {
    try {
      setTesting(true);
      setConnectionMessage('測試中...');

      const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: {
          apikey: supabaseKey,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setConnectionMessage('連線成功：已可存取 Supabase Auth API');
    } catch (err) {
      setConnectionMessage(`連線失敗：${formatErrorMessage(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const handleJoiningOnboardingSubmit = async (payload: {
    email: string;
    realName: string;
    displayName: string;
    mobile: string;
    circleName: string;
    inviteEmails: string[];
    inviteMethod: 'none' | 'line' | 'email';
  }) => {
    const user = session?.user;
    if (!user) {
      return;
    }
    try {
      setOnboardingBusy(true);
      const result = await createFirstCircleAndInvites({
        uid: user.id,
        email: payload.email || user.email || null,
        circleName: payload.circleName,
        realName: payload.realName,
        displayName: payload.displayName,
        photoUrl:
          (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
          null,
        mobile: payload.mobile,
        inviteEmails: payload.inviteEmails,
        inviteBaseUrl,
        acceptedInviteToken,
        inviteMethod: payload.inviteMethod,
      });
      let emailDispatchWarning: string | null = null;
      if (result.invitationLinks.length > 0) {
        try {
          if (payload.inviteMethod === 'email') {
            const templates = await getInvitationEmailTemplates();
            await dispatchInvitationEmails({
              ownerEmail: user.email ?? '',
              circleName: payload.circleName,
              subjectTemplate: templates.subjectTemplate,
              bodyTemplate: templates.bodyTemplate,
              invitations: result.invitationPayloads,
            });
            Alert.alert('邀請已建立', '已依 email 方式送出邀請。');
          } else if (payload.inviteMethod === 'line') {
            await openLineForInvitations(result.invitationLinks);
          } else {
            await promptShareOptions(result.invitationLinks);
          }
        } catch (err) {
          emailDispatchWarning = formatErrorMessage(err);
        }

        if (emailDispatchWarning) {
          Alert.alert(
            '邀請信寄送失敗',
            `密友圈已建立成功，但自動寄信失敗。\n\n${emailDispatchWarning}\n\n你仍可用下方方式手動分享邀請連結。`,
          );
          await promptShareOptions(result.invitationLinks);
        }
      }
      setHasOwnerCircle(result.joinedViaInvitation ? false : true);
      setHasUserProfile(true);
      setAcceptedInviteToken(null);
      if (result.circleId) {
        setActiveCircleId(result.circleId);
      }
    } catch (err) {
      Alert.alert('建立失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handleNewUserProfileAndCircle = async (payload: ProfileCircleFormPayload) => {
    const user = session?.user;
    if (!user) {
      return;
    }
    try {
      setOnboardingBusy(true);
      const result = await createFirstCircleAndInvites({
        uid: user.id,
        email: payload.email || user.email || null,
        circleName: payload.circleName,
        realName: payload.realName,
        displayName: payload.displayName,
        photoUrl:
          (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
          null,
        mobile: payload.mobile,
        inviteEmails: [],
        inviteBaseUrl,
        acceptedInviteToken: null,
        inviteMethod: 'none',
      });
      if (!result.circleId) {
        Alert.alert('建立失敗', '未取得密友圈編號');
        return;
      }
      setHasOwnerCircle(result.joinedViaInvitation ? false : true);
      setHasUserProfile(true);
      setAcceptedInviteToken(null);
      setInviteAfterCircle({ circleId: result.circleId, circleName: payload.circleName.trim() });
    } catch (err) {
      Alert.alert('建立失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handlePostShareSocial = async (channel: PostCircleInviteChannel) => {
    if (!inviteAfterCircle) {
      return;
    }
    const circleId = inviteAfterCircle.circleId;
    try {
      setOnboardingBusy(true);
      if (!postInviteShareUrlRef.current) {
        const { invitationLinks } = await createShareInvitationForCircle(circleId, inviteBaseUrl);
        postInviteShareUrlRef.current = invitationLinks[0] ?? null;
      }
      const url = postInviteShareUrlRef.current;
      if (!url) {
        Alert.alert('邀請', '未能產生分享連結，請稍後再試。');
        return;
      }
      const links = [url];
      switch (channel) {
        case 'line':
          await openLineForInvitations(links);
          break;
        case 'whatsapp':
          await openWhatsAppForInvitations(links);
          break;
        case 'telegram':
          await openTelegramShareForInvitations(links);
          break;
        case 'mail':
          await openEmailForInvitations(links);
          break;
        case 'system':
          await shareInvitationLinksGeneric(links);
          break;
        default:
          break;
      }
      await goToCircleDetailAfterInviteStep(circleId);
      Alert.alert('邀請', '已在伺服器建立邀請函並開啟分享。');
    } catch (err) {
      Alert.alert('邀請失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handlePostEmailInvites = async (emails: string[]) => {
    if (!inviteAfterCircle || !session?.user) {
      return;
    }
    try {
      setOnboardingBusy(true);
      const { invitationPayloads } = await createEmailInvitationsForCircle(
        inviteAfterCircle.circleId,
        emails,
        inviteBaseUrl
      );
      if (invitationPayloads.length === 0) {
        Alert.alert('邀請', '未能建立邀請資料，請確認 email 是否正確。');
        return;
      }
      const templates = await getInvitationEmailTemplates();
      await dispatchInvitationEmails({
        ownerEmail: session.user.email ?? '',
        circleName: inviteAfterCircle.circleName,
        subjectTemplate: templates.subjectTemplate,
        bodyTemplate: templates.bodyTemplate,
        invitations: invitationPayloads,
      });
      await goToCircleDetailAfterInviteStep(inviteAfterCircle.circleId);
      Alert.alert(
        '邀請已建立',
        '資料庫已寫入 pending 邀請並已嘗試寄信。若未收到，請在 Supabase 部署 send-invitation-emails、設定 RESEND_API_KEY 與 INVITATION_FROM_EMAIL，並確認 Resend 網域已驗證。',
      );
    } catch (err) {
      Alert.alert('邀請失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handlePostSkipInvites = async () => {
    if (!inviteAfterCircle) {
      return;
    }
    await goToCircleDetailAfterInviteStep(inviteAfterCircle.circleId);
  };

  const handleOnboardingCancel = async () => {
    const user = session?.user;
    if (!user) {
      return;
    }
    try {
      setOnboardingBusy(true);
      const profileExists = await userExists(user.id);
      if (profileExists) {
        setHasUserProfile(true);
        return;
      }
      await signOut();
    } catch (err) {
      Alert.alert('取消失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const userLabel = session?.user.email ?? session?.user.id ?? '';

  let body: ReactNode;
  if (!authHydrated) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>載入中…</Text>
      </View>
    );
  } else if (!session) {
    body = (
      <LoginScreen
        busy={loading}
        authError={authRouteError}
        onGooglePress={signInWithGoogle}
        onEmailSignIn={signInWithEmail}
        onForgotPassword={sendPasswordReset}
        devConnectionMessage={connectionMessage}
        devTesting={testing}
        onDevTestConnection={testSupabaseConnection}
      />
    );
  } else if (
    routeLoading ||
    ((hasOwnerCircle === null || hasUserProfile === null) && !authRouteError)
  ) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>載入中…</Text>
      </View>
    );
  } else if (session && authRouteError) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.routeErrTitle}>無法載入你的資料</Text>
        <Text style={styles.routeErr}>{authRouteError}</Text>
        <Text style={styles.routeErrHint}>
          若訊息與資料表、權限或 RLS 有關，請到 Supabase 確認 public.users / circles / circle_members
          是否存在，且已允許「已登入使用者」讀寫自己的列。
        </Text>
        <View style={styles.retryWrap}>
          <Text
            style={styles.retryLink}
            onPress={() => void refreshPostAuthRoute(session)}
          >
            重試
          </Text>
        </View>
      </View>
    );
  } else if (session && inviteAfterCircle) {
    body = (
      <PostCircleInviteStep
        busy={onboardingBusy}
        circleId={inviteAfterCircle.circleId}
        circleName={inviteAfterCircle.circleName}
        onShareSocial={(ch) => handlePostShareSocial(ch)}
        onSubmitEmails={(emails) => handlePostEmailInvites(emails)}
        onSkip={handlePostSkipInvites}
      />
    );
  } else if (!hasOwnerCircle && !hasUserProfile) {
    body = (
      <CirclesOnboardingScreen
        busy={onboardingBusy}
        joiningViaInvitation={Boolean(acceptedInviteToken)}
        initialEmail={session?.user.email ?? null}
        onJoiningSubmit={handleJoiningOnboardingSubmit}
        onProfileAndCircleOnly={handleNewUserProfileAndCircle}
        onCancel={handleOnboardingCancel}
      />
    );
  } else if (activeCircleId && session) {
    body = (
      <CircleDetailScreen
        circleId={activeCircleId}
        userId={session.user.id}
        onBack={() => setActiveCircleId(null)}
      />
    );
  } else {
    body = (
      <HomeScreen
        userLabel={userLabel}
        userId={session.user.id}
        onOpenCircle={setActiveCircleId}
        onSignOut={signOut}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {body}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#64748b',
  },
  routeErr: {
    marginTop: 12,
    color: '#b91c1c',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  routeErrHint: {
    marginTop: 16,
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 18,
  },
  routeErrTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
  retryWrap: {
    marginTop: 20,
  },
  retryLink: {
    color: '#2563eb',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
});
