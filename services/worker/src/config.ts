import { z } from 'zod';

const Env = z.object({
  SUPABASE_URL: z.string().url().default('http://127.0.0.1:54321'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  POKEMONTCG_API_KEY: z.string().optional(),
  POKEMONTCG_BASE_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  TCGCSV_BASE_URL: z.string().url().default('https://tcgcsv.com/tcgplayer'),
  USER_AGENT: z.string().default('DropHawk/0.1 (+https://drophawk.app/bot)'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
