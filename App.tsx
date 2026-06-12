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
  claimLatestAcceptedInvitationForUser,
  createCircleForExistingUser,
  createEmailInvitationsForCircle,
  createFirstCircleAndInvites,
  createShareInvitationForCircle,
  fetchUserProfilePrefill,
  fetchInvitationByToken,
  upsertUserFromAuth,
  userExists,
  userHasOwnerCircle,
  userIsCircleMember,
} from './src/lib/profileBootstrap';
import { listAccessibleCircles, type CircleSummary } from './src/lib/circleAccess';
import { getGoogleOAuthRedirectUri, getOAuthAuthSessionReturnUrl, isMisconfiguredOAuthRedirect } from './src/lib/authRedirect';
import {
  completeOAuthSessionFromUrl,
  getRedirectToFromOAuthUrl,
  isOAuthCallbackUrl,
  waitForOAuthCallbackUrl,
} from './src/lib/oauthCallback';
import {
  parseInvitationCircleIdFromUrl,
  parseInvitationTokenFromUrl,
} from './src/lib/invitation-links';
import {
  clearPendingInviteDeepLink,
  readPendingInviteDeepLink,
  savePendingInviteDeepLink,
} from './src/lib/pendingInviteStorage';
import { listVisibleEventsForUser as listEventsForUnreadBadges } from './src/lib/events';
import { countSlotBookingBucketsForUser } from './src/lib/slots';
import { discussionKey, listDiscussionSummaries, listUserDiscussionTargets } from './src/lib/discussions';
import { CircleDetailScreen } from './src/screens/CircleDetailScreen';
import {
  ChooseDateScreen,
  CirclesScreen,
  CreateCircleScreen,
  CreateEventScreen,
  CreateSlotScreen,
  DiscussionScreen,
  EventDetailScreen,
  EventsScreen,
  SlotDetailScreen,
  SlotsScreen,
} from './src/screens/SlotsEventsScreens';
import {
  CirclesOnboardingScreen,
  PostCircleInviteStep,
  type PostCircleInviteChannel,
  type ProfileCircleFormPayload,
} from './src/screens/CirclesOnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';

WebBrowser.maybeCompleteAuthSession();

type AppView =
  | 'home'
  | 'circleDetail'
  | 'chooseDate'
  | 'createSlot'
  | 'slotDetail'
  | 'slotDiscussion'
  | 'createEvent'
  | 'eventDetail'
  | 'eventDiscussion'
  | 'circles'
  | 'slots'
  | 'events'
  | 'createCircle';

type CreateContext = {
  mode: 'slot' | 'event';
  circleIds: string[];
  lockCircleSelection: boolean;
  dates: string[];
};

type ActiveDateRange = {
  startDate: string;
  endDate: string;
};

type DiscussionContext = {
  scope: 'slot' | 'event';
  targetId: string;
  relatedTargetIds?: string[];
  title: string;
  subtitle?: string;
  backLabel: string;
};

function isInvalidRefreshTokenError(err: unknown): boolean {
  const message = formatErrorMessage(err).toLowerCase();
  return message.includes('invalid refresh token') || message.includes('refresh token not found');
}

