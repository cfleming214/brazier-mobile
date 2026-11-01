import { createSign } from 'node:crypto';
import type {
  AvailabilityResult,
  RetailerAdapter,
  RetailerPolicy,
  RetailerSkuRef,
} from '@drophawk/shared';
import { parseRetailerUrl } from '@drophawk/shared';
import { getText, result, type AdapterContext } from './base';

export interface WalmartItem {
  itemId: number;
  name: string;
  salePrice?: number;
  stock?: 'Available' | 'Limited Supply' | 'Not available' | 'Not Available' | string;
  sellerInfo?: string;
  marketplace?: boolean;
  upc?: string;
  productUrl?: string;
  availableOnline?: boolean;
  preOrder?: boolean;
}

const FIRST_PARTY = /^walmart(\.com)?$/i;

export function mapWalmart(
  ref: RetailerSkuRef,
  it: WalmartItem | undefined,
  now?: () => Date,
): AvailabilityResult {
  if (!it) return result(ref, { state: 'DELISTED' }, now);
  const inStock =
    /available|limited/i.test(it.stock ?? '') && !/not available/i.test(it.stock ?? '');
  const marketplaceOnly =
    it.marketplace === true || (!!it.sellerInfo && !FIRST_PARTY.test(it.sellerInfo));
  return result(
    ref,
    {
      state: it.preOrder ? 'PREORDER' : inStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
      priceCents: it.salePrice != null ? Math.round(it.salePrice * 100) : null,
      marketplaceOnly,
      shipAvailable: inStock,
    },
    now,
  );
}

/** Walmart affiliate API request signature: RSA-SHA256 over consumerId, timestamp and key version. */
export function walmartHeaders(
  consumerId: string,
  privateKeyPem: string,
  keyVersion: string,
  timestamp = Date.now(),
) {
  const ts = String(timestamp);
  const payload = `${consumerId}\n${ts}\n${keyVersion}\n`;
  const signature = createSign('RSA-SHA256').update(payload).sign(privateKeyPem, 'base64');
  return {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.INTIMESTAMP': ts,
    'WM_SEC.KEY_VERSION': keyVersion,
    'WM_SEC.AUTH_SIGNATURE': signature,
  };
}

export function walmartAdapter(
  policy: RetailerPolicy,
  ctx: AdapterContext,
  creds: { consumerId?: string; privateKey?: string; keyVersion: string },
): RetailerAdapter {
  const ready = () => {
    if (!creds.consumerId || !creds.privateKey)
      throw new Error('Walmart API credentials are not set');
    return walmartHeaders(creds.consumerId, creds.privateKey, creds.keyVersion);
  };
  return {
    slug: 'walmart',
    policy,
    parseUrl: (url) => {
      const r = parseRetailerUrl(url);
      return r.ok && r.ref.retailer === 'walmart' ? r.ref : null;
    },
    async fetchAvailability(refs) {
      if (refs.length === 0) return [];
      const ids = refs
        .map((r) => r.sku)
        .filter((s) => /^\d+$/.test(s))
        .slice(0, 20);
      const { body } = await getText(
        ctx,
        `https://developer.api.walmart.com/api-proxy/service/affil/product/v2/items?ids=${ids.join(',')}`,
        { headers: { ...ready(), accept: 'application/json' } },
      );
      const json = JSON.parse(body) as { items?: WalmartItem[] };
      const byId = new Map((json.items ?? []).map((i) => [String(i.itemId), i]));
      return refs.map((r) => mapWalmart(r, byId.get(r.sku), ctx.now));
    },
    async searchCatalog(query) {
      if (!creds.consumerId || !creds.privateKey) return [];
      const { body } = await getText(
        ctx,
        `https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search?query=${encodeURIComponent(query)}&numItems=25`,
        { headers: { ...ready(), accept: 'application/json' } },
      );
      const json = JSON.parse(body) as { items?: (WalmartItem & { thumbnailImage?: string })[] };
      return (json.items ?? []).map((i) => ({
        ref: { retailer: 'walmart' as const, sku: String(i.itemId), url: i.productUrl },
        title: i.name,
        upc: i.upc ?? null,
        priceCents: i.salePrice != null ? Math.round(i.salePrice * 100) : null,
        imageUrl: i.thumbnailImage ?? null,
      }));
    },
  };
}
