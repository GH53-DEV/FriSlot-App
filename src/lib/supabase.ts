import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

const extra = Constants.expoConfig?.extra ?? {};
const rawSupabaseUrl = extra.supabaseUrl as string | undefined;
const rawSupabaseKey = (extra.supabaseAnonKey ?? extra.supabasePublishableKey) as
  | string
  | undefined;
const rawInviteBaseUrl = extra.inviteBaseUrl as string | undefined;

if (!rawSupabaseUrl || !rawSupabaseKey) {
  throw new Error(
    'Supabase config missing. Set expo.extra.supabaseUrl and expo.extra.supabaseAnonKey (or supabasePublishableKey) in app.json.'
  );
}

const supabaseUrl: string = rawSupabaseUrl;
const supabaseKey: string = rawSupabaseKey;
const inviteBaseUrl: string = rawInviteBaseUrl ?? 'https://frislot.app/invite';
const supabaseProjectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return null;
  }
})();
const AUTH_STORAGE_KEY = 'frislot_supabase_auth_v3';
const LEGACY_AUTH_STORAGE_KEYS = [
  'frislot_supabase_auth_v2',
  'supabase.auth.token',
  ...(supabaseProjectRef ? [`sb-${supabaseProjectRef}-auth-token`] : []),
];
let clearLegacyAuthStoragePromise: Promise<void> | null = null;

function clearLegacyAuthStorage() {
  clearLegacyAuthStoragePromise ??= AsyncStorage.multiRemove(LEGACY_AUTH_STORAGE_KEYS).catch((err) => {
    if (__DEV__) {
      console.warn('[auth-storage-clear]', err);
    }
  });
  return clearLegacyAuthStoragePromise;
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: {
      getItem: async (key: string) => {
        await clearLegacyAuthStorage();
        return AsyncStorage.getItem(key);
      },
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    },
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export { inviteBaseUrl, supabaseKey, supabaseUrl };
