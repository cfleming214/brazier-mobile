import type { WatchOverview } from './api';

/** Counts for the Radar KPI tiles. Paused watches only count toward the total. */
export function summarize(watches: WatchOverview[]) {
  const active = watches.filter((w) => !w.paused);
  return {
    live: active.filter((w) => w.status === 'live').length,
    monitoring: active.filter((w) => w.status === 'monitoring').length,
    soldOut: active.filter((w) => w.status === 'sold_out').length,
    total: watches.length,
    lastChecked:
      watches
        .flatMap((w) => w.retailers.map((r) => r.last_checked_at))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  };
}