async function clearLocalAuthSession() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error && __DEV__) {
    console.warn('[auth-local-signout]', error);
  }
}

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
  const [pendingInviteCircleId, setPendingInviteCircleId] = useState<string | null>(null);
  const [inviteeProfilePrefill, setInviteeProfilePrefill] = useState<{
    email: string;
    realName: string;
    displayName: string;
    mobile: string;
  } | null>(null);
  const [inviteMetaReady, setInviteMetaReady] = useState(false);
  /** 新帳號：已建立圈子，依流程圖進入「選擇社群／Email 邀請」步驟 */
  const [inviteAfterCircle, setInviteAfterCircle] = useState<{
    circleId: string;
    circleName: string;
  } | null>(null);
  const [ownerCircleOfferCircleId, setOwnerCircleOfferCircleId] = useState<string | null>(null);
  const [appView, setAppView] = useState<AppView>('home');
  const [accessibleCircles, setAccessibleCircles] = useState<CircleSummary[]>([]);
  const [accessibleCirclesError, setAccessibleCirclesError] = useState<string | null>(null);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [activeCircleUnreadCount, setActiveCircleUnreadCount] = useState(0);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [activeSlotUnreadCount, setActiveSlotUnreadCount] = useState(0);
  const [activeSlotRelatedIds, setActiveSlotRelatedIds] = useState<string[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [activeEventRelatedIds, setActiveEventRelatedIds] = useState<string[]>([]);
  const [activeSlotDateRange, setActiveSlotDateRange] = useState<ActiveDateRange | null>(null);
  const [activeEventDateRange, setActiveEventDateRange] = useState<ActiveDateRange | null>(null);
  const [activeEventUnreadCount, setActiveEventUnreadCount] = useState(0);
  const [activeDiscussion, setActiveDiscussion] = useState<DiscussionContext | null>(null);
  const [circleUnreadCounts, setCircleUnreadCounts] = useState<Record<string, number>>({});
  const [eventUnreadCounts, setEventUnreadCounts] = useState<Record<string, number>>({});
  const [eventCircleRefs, setEventCircleRefs] = useState<Record<string, string>>({});
  const [slotDiscussionUnreadCounts, setSlotDiscussionUnreadCounts] = useState<Record<string, number>>({});
  const [locallyReadDiscussionKeys, setLocallyReadDiscussionKeys] = useState<Record<string, true>>({});
  const [slotUnreadCount, setSlotUnreadCount] = useState(0);
  const [requestedSlotCount, setRequestedSlotCount] = useState(0);
  const [bookedSlotCount, setBookedSlotCount] = useState(0);
  const [unreadRefreshTick, setUnreadRefreshTick] = useState(0);
  const [createContext, setCreateContext] = useState<CreateContext | null>(null);
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
      setAccessibleCircles([]);
      setAccessibleCirclesError(null);
      return;
    }
    setRouteLoading(true);
    setAuthRouteError(null);
    try {
      const hasCircle = await userHasOwnerCircle(current.user.id);
      let hasProfile = await userExists(current.user.id);
      let circles = await listAccessibleCircles(current.user.id);
      const recoveredInvite = circles.length === 0
        ? await claimLatestAcceptedInvitationForUser({
            uid: current.user.id,
            email: current.user.email ?? '',
          })
        : null;
      if (recoveredInvite?.circleRef) {
        setInviteeProfilePrefill({
          email: recoveredInvite.email || current.user.email || '',
          realName: recoveredInvite.realName,
          displayName: recoveredInvite.displayName,
          mobile: recoveredInvite.mobile,
        });
        setOwnerCircleOfferCircleId(recoveredInvite.circleRef);
        hasProfile = true;
        circles = await listAccessibleCircles(current.user.id);
      }
      const recoveredProfileFromMembership = !hasProfile && circles.length > 0;
      if (recoveredProfileFromMembership) {
        await upsertUserFromAuth(current.user);
        hasProfile = true;
      }
      setHasOwnerCircle(hasCircle);
      setHasUserProfile(hasProfile);
      setAccessibleCircles(circles);
      setAccessibleCirclesError(null);
      if (recoveredProfileFromMembership) {
        setOwnerCircleOfferCircleId(circles[0].id);
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[bootstrap]', err);
      }
      setAuthRouteError(formatErrorMessage(err));
      setAccessibleCirclesError(formatErrorMessage(err));
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
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          if (isInvalidRefreshTokenError(error)) {
            await clearLocalAuthSession();
            if (!cancelled) {
              setSession(null);
              await refreshPostAuthRoute(null);
              setAuthRouteError('登入狀態已過期，請重新登入。');
            }
            return;
          }
          throw error;
        }
        if (cancelled) {
          return;
        }
        setSession(data.session);
        await refreshPostAuthRoute(data.session);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (isInvalidRefreshTokenError(err)) {
          await clearLocalAuthSession();
          setSession(null);
          await refreshPostAuthRoute(null);
          setAuthRouteError('登入狀態已過期，請重新登入。');
          return;
        }
        setAuthRouteError(formatErrorMessage(err));
        await refreshPostAuthRoute(null);
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
      setAppView('circleDetail');
      setInviteAfterCircle(null);
      postInviteShareUrlRef.current = null;
      if (session) {
        await refreshPostAuthRoute(session);
      }
    },
    [refreshPostAuthRoute, session],
  );

  useEffect(() => {
    let cancelled = false;

    const applyInviteDeepLink = async (token: string, circleId: string | null) => {
      setAcceptedInviteToken(token);
      if (circleId) {
        setPendingInviteCircleId(circleId);
      }
      await savePendingInviteDeepLink(token, circleId);
    };

    const consumeUrl = (url: string | null) => {
      const token = parseInvitationTokenFromUrl(url);
      if (!token) {
        return;
      }
      const circleId = parseInvitationCircleIdFromUrl(url);
      void applyInviteDeepLink(token, circleId);
    };

    const hydratePendingInvite = async () => {
      const stored = await readPendingInviteDeepLink();
      if (cancelled || !stored.token) {
        return;
      }
      setAcceptedInviteToken((current) => current ?? stored.token);
      if (stored.circleId) {
        setPendingInviteCircleId((current) => current ?? stored.circleId);
      }
    };

    void hydratePendingInvite();
    Linking.getInitialURL().then((url) => consumeUrl(url));
    const sub = Linking.addEventListener('url', (event) => consumeUrl(event.url));

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!acceptedInviteToken) {
      setInviteMetaReady(false);
      return;
    }
    let cancelled = false;
    const loadInvitePrefill = async () => {
      setInviteMetaReady(false);
      try {
        const row = await fetchInvitationByToken(acceptedInviteToken);
        if (cancelled || !row) {
          return;
        }
        if (row.circle_ref) {
          setPendingInviteCircleId(row.circle_ref);
        }
        const userProfile = session?.user.id ? await fetchUserProfilePrefill(session.user.id) : null;
        const authDisplayName =
          (typeof session?.user.user_metadata?.full_name === 'string' && session.user.user_metadata.full_name) ||
          (typeof session?.user.user_metadata?.name === 'string' && session.user.user_metadata.name) ||
          '';
        setInviteeProfilePrefill({
          email: userProfile?.email || row.invited_email || session?.user.email || '',
          realName: userProfile?.realName || row.invitee_real_name || '',
          displayName: userProfile?.displayName || row.invitee_display_name || authDisplayName,
          mobile: userProfile?.mobile || row.invitee_mobile || '',
        });
      } catch (err) {
        if (__DEV__) {
          console.warn('[invite-prefill]', err);
        }
      } finally {
        if (!cancelled) {
          setInviteMetaReady(true);
        }
      }
    };
    void loadInvitePrefill();
    return () => {
      cancelled = true;
    };
  }, [acceptedInviteToken, session?.user.email, session?.user.id, session?.user.user_metadata]);

  useEffect(() => {
    const user = session?.user;
    if (!user || !acceptedInviteToken || !inviteMetaReady) {
      return;
    }
    if (claimingInviteTokenRef.current === acceptedInviteToken) {
      return;
    }

    claimingInviteTokenRef.current = acceptedInviteToken;
    let cancelled = false;

    const resolveInviteNavigation = async (circleId: string | null): Promise<boolean> => {
      if (!circleId || cancelled) {
        return false;
      }
      try {
        const isMember = await userIsCircleMember(circleId, user.id);
        if (!cancelled && isMember) {
          setOwnerCircleOfferCircleId(circleId);
          setPendingInviteCircleId(null);
          setAcceptedInviteToken(null);
          await clearPendingInviteDeepLink();
          return true;
        }
      } catch (memberErr) {
        if (__DEV__) {
          console.warn('[invite-member-check]', memberErr);
        }
      }
      return false;
    };

    const claimNow = async () => {
      let navigated = false;
      try {
        setRouteLoading(true);
        await upsertUserFromAuth(user);
        const claim = await claimInvitationForExistingProfile({
          uid: user.id,
          email: user.email ?? '',
          token: acceptedInviteToken,
        });
        if (cancelled) {
          return;
        }
        setAcceptedInviteToken(null);
        const targetCircleId = claim.circleRef ?? pendingInviteCircleId;
        if (targetCircleId) {
          setOwnerCircleOfferCircleId(targetCircleId);
          setPendingInviteCircleId(null);
          navigated = true;
          await clearPendingInviteDeepLink();
        }
        await refreshPostAuthRoute(session);
      } catch (err) {
        if (!cancelled) {
          navigated = await resolveInviteNavigation(pendingInviteCircleId);
          if (!navigated) {
            Alert.alert('邀請處理失敗', formatErrorMessage(err));
          }
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
  }, [acceptedInviteToken, inviteMetaReady, pendingInviteCircleId, refreshPostAuthRoute, session]);

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
    setActiveCircleUnreadCount(0);
    setActiveSlotId(null);
    setActiveSlotUnreadCount(0);
    setActiveSlotRelatedIds([]);
    setActiveEventId(null);
    setActiveEventRelatedIds([]);
    setLocallyReadDiscussionKeys({});
    setActiveSlotDateRange(null);
    setActiveEventDateRange(null);
    setActiveEventUnreadCount(0);
    setActiveDiscussion(null);
    setCreateContext(null);
    setAccessibleCircles([]);
    setAccessibleCirclesError(null);
    setEventCircleRefs({});
    setRequestedSlotCount(0);
    setBookedSlotCount(0);
    setAppView('home');
    setInviteAfterCircle(null);
    setOwnerCircleOfferCircleId(null);
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
      if (result.joinedViaInvitation) {
        setPendingInviteCircleId(null);
        await clearPendingInviteDeepLink();
      }
      if (result.circleId) {
        if (result.joinedViaInvitation) {
          setOwnerCircleOfferCircleId(result.circleId);
        } else {
          setActiveCircleId(result.circleId);
          setAppView('circleDetail');
        }
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
      setOwnerCircleOfferCircleId(null);
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
      if (ownerCircleOfferCircleId) {
        const targetCircleId = ownerCircleOfferCircleId;
        setOwnerCircleOfferCircleId(null);
        setAcceptedInviteToken(null);
        setPendingInviteCircleId(null);
        await clearPendingInviteDeepLink();
        setActiveCircleId(targetCircleId);
        setAppView('circleDetail');
        await refreshPostAuthRoute(session);
        return;
      }
      if (acceptedInviteToken) {
        const result = await createFirstCircleAndInvites({
          uid: user.id,
          email: inviteeProfilePrefill?.email || user.email || null,
          circleName: '',
          realName: inviteeProfilePrefill?.realName ?? '',
          displayName:
            inviteeProfilePrefill?.displayName ||
            (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '') ||
            (typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : ''),
          photoUrl:
            (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
            null,
          mobile: inviteeProfilePrefill?.mobile ?? '',
          inviteEmails: [],
          inviteBaseUrl,
          acceptedInviteToken,
          inviteMethod: 'none',
        });
        const targetCircleId = result.circleId ?? pendingInviteCircleId;
        setHasOwnerCircle(false);
        setHasUserProfile(true);
        setAcceptedInviteToken(null);
        setPendingInviteCircleId(null);
        await clearPendingInviteDeepLink();
        if (targetCircleId) {
          setOwnerCircleOfferCircleId(targetCircleId);
          await refreshPostAuthRoute(session);
        }
        return;
      }
      const recoveredInvite = await claimLatestAcceptedInvitationForUser({
        uid: user.id,
        email: user.email ?? '',
      });
      if (recoveredInvite?.circleRef) {
        setInviteeProfilePrefill({
          email: recoveredInvite.email || user.email || '',
          realName: recoveredInvite.realName,
          displayName: recoveredInvite.displayName,
          mobile: recoveredInvite.mobile,
        });
        setHasOwnerCircle(false);
        setHasUserProfile(true);
        setOwnerCircleOfferCircleId(recoveredInvite.circleRef);
        await refreshPostAuthRoute(session);
        return;
      }
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

  const openCircleDetail = (circleId: string, activityUnreadCount?: number) => {
    setActiveDiscussion(null);
    setActiveCircleId(circleId);
    setActiveCircleUnreadCount((current) => (
      activityUnreadCount ?? (activeCircleId === circleId ? current : circleUnreadCounts[circleId] ?? 0)
    ));
    setAppView('circleDetail');
  };

  const startCreateFlow = (
    mode: 'slot' | 'event',
    circleIds: string[] = [],
    lockCircleSelection = false,
  ) => {
    setCreateContext({ mode, circleIds, lockCircleSelection, dates: [] });
    setAppView('chooseDate');
  };

  const returnAfterCreateCancel = () => {
    if (createContext?.lockCircleSelection && createContext.circleIds[0]) {
      openCircleDetail(createContext.circleIds[0]);
      return;
    }
    setAppView('home');
  };

  const handleCreateCircle = async (circleName: string) => {
    const user = session?.user;
    if (!user) {
      return;
    }
    try {
      setOnboardingBusy(true);
      const circleId = await createCircleForExistingUser({ uid: user.id, circleName });
      setHasOwnerCircle(true);
      setHasUserProfile(true);
      setInviteAfterCircle({ circleId, circleName });
      await refreshPostAuthRoute(session);
    } catch (err) {
      Alert.alert('新增密友圈失敗', formatErrorMessage(err));
    } finally {
      setOnboardingBusy(false);
    }
  };

  const inviteFriendFromCircle = (circleId: string, circleName: string) => {
    setInviteAfterCircle({ circleId, circleName });
  };

  useEffect(() => {
    if (!session?.user.id) {
      return;
    }

    const channel = supabase
      .channel(`app-discussion-unread:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'discussion_messages',
        },
        (payload) => {
          const row = payload.new as { scope?: 'slot' | 'event'; target_id?: string; sender_id?: string };
          if (row.scope && row.target_id && row.sender_id !== session.user.id) {
            const key = discussionKey(row.scope, row.target_id);
            setLocallyReadDiscussionKeys((current) => {
              if (!current[key]) {
                return current;
              }
              const next = { ...current };
              delete next[key];
              return next;
            });
          }
          setUnreadRefreshTick((tick) => tick + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || accessibleCircles.length === 0) {
      setCircleUnreadCounts({});
      setEventUnreadCounts({});
      setEventCircleRefs({});
      setSlotDiscussionUnreadCounts({});
      setSlotUnreadCount(0);
      setRequestedSlotCount(0);
      setBookedSlotCount(0);
      return;
    }

    let cancelled = false;
    const loadCircleUnreadCounts = async () => {
      try {
        const events = await listEventsForUnreadBadges(userId);
        const eventSummaries = await listDiscussionSummaries(
          userId,
          events.map((event) => ({ scope: 'event', targetId: event.id })),
        );
        const counts: Record<string, number> = {};
        const nextEventUnreadCounts: Record<string, number> = {};
        const nextEventCircleRefs: Record<string, string> = {};
        for (const event of events) {
          nextEventCircleRefs[event.id] = event.circleRef;
          const key = discussionKey('event', event.id);
          const unreadCount = locallyReadDiscussionKeys[key] ? 0 : eventSummaries.get(key)?.unreadCount ?? 0;
          if (unreadCount > 0) {
            nextEventUnreadCounts[event.id] = unreadCount;
            counts[event.circleRef] = (counts[event.circleRef] ?? 0) + unreadCount;
          }
        }
        if (!cancelled) {
          setCircleUnreadCounts(counts);
          setEventUnreadCounts(nextEventUnreadCounts);
          setEventCircleRefs(nextEventCircleRefs);
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[event-unread]', err);
        }
      }

      try {
        const slotTargets = await listUserDiscussionTargets(userId, 'slot');
        const slotSummaries = await listDiscussionSummaries(
          userId,
          slotTargets,
        );
        let nextSlotUnreadCount = 0;
        const nextSlotDiscussionUnreadCounts: Record<string, number> = {};
        for (const target of slotTargets) {
          const key = discussionKey('slot', target.targetId);
          const unreadCount = locallyReadDiscussionKeys[key] ? 0 : slotSummaries.get(key)?.unreadCount ?? 0;
          if (unreadCount > 0) {
            nextSlotDiscussionUnreadCounts[target.targetId] = unreadCount;
          }
          nextSlotUnreadCount += unreadCount;
        }
        if (!cancelled) {
          setSlotDiscussionUnreadCounts(nextSlotDiscussionUnreadCounts);
          setSlotUnreadCount(nextSlotUnreadCount);
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[slot-unread]', err);
        }
        if (!cancelled) {
          setSlotDiscussionUnreadCounts({});
          setSlotUnreadCount(0);
          setBookedSlotCount(0);
        }
      }

      try {
        const bookingCounts = await countSlotBookingBucketsForUser(userId);
        if (!cancelled) {
          setRequestedSlotCount(bookingCounts.requestedCount);
          setBookedSlotCount(bookingCounts.acceptedCount);
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[slot-booked-count]', err);
        }
        if (!cancelled) {
          setRequestedSlotCount(0);
          setBookedSlotCount(0);
        }
      }
    };

    void loadCircleUnreadCounts();
    return () => {
      cancelled = true;
    };
  }, [accessibleCircles.length, session?.user.id, unreadRefreshTick, locallyReadDiscussionKeys]);

  const clearDiscussionUnread = (scope: DiscussionContext['scope'], targetId: string, relatedTargetIds: string[] = []) => {
    const targetIds = Array.from(new Set([targetId, ...relatedTargetIds]));
    const targetKeys = targetIds.map((id) => discussionKey(scope, id));
    setLocallyReadDiscussionKeys((current) => {
      const next = { ...current };
      for (const key of targetKeys) {
        next[key] = true;
      }
      return next;
    });
    if (scope === 'slot') {
      let clearedCount = targetIds.reduce((total, id) => total + (slotDiscussionUnreadCounts[id] ?? 0), 0);
      if (clearedCount === 0 && activeSlotUnreadCount > 0) {
        clearedCount = activeSlotUnreadCount;
      }
      setActiveSlotUnreadCount(0);
      setSlotDiscussionUnreadCounts((current) => {
        const next = { ...current };
        for (const id of targetIds) {
          delete next[id];
        }
        return next;
      });
      setSlotUnreadCount((current) => Math.max(0, current - clearedCount));
      setUnreadRefreshTick((tick) => tick + 1);
      return;
    }

    let clearedCount = targetIds.reduce((total, id) => total + (eventUnreadCounts[id] ?? 0), 0);
    if (clearedCount === 0 && activeEventUnreadCount > 0) {
      clearedCount = activeEventUnreadCount;
    }
    const clearedCountsByCircle = targetIds.reduce<Record<string, number>>((acc, id) => {
      const circleId = eventCircleRefs[id] ?? activeCircleId;
      const unreadCount = eventUnreadCounts[id] ?? 0;
      if (circleId && unreadCount > 0) {
        acc[circleId] = (acc[circleId] ?? 0) + unreadCount;
      }
      return acc;
    }, {});
    if (Object.keys(clearedCountsByCircle).length === 0 && activeCircleId && clearedCount > 0) {
      clearedCountsByCircle[activeCircleId] = clearedCount;
    }
    setActiveEventUnreadCount(0);
    setEventUnreadCounts((current) => {
      const next = { ...current };
      for (const id of targetIds) {
        delete next[id];
      }
      return next;
    });
    if (activeCircleId) {
      const activeCircleClearedCount = clearedCountsByCircle[activeCircleId] ?? clearedCount;
      setActiveCircleUnreadCount((current) => Math.max(0, current - activeCircleClearedCount));
    } else {
      setActiveCircleUnreadCount(0);
    }
    setCircleUnreadCounts((current) => {
      const next = { ...current };
      for (const [circleId, count] of Object.entries(clearedCountsByCircle)) {
        const nextCount = Math.max(0, (next[circleId] ?? 0) - count);
        if (nextCount > 0) {
          next[circleId] = nextCount;
        } else {
          delete next[circleId];
        }
      }
      return next;
    });
    setUnreadRefreshTick((tick) => tick + 1);
  };

  const displayedEventUnreadCounts = Object.fromEntries(
    Object.entries(eventUnreadCounts).filter(([eventId]) => !locallyReadDiscussionKeys[discussionKey('event', eventId)]),
  );
  const displayedCircleUnreadCounts = Object.entries(displayedEventUnreadCounts).reduce<Record<string, number>>(
    (acc, [eventId, unreadCount]) => {
      const circleId = eventCircleRefs[eventId];
      if (circleId) {
        acc[circleId] = (acc[circleId] ?? 0) + unreadCount;
      }
      return acc;
    },
    {},
  );
  const displayedSlotUnreadCounts = Object.fromEntries(
    Object.entries(slotDiscussionUnreadCounts).filter(([slotId]) => !locallyReadDiscussionKeys[discussionKey('slot', slotId)]),
  );
  const displayedActivityUnreadCount = Object.values(displayedEventUnreadCounts).reduce((total, count) => total + count, 0);
  const displayedSlotUnreadCount = Object.values(displayedSlotUnreadCounts).reduce((total, count) => total + count, 0);

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
        invitePendingMessage={
          acceptedInviteToken
            ? '已收到邀請連結，登入後可選擇建立自己的密友圈，或稍後進入被邀請的密友圈。'
            : null
        }
      />
    );
  } else if (
    routeLoading ||
    ((hasOwnerCircle === null || hasUserProfile === null) && !authRouteError && !acceptedInviteToken)
  ) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>
          {acceptedInviteToken ? '正在加入密友圈…' : '載入中…'}
        </Text>
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
  } else if (session && ownerCircleOfferCircleId && !hasOwnerCircle) {
    body = (
      <CirclesOnboardingScreen
        busy={onboardingBusy}
        joiningViaInvitation={false}
        initialEmail={inviteeProfilePrefill?.email || session.user.email || null}
        initialRealName={inviteeProfilePrefill?.realName}
        initialDisplayName={inviteeProfilePrefill?.displayName}
        initialMobile={inviteeProfilePrefill?.mobile}
        onJoiningSubmit={handleJoiningOnboardingSubmit}
        onProfileAndCircleOnly={handleNewUserProfileAndCircle}
        onCancel={handleOnboardingCancel}
      />
    );
  } else if (!hasOwnerCircle && !hasUserProfile) {
    body = (
      <CirclesOnboardingScreen
        busy={onboardingBusy}
        joiningViaInvitation={Boolean(acceptedInviteToken)}
        initialEmail={inviteeProfilePrefill?.email || session?.user.email || null}
        initialRealName={inviteeProfilePrefill?.realName}
        initialDisplayName={inviteeProfilePrefill?.displayName}
        initialMobile={inviteeProfilePrefill?.mobile}
        onJoiningSubmit={handleJoiningOnboardingSubmit}
        onProfileAndCircleOnly={handleNewUserProfileAndCircle}
        onCancel={handleOnboardingCancel}
      />
    );
  } else if (appView === 'circleDetail' && activeCircleId) {
    body = (
      <CircleDetailScreen
        circleId={activeCircleId}
        userId={session.user.id}
        unreadRefreshKey={unreadRefreshTick}
        activityUnreadCount={displayedCircleUnreadCounts[activeCircleId] ?? 0}
        eventUnreadCounts={displayedEventUnreadCounts}
        slotUnreadCounts={displayedSlotUnreadCounts}
        locallyReadDiscussionKeys={locallyReadDiscussionKeys}
        onBack={() => {
          setActiveCircleId(null);
          setActiveCircleUnreadCount(0);
          setAppView('home');
        }}
        onCreateSlot={(circleId) => startCreateFlow('slot', [circleId], true)}
        onCreateEvent={(circleId) => startCreateFlow('event', [circleId], true)}
        onInviteFriend={inviteFriendFromCircle}
        onOpenSlot={(slotId, unreadCount, relatedTargetIds) => {
          setActiveDiscussion(null);
          setActiveSlotId(slotId);
          setActiveSlotRelatedIds(relatedTargetIds?.length ? relatedTargetIds : [slotId]);
          setActiveSlotUnreadCount(unreadCount ?? displayedSlotUnreadCounts[slotId] ?? 0);
          setActiveSlotDateRange(null);
          setAppView('slotDetail');
        }}
        onOpenEvent={(eventId, unreadCount, relatedEventIds) => {
          setActiveDiscussion(null);
          setActiveEventId(eventId);
          setActiveEventRelatedIds(relatedEventIds?.length ? relatedEventIds : [eventId]);
          setActiveEventDateRange(null);
          setActiveEventUnreadCount(unreadCount ?? displayedEventUnreadCounts[eventId] ?? 0);
          setAppView('eventDetail');
        }}
      />
    );
  } else if (appView === 'chooseDate' && createContext) {
    body = (
      <ChooseDateScreen
        mode={createContext.mode}
        onPickDates={(dates) => {
          setCreateContext({ ...createContext, dates });
          setAppView(createContext.mode === 'slot' ? 'createSlot' : 'createEvent');
        }}
        onCancel={returnAfterCreateCancel}
      />
    );
  } else if (appView === 'createSlot' && createContext?.dates[0]) {
    body = (
      <CreateSlotScreen
        userId={session.user.id}
        selectedDates={createContext.dates}
        circles={accessibleCircles}
        defaultCircleIds={createContext.circleIds}
        lockCircleSelection={createContext.lockCircleSelection}
        onCreated={() => {
          setCreateContext(null);
          setActiveDiscussion(null);
          setActiveSlotId(null);
          setActiveSlotRelatedIds([]);
          setActiveSlotDateRange(null);
          setUnreadRefreshTick((tick) => tick + 1);
          setAppView('home');
        }}
        onCancel={returnAfterCreateCancel}
      />
    );
  } else if (appView === 'slotDetail' && activeSlotId) {
    body = (
      <SlotDetailScreen
        slotId={activeSlotId}
        userId={session.user.id}
        circles={accessibleCircles}
        contextCircleId={activeCircleId}
        displayDateRange={activeSlotDateRange}
        unreadRefreshKey={unreadRefreshTick}
        unreadCountOverride={Math.max(
          activeSlotRelatedIds.reduce((total, id) => total + (displayedSlotUnreadCounts[id] ?? 0), 0),
          activeSlotUnreadCount,
        )}
        suppressUnread={
          activeSlotRelatedIds.length > 0
          && activeSlotRelatedIds.every((id) => Boolean(locallyReadDiscussionKeys[discussionKey('slot', id)]))
        }
        locallyReadDiscussionKeys={locallyReadDiscussionKeys}
        onBookingChanged={() => setUnreadRefreshTick((tick) => tick + 1)}
        onOpenDiscussion={(targetId, title, subtitle, relatedTargetIds) => {
          setActiveDiscussion({
            scope: 'slot',
            targetId,
            relatedTargetIds: relatedTargetIds?.length ? relatedTargetIds : [targetId],
            title,
            subtitle,
            backLabel: '返回悠閒時光',
          });
          setAppView('slotDiscussion');
        }}
        onBack={() => {
          if (activeCircleId) {
            openCircleDetail(activeCircleId);
          } else if (createContext?.lockCircleSelection && createContext.circleIds[0]) {
            openCircleDetail(createContext.circleIds[0]);
          } else {
            setAppView('slots');
          }
        }}
      />
    );
  } else if (appView === 'slotDiscussion' && activeDiscussion?.scope === 'slot') {
    body = (
      <DiscussionScreen
        scope={activeDiscussion.scope}
        targetId={activeDiscussion.targetId}
        userId={session.user.id}
        title={activeDiscussion.title}
        subtitle={activeDiscussion.subtitle}
        targetBackLabel={activeDiscussion.backLabel}
        relatedTargetIds={activeDiscussion.relatedTargetIds}
        onRead={() => clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds)}
        onHome={() => {
          clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds);
          setActiveDiscussion(null);
          setAppView('home');
        }}
        onBackToTarget={() => {
          clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds);
          setActiveSlotUnreadCount(0);
          setAppView('slotDetail');
        }}
      />
    );
  } else if (appView === 'createEvent' && createContext?.dates.length) {
    body = (
      <CreateEventScreen
        userId={session.user.id}
        selectedDates={createContext.dates}
        circles={accessibleCircles}
        defaultCircleIds={createContext.circleIds}
        lockCircleSelection={createContext.lockCircleSelection}
        onCreated={(eventId) => {
          setActiveDiscussion(null);
          setActiveEventId(eventId);
          setActiveEventRelatedIds([eventId]);
          setActiveEventUnreadCount(0);
          setActiveEventDateRange(
            createContext.dates.length > 1
              ? {
                  startDate: createContext.dates[0],
                  endDate: createContext.dates[createContext.dates.length - 1],
                }
              : null,
          );
          setAppView('eventDetail');
        }}
        onCancel={returnAfterCreateCancel}
      />
    );
  } else if (appView === 'eventDetail' && activeEventId) {
    body = (
      <EventDetailScreen
        eventId={activeEventId}
        userId={session.user.id}
        circles={accessibleCircles}
        displayDateRange={activeEventDateRange}
        unreadRefreshKey={unreadRefreshTick}
        unreadCountOverride={Math.max(displayedEventUnreadCounts[activeEventId] ?? 0, activeEventUnreadCount)}
        suppressUnread={Boolean(locallyReadDiscussionKeys[discussionKey('event', activeEventId)])}
        onOpenDiscussion={(title, subtitle) => {
          setActiveDiscussion({
            scope: 'event',
            targetId: activeEventId,
            relatedTargetIds: activeEventRelatedIds.includes(activeEventId) ? activeEventRelatedIds : [activeEventId],
            title,
            subtitle,
            backLabel: '返回該活動',
          });
          setAppView('eventDiscussion');
        }}
        onBack={() => {
          if (activeCircleId) {
            openCircleDetail(activeCircleId);
          } else if (createContext?.lockCircleSelection && createContext.circleIds[0]) {
            openCircleDetail(createContext.circleIds[0]);
          } else {
            setAppView('events');
          }
        }}
      />
    );
  } else if (appView === 'eventDiscussion' && activeDiscussion?.scope === 'event') {
    body = (
      <DiscussionScreen
        scope={activeDiscussion.scope}
        targetId={activeDiscussion.targetId}
        userId={session.user.id}
        title={activeDiscussion.title}
        subtitle={activeDiscussion.subtitle}
        targetBackLabel={activeDiscussion.backLabel}
        relatedTargetIds={activeDiscussion.relatedTargetIds}
        onRead={() => clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds)}
        onHome={() => {
          clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds);
          setActiveDiscussion(null);
          setAppView('home');
        }}
        onBackToTarget={() => {
          clearDiscussionUnread(activeDiscussion.scope, activeDiscussion.targetId, activeDiscussion.relatedTargetIds);
          setAppView('eventDetail');
        }}
      />
    );
  } else if (appView === 'circles') {
    body = (
      <CirclesScreen
        circles={accessibleCircles}
        circleUnreadCounts={displayedCircleUnreadCounts}
        onOpenCircle={openCircleDetail}
        onBack={() => setAppView('home')}
      />
    );
  } else if (appView === 'slots') {
    body = (
      <SlotsScreen
        userId={session.user.id}
        circles={accessibleCircles}
        onOpenSlot={(slotId, dateRange, unreadCount, relatedSlotIds) => {
          setCreateContext(null);
          setActiveDiscussion(null);
          setActiveSlotId(slotId);
          setActiveSlotRelatedIds(relatedSlotIds?.length ? relatedSlotIds : [slotId]);
          setActiveSlotUnreadCount(unreadCount ?? displayedSlotUnreadCounts[slotId] ?? 0);
          setActiveSlotDateRange(dateRange ?? null);
          setAppView('slotDetail');
        }}
        onBack={() => setAppView('home')}
      />
    );
  } else if (appView === 'events') {
    body = (
      <EventsScreen
        userId={session.user.id}
        circles={accessibleCircles}
        onOpenEvent={(eventId, dateRange, unreadCount, relatedEventIds) => {
          setCreateContext(null);
          setActiveDiscussion(null);
          setActiveEventId(eventId);
          setActiveEventRelatedIds(relatedEventIds?.length ? relatedEventIds : [eventId]);
          setActiveEventUnreadCount(unreadCount ?? displayedEventUnreadCounts[eventId] ?? 0);
          setActiveEventDateRange(dateRange ?? null);
          setAppView('eventDetail');
        }}
        onBack={() => setAppView('home')}
      />
    );
  } else if (appView === 'createCircle') {
    body = (
      <CreateCircleScreen
        busy={onboardingBusy}
        onCreate={handleCreateCircle}
        onCancel={() => setAppView('home')}
      />
    );
  } else {
    body = (
      <HomeScreen
        userLabel={userLabel}
        circles={accessibleCircles}
        circleUnreadCounts={displayedCircleUnreadCounts}
        activityUnreadCount={displayedActivityUnreadCount}
        slotUnreadCount={displayedSlotUnreadCount}
        requestedSlotCount={requestedSlotCount}
        bookedSlotCount={bookedSlotCount}
        circlesLoading={routeLoading}
        circlesError={accessibleCirclesError}
        onOpenCircle={openCircleDetail}
        onCreateSlot={() => startCreateFlow('slot')}
        onCreateEvent={() => startCreateFlow('event')}
        onCreateCircle={() => setAppView('createCircle')}
        onOpenCircles={() => setAppView('circles')}
        onOpenSlots={() => {
          setCreateContext(null);
          setAppView('slots');
        }}
        onOpenEvents={() => {
          setCreateContext(null);
          setAppView('events');
        }}
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
