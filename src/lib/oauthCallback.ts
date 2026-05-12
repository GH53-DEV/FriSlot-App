import * as Linking from 'expo-linking';
import { supabase } from './supabase';

export function isOAuthCallbackUrl(url: string): boolean {
  return (
    /auth\/callback|oauth\/callback\.html/i.test(url) ||
    /[?#&]code=/.test(url) ||
    /[?#&]access_token=/.test(url)
  );
}

export async function completeOAuthSessionFromUrl(url: string): Promise<boolean> {
  let code: string | null = null;
  let errorDescription: string | null = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  try {
    const parsed = new URL(url);
    code = parsed.searchParams.get('code');
    errorDescription = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    accessToken = parsed.searchParams.get('access_token');
    refreshToken = parsed.searchParams.get('refresh_token');
    if (!accessToken && parsed.hash) {
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      accessToken = hashParams.get('access_token');
      refreshToken = hashParams.get('refresh_token');
    }
  } catch {
    const { queryParams } = Linking.parse(url);
    code = typeof queryParams?.code === 'string' ? queryParams.code : null;
    errorDescription =
      (typeof queryParams?.error_description === 'string' && queryParams.error_description) ||
      (typeof queryParams?.error === 'string' && queryParams.error) ||
      null;
  }

  if (typeof code === 'string') {
    const exchangeResult = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeResult.error) {
      throw exchangeResult.error;
    }
    return true;
  }

  if (accessToken && refreshToken) {
    const setSessionResult = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (setSessionResult.error) {
      throw setSessionResult.error;
    }
    return true;
  }

  if (errorDescription) {
    throw new Error(errorDescription);
  }

  return false;
}

export const OAUTH_CALLBACK_WAIT_MS = 90_000;

export function getRedirectToFromOAuthUrl(oauthUrl: string): string | null {
  try {
    return new URL(oauthUrl).searchParams.get('redirect_to');
  } catch {
    return null;
  }
}

export function waitForOAuthCallbackUrl(timeoutMs = OAUTH_CALLBACK_WAIT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let sub: { remove: () => void } | null = null;
    const timer = setTimeout(() => {
      sub?.remove();
      resolve(null);
    }, timeoutMs);

    sub = Linking.addEventListener('url', (event) => {
      if (!isOAuthCallbackUrl(event.url)) {
        return;
      }
      clearTimeout(timer);
      sub?.remove();
      resolve(event.url);
    });
  });
}
