/** Public runtime config. Values come from EXPO_PUBLIC_* env vars (see .env.example). */
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!anonKey && process.env.NODE_ENV !== 'test') {
  console.warn(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. Copy apps/mobile/.env.example to .env.local and fill it in.',
  );
}

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  // Placeholder keeps the app bootable without config; every request will fail auth until set.
  supabaseAnonKey: anonKey || 'missing-anon-key',
  isConfigured: anonKey.length > 0,
};
