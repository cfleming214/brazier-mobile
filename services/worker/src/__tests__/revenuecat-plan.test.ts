import { describe, expect, it } from 'vitest';
import { planForEvent } from '../../../../supabase/functions/revenuecat-webhook/plan';

const base = { app_user_id: 'u1', expiration_at_ms: Date.UTC(2027, 0, 1) };

describe('RevenueCat webhook → plan', () => {
  it('grants pro on purchase and renewal with the expiry', () => {
    for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION']) {
      expect(planForEvent({ ...base, type, entitlement_ids: ['pro'] })).toEqual({
        plan: 'pro',
        expiresAt: '2027-01-01T00:00:00.000Z',
      });
    }
  });

  it('prefers pro_squad when both entitlements are present', () => {
    expect(
      planForEvent({ ...base, type: 'PRODUCT_CHANGE', entitlement_ids: ['pro', 'pro_squad'] })
        ?.plan,
    ).toBe('pro_squad');
  });

  it('keeps access on cancellation and revokes on expiration', () => {
    expect(planForEvent({ ...base, type: 'CANCELLATION', entitlement_ids: ['pro'] })).toBeNull();
    expect(planForEvent({ ...base, type: 'EXPIRATION', entitlement_ids: ['pro'] })).toEqual({
      plan: 'free',
      expiresAt: null,
    });
  });

  it('ignores unrelated events and unknown entitlements', () => {
    expect(planForEvent({ ...base, type: 'TEST' })).toBeNull();
    expect(
      planForEvent({ ...base, type: 'INITIAL_PURCHASE', entitlement_ids: ['other'] }),
    ).toBeNull();
  });
});
