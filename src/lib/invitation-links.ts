import * as Linking from 'expo-linking';

export function parseInvitationTokenFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const parsed = Linking.parse(url);
  const path = typeof parsed.path === 'string' ? parsed.path : '';
  const token = parsed.queryParams?.token;

  if (path !== 'invite') {
    return null;
  }

  return typeof token === 'string' && token.trim() ? token.trim() : null;
}
