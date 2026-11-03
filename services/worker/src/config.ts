import { z } from 'zod';

const Env = z.object({
  SUPABASE_URL: z.string().url().default('http://127.0.0.1:54321'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  POKEMONTCG_API_KEY: z.string().optional(),
  POKEMONTCG_BASE_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  TCGCSV_BASE_URL: z.string().url().default('https://tcgcsv.com/tcgplayer'),
  USER_AGENT: z.string().default('Brazier/0.1 (+https://brazier.app/bot)'),
  BESTBUY_API_KEY: z.string().optional(),
  WALMART_CONSUMER_ID: z.string().optional(),
  WALMART_PRIVATE_KEY: z.string().optional(),
  WALMART_KEY_VERSION: z.string().default('1'),
  AMAZON_ACCESS_KEY: z.string().optional(),
  AMAZON_SECRET_KEY: z.string().optional(),
  AMAZON_PARTNER_TAG: z.string().optional(),
  /** When set, every adapter talks to the fake retailer instead (integration and E2E tests). */
  FAKE_RETAILER_URL: z.string().url().optional(),
  EXPO_PUSH_URL: z.string().url().default('https://exp.host'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  TICK_MS: z.coerce.number().int().positive().default(1000),
  /** E2E only: shrink tier intervals (e.g. 0.02). Ignored unless FAKE_RETAILER_URL is set. */
  POLL_INTERVAL_SCALE: z.coerce.number().positive().max(1).default(1),
  /** JSON array of {url, source, trust} RSS/Atom feeds for the calendar (official news, TCG news sites). */
  CALENDAR_FEEDS: z
    .string()
    .default('[]')
    .transform(
      (s) => JSON.parse(s) as { url: string; source: string; trust: 'official' | 'news' }[],
    ),
  /** Shared secret for the inbound newsletter webhook (POST /inbound/email). */
  INBOUND_SECRET: z.string().optional(),
  /** Worker error reporting (DROP-53); unset disables Sentry. */
  SENTRY_DSN: z.string().url().optional(),
  METRICS_PORT: z.coerce.number().int().positive().default(8787),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
