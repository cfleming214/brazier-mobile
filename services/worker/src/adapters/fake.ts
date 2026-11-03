import type {
  AvailabilityResult,
  RetailerAdapter,
  RetailerPolicy,
  RetailerSlug,
  StockState,
} from '@brazier/shared';
import { getText, result, type AdapterContext } from './base';

/** Talks to e2e/fake-retailer. Used for every retailer when FAKE_RETAILER_URL is set. */
export function fakeAdapter(
  slug: RetailerSlug,
  policy: RetailerPolicy,
  ctx: AdapterContext,
  baseUrl: string,
): RetailerAdapter {
  return {
    slug,
    policy: { ...policy, allowedEndpoints: [baseUrl.replace(/^https?:\/\//, '')] },
    parseUrl: () => null,
    async fetchAvailability(refs) {
      if (refs.length === 0) return [];
      const { body } = await getText(
        ctx,
        `${baseUrl}/${slug}/availability?skus=${refs.map((r) => encodeURIComponent(r.sku)).join(',')}`,
      );
      const json = JSON.parse(body) as {
        results: {
          sku: string;
          state: StockState;
          priceCents: number | null;
          marketplaceOnly: boolean;
          shipAvailable: boolean;
          pickupAvailable: boolean;
          protections: string[];
          nearestStoreKm?: number | null;
        }[];
      };
      const bySku = new Map(json.results.map((r) => [r.sku, r]));
      return refs.map((ref): AvailabilityResult => {
        const r = bySku.get(ref.sku);
        return r ? result(ref, { ...r }, ctx.now) : result(ref, { state: 'DELISTED' }, ctx.now);
      });
    },
  };
}
