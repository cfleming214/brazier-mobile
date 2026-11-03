import type { RetailerAdapter, RetailerPolicy, RetailerSlug } from '@brazier/shared';
import type { Config } from '../config';
import { amazonAdapter } from './amazon';
import type { AdapterContext } from './base';
import { bestBuyAdapter } from './bestbuy';
import { fakeAdapter } from './fake';
import { pageAdapter } from './pages';
import { walmartAdapter } from './walmart';

export const POLLED_RETAILERS: RetailerSlug[] = [
  'bestbuy',
  'walmart',
  'target',
  'gamestop',
  'pokemoncenter',
  'amazon',
];

/** Build one adapter per retailer from the policies stored in the retailers table. */
export function buildAdapters(
  config: Config,
  policies: Map<RetailerSlug, RetailerPolicy>,
  ctx: AdapterContext,
): Map<RetailerSlug, RetailerAdapter> {
  const out = new Map<RetailerSlug, RetailerAdapter>();
  for (const slug of POLLED_RETAILERS) {
    const policy = policies.get(slug);
    if (!policy) continue;
    if (config.FAKE_RETAILER_URL) {
      out.set(slug, fakeAdapter(slug, policy, ctx, config.FAKE_RETAILER_URL));
      continue;
    }
    switch (slug) {
      case 'bestbuy':
        out.set(slug, bestBuyAdapter(policy, ctx, config.BESTBUY_API_KEY));
        break;
      case 'walmart':
        out.set(
          slug,
          walmartAdapter(policy, ctx, {
            consumerId: config.WALMART_CONSUMER_ID,
            privateKey: config.WALMART_PRIVATE_KEY,
            keyVersion: config.WALMART_KEY_VERSION,
          }),
        );
        break;
      case 'amazon':
        out.set(
          slug,
          amazonAdapter(policy, ctx, {
            accessKey: config.AMAZON_ACCESS_KEY,
            secretKey: config.AMAZON_SECRET_KEY,
            partnerTag: config.AMAZON_PARTNER_TAG,
          }),
        );
        break;
      default:
        out.set(slug, pageAdapter(slug as 'target' | 'gamestop' | 'pokemoncenter', policy, ctx));
    }
  }
  return out;
}
