import type { AvailabilityResult, StockState } from '@brazier/shared';
import { describe, expect, it } from 'vitest';
import { decide, type SkuSnapshot } from '../detector';

const reading = (
  state: StockState,
  at = '2026-11-01T03:04:12.000Z',
  extra: Partial<AvailabilityResult> = {},
): AvailabilityResult => ({
  ref: { retailer: 'target', sku: '1' },
  state,
  priceCents: 5999,
  marketplaceOnly: false,
  shipAvailable: state === 'IN_STOCK',
  pickupAvailable: false,
  observedAt: at,
  ...extra,
});
const oos: SkuSnapshot = {
  last_state: 'OUT_OF_STOCK',
  last_price_cents: 5999,
  confirmations: 0,
  last_in_stock_at: null,
  last_out_of_stock_at: '2026-10-30T00:00:00Z',
};

describe('detector', () => {
  it('asks for a confirming read on an in-stock flip and does not alert yet', () => {
    const d = decide(oos, reading('IN_STOCK'));
    expect(d).toMatchObject({
      needsConfirmation: true,
      event: null,
      alert: false,
      update: { confirmations: 1 },
    });
    expect(d.update.last_state).toBeUndefined();
  });

  it('alerts when the confirming read agrees', () => {
    const d = decide({ ...oos, confirmations: 1 }, reading('IN_STOCK', '2026-11-01T03:04:13.000Z'));
    expect(d.alert).toBe(true);
    expect(d.event).toEqual({
      prev_state: 'OUT_OF_STOCK',
      new_state: 'IN_STOCK',
      price_cents: 5999,
      suppressed_reason: null,
    });
    expect(d.update).toMatchObject({
      last_state: 'IN_STOCK',
      confirmations: 0,
      last_in_stock_at: '2026-11-01T03:04:13.000Z',
    });
  });

  it('records an unconfirmed ghost restock without alerting', () => {
    const d = decide({ ...oos, confirmations: 1 }, reading('OUT_OF_STOCK'));
    expect(d.alert).toBe(false);
    expect(d.event?.suppressed_reason).toBe('unconfirmed');
    expect(d.update.confirmations).toBe(0);
  });

  it('suppresses flapping when it was out of stock only briefly', () => {
    const flappy = {
      ...oos,
      confirmations: 1,
      last_in_stock_at: '2026-11-01T03:00:00Z',
      last_out_of_stock_at: '2026-11-01T03:02:00Z',
    };
    const d = decide(flappy, reading('IN_STOCK', '2026-11-01T03:04:13.000Z'));
    expect(d.alert).toBe(false);
    expect(d.event?.suppressed_reason).toBe('flapping');
  });

  it('records going out of stock', () => {
    const live: SkuSnapshot = {
      ...oos,
      last_state: 'IN_STOCK',
      last_in_stock_at: '2026-11-01T03:00:00Z',
    };
    const d = decide(live, reading('OUT_OF_STOCK'));
    expect(d.event).toMatchObject({ prev_state: 'IN_STOCK', new_state: 'OUT_OF_STOCK' });
    expect(d.update.last_out_of_stock_at).toBe('2026-11-01T03:04:12.000Z');
    expect(d.alert).toBe(false);
  });

  it('treats price-only changes as no event', () => {
    const d = decide(oos, reading('OUT_OF_STOCK', undefined, { priceCents: 4999 }));
    expect(d.event).toBeNull();
    expect(d.update.last_price_cents).toBe(4999);
  });

  it('ignores unparseable readings', () => {
    const d = decide(oos, reading('UNKNOWN'));
    expect(d.event).toBeNull();
    expect(d.update).toEqual({
      last_checked_at: '2026-11-01T03:04:12.000Z',
      marketplace_only: false,
      pickup_only: false,
    });
  });

  it('alerts on preorder opening after confirmation', () => {
    const first = decide(oos, reading('PREORDER'));
    expect(first.needsConfirmation).toBe(true);
    const second = decide({ ...oos, confirmations: 1 }, reading('PREORDER'));
    expect(second.alert).toBe(true);
  });

  it('flags pickup-only and marketplace-only readings', () => {
    const d = decide(
      oos,
      reading('IN_STOCK', undefined, {
        shipAvailable: false,
        pickupAvailable: true,
        marketplaceOnly: true,
      }),
    );
    expect(d.update).toMatchObject({ pickup_only: true, marketplace_only: true });
  });
});
