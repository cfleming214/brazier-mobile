import type { RetailerPolicy } from '@drophawk/shared';

export type PollTier = 'cold' | 'normal' | 'hot' | 'burst';

/** Seconds between checks for each tier. Free = cold (5 min), Pro = hot (15 s), drop windows = burst (5 s). */
export const TIER_INTERVAL_S: Record<PollTier, number> = {
  cold: 300,
  normal: 60,
  hot: 15,
  burst: 5,
};

export interface TierInput {
  watchers: number;
  proWatchers: number;
  /** Seconds until the nearest confirmed calendar window for this product/retailer (negative = started). */
  secondsToWindow: number | null;
  policy: RetailerPolicy;
  skusAtRetailer: number;
}

/** Can this retailer's rate budget sustain checking every SKU at the given interval? */
export function budgetAllows(policy: RetailerPolicy, intervalS: number, skus: number): boolean {
  return (60 / intervalS) * Math.max(1, skus) <= policy.maxRequestsPerMinute;
}

export function computeTier(t: TierInput): PollTier | null {
  if (t.watchers === 0) return null;
  const inWindow =
    t.secondsToWindow != null && t.secondsToWindow <= 600 && t.secondsToWindow >= -1800;
  const want: PollTier = inWindow ? 'burst' : t.proWatchers > 0 ? 'hot' : 'cold';
  // Step down until the retailer's budget can sustain it.
  const order: PollTier[] = ['burst', 'hot', 'normal', 'cold'];
  for (const tier of order.slice(order.indexOf(want))) {
    if (
      tier === 'cold' ||
      budgetAllows(t.policy, TIER_INTERVAL_S[tier], tier === 'burst' ? 1 : t.skusAtRetailer)
    )
      return tier;
  }
  return 'cold';
}
