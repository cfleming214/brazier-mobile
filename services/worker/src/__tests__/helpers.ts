import { createServiceClient } from '../db';
import type { FetchJson } from '../http';

/** Integration tests run against local Supabase when the service role key is in the env. */
export const hasDb = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export function testDb() {
  return createServiceClient({
    SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  });
}

/** fetchJson stub that serves fixtures by URL substring. */
export function fixtureFetch(routes: Record<string, unknown>): FetchJson & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`No fixture for ${url}`);
    return structuredClone(routes[key]);
  }) as FetchJson & { calls: string[] };
  fn.calls = calls;
  return fn;
}
