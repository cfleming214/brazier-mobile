import type { AvailabilityResult } from '@brazier/shared';
import { describe, expect, it } from 'vitest';
import { decideDelivery, DEFAULT_PREFS, inQuietHours, matchWatch, type WatchRule } from '../rules';
import { budgetAllows, computeTier } from '../tiers';

const watch: WatchRule = {
  watch_id: 'w',
  user_id: 'u',
  paused: false,
  alerts_enabled: true,
  retailer_ids: ['target'],
  max_price_cents: 6500,
  include_marketplace: false,
  pickup_radius_km: null,
};
const r = (extra: Partial<AvailabilityResult> = {}): AvailabilityResult => ({
  ref: { retailer: 'target', sku: '1' },
  state: 'IN_STOCK',
  priceCents: 5999,
  marketplaceOnly: false,
  shipAvailable: true,
  pickupAvailable: false,
  observedAt: '2026-11-01T08:00:00Z',
  ...extra,
});

describe('matchWatch', () => {
  it('notifies on a matching in-stock reading', () =>
    expect(matchWatch(watch, r())).toEqual({ notify: true }));
  it.each([
    [{ ...watch, paused: true }, r(), 'paused'],
    [{ ...watch, alerts_enabled: false }, r(), 'alerts_off'],
    [{ ...watch, retailer_ids: ['bestbuy'] }, r(), 'retailer'],
    [watch, r({ priceCents: 8999 }), 'over_max_price'],
    [watch, r({ marketplaceOnly: true }), 'marketplace'],
    [watch, r({ shipAvailable: false, pickupAvailable: true }), 'pickup_only'],
    [
      { ...watch, pickup_radius_km: 25 },
      r({ shipAvailable: false, pickupAvailable: true, nearestStoreKm: 61 }),
      'pickup_out_of_radius',
    ],
  ])('suppresses (%#)', (w, reading, reason) => {
    expect(matchWatch(w, reading)).toEqual({ notify: false, reason });
  });
  it('allows marketplace and in-radius pickup when the user opted in', () => {
    expect(
      matchWatch({ ...watch, include_marketplace: true }, r({ marketplaceOnly: true })),
    ).toEqual({ notify: true });
    expect(
      matchWatch(
        { ...watch, pickup_radius_km: 25 },
        r({ shipAvailable: false, pickupAvailable: true, nearestStoreKm: 8 }),
      ),
    ).toEqual({ notify: true });
  });
});

describe('notification settings', () => {
  const quiet = {
    ...DEFAULT_PREFS,
    quiet_hours_enabled: true,
    quiet_start: '23:00',
    quiet_end: '07:00',
    timezone: 'America/New_York',
  };
  const threeAmEt = new Date('2026-11-01T08:00:00Z'); // 03:00 EST
  const noonEt = new Date('2026-11-01T17:00:00Z');

  it('detects quiet hours across midnight in the user timezone', () => {
    expect(inQuietHours(quiet, threeAmEt)).toBe(true);
    expect(inQuietHours(quiet, noonEt)).toBe(false);
  });
  it('lets urgent alerts through quiet hours by default', () => {
    expect(decideDelivery(quiet, 'restock', true, threeAmEt)).toBe('send');
    expect(decideDelivery(quiet, 'drop_updates', false, threeAmEt)).toBe('suppressed_quiet');
    expect(
      decideDelivery({ ...quiet, quiet_allows_urgent: false }, 'restock', true, threeAmEt),
    ).toBe('suppressed_quiet');
  });
  it('respects category switches and the digest option', () => {
    expect(decideDelivery({ ...DEFAULT_PREFS, restock: false }, 'restock', true, noonEt)).toBe(
      'suppressed_pref',
    );
    expect(
      decideDelivery(
        { ...DEFAULT_PREFS, drop_updates_digest: true },
        'drop_updates',
        false,
        noonEt,
      ),
    ).toBe('held_digest');
    expect(
      decideDelivery({ ...DEFAULT_PREFS, drop_updates_digest: true }, 'drop_updates', true, noonEt),
    ).toBe('send');
  });
});

describe('poll tiers', () => {
  const policy = {
    enabled: true,
    maxRequestsPerMinute: 120,
    allowedEndpoints: [],
    automationAllowed: true,
    backoffSeconds: 60,
  };
  it('free users get the 5 minute tier, Pro gets 15 seconds, drop windows burst', () => {
    expect(
      computeTier({
        watchers: 3,
        proWatchers: 0,
        secondsToWindow: null,
        policy,
        skusAtRetailer: 10,
      }),
    ).toBe('cold');
    expect(
      computeTier({
        watchers: 3,
        proWatchers: 1,
        secondsToWindow: null,
        policy,
        skusAtRetailer: 10,
      }),
    ).toBe('hot');
    expect(
      computeTier({
        watchers: 3,
        proWatchers: 0,
        secondsToWindow: 300,
        policy,
        skusAtRetailer: 10,
      }),
    ).toBe('burst');
    expect(
      computeTier({
        watchers: 3,
        proWatchers: 0,
        secondsToWindow: 3600,
        policy,
        skusAtRetailer: 10,
      }),
    ).toBe('cold');
  });
  it('steps down when the retailer budget cannot sustain the tier', () => {
    const slow = { ...policy, maxRequestsPerMinute: 6 };
    expect(budgetAllows(slow, 15, 1)).toBe(true);
    // Pro wants 15s, but 5 SKUs at 4/min each exceeds 6/min: step down to 60s.
    expect(
      computeTier({
        watchers: 1,
        proWatchers: 1,
        secondsToWindow: null,
        policy: slow,
        skusAtRetailer: 5,
      }),
    ).toBe('normal');
    // Burst (12/min) exceeds 6/min; 15s for all 5 SKUs (20/min) does too: step down to 60s.
    expect(
      computeTier({
        watchers: 1,
        proWatchers: 0,
        secondsToWindow: 0,
        policy: slow,
        skusAtRetailer: 5,
      }),
    ).toBe('normal');
  });
  it('does not poll SKUs nobody watches', () => {
    expect(
      computeTier({ watchers: 0, proWatchers: 0, secondsToWindow: 0, policy, skusAtRetailer: 1 }),
    ).toBeNull();
  });
});
