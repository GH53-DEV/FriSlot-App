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

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export { inviteBaseUrl, supabaseKey, supabaseUrl };
