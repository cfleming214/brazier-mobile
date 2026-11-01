import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from './config';

/** Service-role client. Bypasses RLS: only the worker uses it, never the app. */
export function createServiceClient(
  config: Pick<Config, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
