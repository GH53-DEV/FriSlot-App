import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

const AUTH_SCHEME = 'frislotnew';
const AUTH_CALLBACK_PATH = 'auth/callback';
const FALLBACK_REDIRECT_URI = `${AUTH_SCHEME}://${AUTH_CALLBACK_PATH}`;

function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

function getWebOAuthCallbackUrl(): string | null {
  const inviteBaseUrl = Constants.expoConfig?.extra?.inviteBaseUrl;
  if (typeof inviteBaseUrl !== 'string' || !inviteBaseUrl.startsWith('http')) {
    return null;
  }

  return inviteBaseUrl.replace(/\/invite\/?$/i, '/oauth/callback.html');
}

function getNativeOAuthRedirectUri(): string | null {
  const redirectUri = makeRedirectUri({
    scheme: AUTH_SCHEME,
    path: AUTH_CALLBACK_PATH,
    preferLocalhost: false,
  });
  if (redirectUri && !redirectUri.includes('example.com')) {
    return redirectUri;
  }

  const linkingUrl = Linking.createURL(AUTH_CALLBACK_PATH);
  if (linkingUrl && !linkingUrl.includes('example.com')) {
    return linkingUrl;
  }

  return null;
}

function buildExpoGoBridgeRedirectUri(webCallback: string): string | null {
  try {
    const nativeResume = Linking.createURL(AUTH_CALLBACK_PATH);
    if (!nativeResume || nativeResume.includes('example.com')) {
      return null;
    }

    const bridge = new URL(webCallback);
    bridge.searchParams.set('to', nativeResume);
    return bridge.toString();
  } catch {
    return null;
  }
}

export function getGoogleOAuthRedirectUri(): string {
  try {
    if (isExpoGo()) {
      const webCallback = getWebOAuthCallbackUrl();
      if (webCallback) {
        return buildExpoGoBridgeRedirectUri(webCallback) ?? webCallback;
      }

      const redirectUri = makeRedirectUri({
        path: AUTH_CALLBACK_PATH,
        preferLocalhost: false,
      });
      if (redirectUri && !redirectUri.includes('example.com')) {
        return redirectUri;
      }

      const linkingUrl = Linking.createURL(AUTH_CALLBACK_PATH);
      if (linkingUrl && !linkingUrl.includes('example.com')) {
        return linkingUrl;
      }
    } else {
      const nativeRedirect = getNativeOAuthRedirectUri();
      if (nativeRedirect) {
        return nativeRedirect;
      }
    }
  } catch {
    // Expo Go 尚未完成初始化時，仍回傳可設定的預設 deep link。
  }

  return FALLBACK_REDIRECT_URI;
}

export function getOAuthAuthSessionReturnUrl(redirectTo: string): string {
  if (!redirectTo.startsWith('http')) {
    return redirectTo;
  }

  try {
    const parsed = new URL(redirectTo);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return redirectTo.split('?')[0] ?? redirectTo;
  }
}

export function isMisconfiguredOAuthRedirect(url: string): boolean {
  return /example\.com/i.test(url);
}
