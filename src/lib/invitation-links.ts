import * as Linking from 'expo-linking';

function isInviteRoute(parsed: Linking.ParsedURL): boolean {
  const path = typeof parsed.path === 'string' ? parsed.path.replace(/^\//, '') : '';
  const hostname = typeof parsed.hostname === 'string' ? parsed.hostname : '';
  return path === 'invite' || hostname === 'invite';
}

export function parseInvitationTokenFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const parsed = Linking.parse(url);
  if (!isInviteRoute(parsed)) {
    return null;
  }

  const token = parsed.queryParams?.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

export function parseInvitationCircleIdFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const parsed = Linking.parse(url);
  if (!isInviteRoute(parsed)) {
    return null;
  }

  const circleId = parsed.queryParams?.circle_id;
  return typeof circleId === 'string' && circleId.trim() ? circleId.trim() : null;
}
