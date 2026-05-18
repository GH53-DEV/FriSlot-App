import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'frislot_pending_invite_token';
const CIRCLE_KEY = 'frislot_pending_invite_circle_id';

export async function savePendingInviteDeepLink(token: string, circleId?: string | null) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  if (circleId) {
    await AsyncStorage.setItem(CIRCLE_KEY, circleId);
  } else {
    await AsyncStorage.removeItem(CIRCLE_KEY);
  }
}

export async function readPendingInviteDeepLink(): Promise<{
  token: string | null;
  circleId: string | null;
}> {
  const [token, circleId] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(CIRCLE_KEY),
  ]);
  return {
    token: token?.trim() || null,
    circleId: circleId?.trim() || null,
  };
}

export async function clearPendingInviteDeepLink() {
  await AsyncStorage.multiRemove([TOKEN_KEY, CIRCLE_KEY]);
}
