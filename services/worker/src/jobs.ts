import type { RetailerAdapter } from '@brazier/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importSets } from './catalog/pokemontcg';
import { notifyChanges, runCalendarClock, sendDigests } from './calendar/notify';
import { ingest } from './calendar/pipeline';
import {
  discoverListings,
  feedItems,
  preorderItems,
  setReleaseItems,
  submissionItems,
  type FeedConfig,
} from './calendar/sources';
import { runRestockStats } from './calendar/stats';
import type { Config } from './config';
import { createFetchJson } from './http';
import type { Notifier } from './notifier';

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  last?: number;
}

/** Periodic calendar and intelligence jobs, run alongside the poller. */
export function createJobs(opts: {
  config: Config;
  db: SupabaseClient;
  notifier: Notifier;
  adapters: RetailerAdapter[];
  now?: () => Date;
}): { tick: () => Promise<void>; jobs: Job[] } {
  const { config, db, notifier } = opts;
  const now = opts.now ?? (() => new Date());
  const fetchJson = createFetchJson(config.USER_AGENT);
  const fetchText = async (url: string) => {
    const res = await fetch(url, {
      headers: { 'user-agent': config.USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  };

  const ingestAndNotify = async (items: Parameters<typeof ingest>[1]) =>
    notifyChanges(db, notifier, await ingest(db, items, now()), now());

  const jobs: Job[] = [
    { name: 'calendar-clock', everyMs: 60_000, run: () => runCalendarClock(db, notifier, now()) },
    {
      name: 'calendar-sources',
      everyMs: 15 * 60_000,
      run: async () =>
        ingestAndNotify([
          ...(await preorderItems(db, now())),
          ...(await submissionItems(db)),
          ...(await feedItems(fetchText, config.CALENDAR_FEEDS as FeedConfig[])),
        ]),
    },
    {
      name: 'daily-catalog',
      everyMs: 24 * 3600_000,
      run: async () => {
        await importSets({
          fetchJson,
          db,
          baseUrl: config.POKEMONTCG_BASE_URL,
          apiKey: config.POKEMONTCG_API_KEY,
        }).catch((e) => console.error('sets import failed', e.message));
        await ingestAndNotify(await setReleaseItems(db, now()));
        await discoverListings(db, opts.adapters, now());
      },
    },
    {
      name: 'nightly-stats',
      everyMs: 24 * 3600_000,
      run: async () => {
        const { estimates } = await runRestockStats(db, now());
        await ingestAndNotify(estimates);
      },
    },
    { name: 'daily-digest', everyMs: 24 * 3600_000, run: () => sendDigests(db, notifier, now()) },
  ];

  return {
    jobs,
    async tick() {
      const t = now().getTime();
      for (const j of jobs) {
        if (j.last && t - j.last < j.everyMs) continue;
        j.last = t;
        try {
          await j.run();
        } catch (e) {
          console.error(`job ${j.name} failed`, e);
        }
      }
    },
  };
}
