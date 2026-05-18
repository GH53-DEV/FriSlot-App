import * as Linking from 'expo-linking';

function isInviteRoute(parsed: Linking.ParsedURL): boolean {
  const path = typeof parsed.path === 'string' ? parsed.path.replace(/^\//, '') : '';
  const hostname = typeof parsed.hostname === 'string' ? parsed.hostname : '';
  return path === 'invite' || hostname === 'invite';
}

function readQueryParam(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[?&]${key}=([^&#]+)`, 'i'));
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
  } catch {
    return match[1].trim();
  }
}

function isInviteUrl(url: string): boolean {
  return /invite/i.test(url) && /[?&]token=/i.test(url);
}

export function parseInvitationTokenFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const parsed = Linking.parse(url);
  if (isInviteRoute(parsed)) {
    const token = parsed.queryParams?.token;
    if (typeof token === 'string' && token.trim()) {
      return token.trim();
    }
  }

  if (isInviteUrl(url)) {
    return readQueryParam(url, 'token');
  }

  return null;
}

export function parseInvitationCircleIdFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const parsed = Linking.parse(url);
  if (isInviteRoute(parsed)) {
    const circleId = parsed.queryParams?.circle_id;
    if (typeof circleId === 'string' && circleId.trim()) {
      return circleId.trim();
    }
  }

  if (isInviteUrl(url)) {
    return readQueryParam(url, 'circle_id');
  }

  return null;
}
