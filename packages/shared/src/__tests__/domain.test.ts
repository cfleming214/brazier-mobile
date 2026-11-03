import { describe, expect, it } from 'vitest';
import { CreateWatchInput } from '../domain';

describe('CreateWatchInput', () => {
  const base = {
    productId: '7f9c2f3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f',
    retailerIds: ['target'],
    maxPriceCents: 6500,
    includeMarketplace: false,
    pickupRadiusKm: null,
  };
  it('accepts a valid watch', () => {
    expect(CreateWatchInput.parse(base)).toEqual(base);
  });
  it('requires at least one retailer', () => {
    expect(CreateWatchInput.safeParse({ ...base, retailerIds: [] }).success).toBe(false);
  });
  it('rejects a zero max price', () => {
    expect(CreateWatchInput.safeParse({ ...base, maxPriceCents: 0 }).success).toBe(false);
  });
});
