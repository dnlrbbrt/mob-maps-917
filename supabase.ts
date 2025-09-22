import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

type Extra = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

const extra = (Constants.expoConfig?.extra || {}) as Extra;

if (!extra.SUPABASE_URL || !extra.SUPABASE_ANON_KEY) {
  // Values will be set in app.json -> extra
  // Avoid throwing to allow app to render a helpful message.
  console.warn('Supabase URL/Anon key not set in app.json extra.');
}

export const supabase = createClient(
  extra.SUPABASE_URL || 'http://localhost',
  extra.SUPABASE_ANON_KEY || 'anon',
  { auth: { persistSession: true } }
);





