// Pure mapping from a RevenueCat webhook event to a Brazier plan. Unit-tested from the worker suite.
export interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
}

export type PlanChange = { plan: 'free' | 'pro' | 'pro_squad'; expiresAt: string | null };

const GRANTING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
]);
// CANCELLATION only turns off auto-renew; access continues until EXPIRATION.
const REVOKING = new Set(['EXPIRATION']);

export function planForEvent(e: RevenueCatEvent): PlanChange | null {
  const expiresAt = e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null;
  if (REVOKING.has(e.type)) return { plan: 'free', expiresAt: null };
  if (!GRANTING.has(e.type)) return null;
  const ents = e.entitlement_ids ?? [];
  if (ents.includes('pro_squad')) return { plan: 'pro_squad', expiresAt };
  if (ents.includes('pro')) return { plan: 'pro', expiresAt };
  return null;
}
