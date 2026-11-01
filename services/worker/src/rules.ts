import type { AvailabilityResult } from '@drophawk/shared';

export interface WatchRule {
  watch_id: string;
  user_id: string;
  paused: boolean;
  alerts_enabled: boolean;
  retailer_ids: string[];
  max_price_cents: number | null;
  include_marketplace: boolean;
  pickup_radius_km: number | null;
}

export type MatchResult = { notify: true } | { notify: false; reason: string };

/** Does this in-stock reading match the user's watch filters? */
export function matchWatch(w: WatchRule, r: AvailabilityResult): MatchResult {
  if (w.paused) return { notify: false, reason: 'paused' };
  if (!w.alerts_enabled) return { notify: false, reason: 'alerts_off' };
  if (!w.retailer_ids.includes(r.ref.retailer)) return { notify: false, reason: 'retailer' };
  if (w.max_price_cents != null && r.priceCents != null && r.priceCents > w.max_price_cents) {
    return { notify: false, reason: 'over_max_price' };
  }
  if (r.marketplaceOnly && !w.include_marketplace) return { notify: false, reason: 'marketplace' };
  if (!r.shipAvailable && r.pickupAvailable) {
    if (w.pickup_radius_km == null) return { notify: false, reason: 'pickup_only' };
    if (r.nearestStoreKm == null || r.nearestStoreKm > w.pickup_radius_km)
      return { notify: false, reason: 'pickup_out_of_radius' };
  }
  return { notify: true };
}

export interface Prefs {
  restock: boolean;
  bot_status: boolean;
  drop_updates: boolean;
  reminders: boolean;
  community: boolean;
  drop_updates_digest: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string; // "23:00" or "23:00:00"
  quiet_end: string;
  quiet_allows_urgent: boolean;
  timezone: string;
}

export const DEFAULT_PREFS: Prefs = {
  restock: true,
  bot_status: true,
  drop_updates: true,
  reminders: true,
  community: true,
  drop_updates_digest: false,
  quiet_hours_enabled: false,
  quiet_start: '23:00',
  quiet_end: '07:00',
  quiet_allows_urgent: true,
  timezone: 'America/New_York',
};

export type Category = 'restock' | 'bot_status' | 'drop_updates' | 'reminders' | 'community';
export type Delivery = 'send' | 'suppressed_pref' | 'suppressed_quiet' | 'held_digest';

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes since local midnight in the user's timezone. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function inQuietHours(p: Prefs, now: Date): boolean {
  if (!p.quiet_hours_enabled) return false;
  const t = localMinutes(now, p.timezone);
  const s = minutes(p.quiet_start);
  const e = minutes(p.quiet_end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

/**
 * Decide whether to push. The inbox row is always written; this only controls the push.
 * Time-sensitive alerts (restock, Your turn, Ready to buy) ignore quiet hours unless the user turned that off.
 */
export function decideDelivery(
  p: Prefs,
  category: Category,
  timeSensitive: boolean,
  now: Date,
): Delivery {
  if (!p[category]) return 'suppressed_pref';
  if (category === 'drop_updates' && p.drop_updates_digest && !timeSensitive) return 'held_digest';
  if (inQuietHours(p, now) && !(timeSensitive && p.quiet_allows_urgent)) return 'suppressed_quiet';
  return 'send';
}
