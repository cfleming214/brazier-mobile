import type {
  AvailabilityResult,
  RetailerAdapter,
  RetailerPolicy,
  RetailerSkuRef,
} from '@drophawk/shared';
import { parseRetailerUrl } from '@drophawk/shared';
import { getText, result, type AdapterContext } from './base';

/** Best Buy Products API product (fields requested via `show=`). */
export interface BestBuyProduct {
  sku: number;
  name: string;
  onlineAvailability: boolean;
  inStoreAvailability: boolean;
  orderable?: 'Available' | 'SoldOut' | 'PreOrder' | 'ComingSoon' | 'NotOrderable' | string;
  salePrice?: number;
  regularPrice?: number;
  upc?: string;
  url?: string;
  marketplace?: boolean;
}

export function mapBestBuy(
  ref: RetailerSkuRef,
  p: BestBuyProduct | undefined,
  now?: () => Date,
): AvailabilityResult {
  if (!p) return result(ref, { state: 'DELISTED' }, now);
  const state =
    p.orderable === 'PreOrder'
      ? 'PREORDER'
      : p.onlineAvailability || p.orderable === 'Available'
        ? 'IN_STOCK'
        : 'OUT_OF_STOCK';
  return result(
    ref,
    {
      state,
      priceCents: p.salePrice != null ? Math.round(p.salePrice * 100) : null,
      marketplaceOnly: p.marketplace === true,
      shipAvailable: p.onlineAvailability === true,
      pickupAvailable: p.inStoreAvailability === true,
    },
    now,
  );
}

export function bestBuyAdapter(
  policy: RetailerPolicy,
  ctx: AdapterContext,
  apiKey?: string,
): RetailerAdapter {
  return {
    slug: 'bestbuy',
    policy,
    parseUrl: (url) => {
      const r = parseRetailerUrl(url);
      return r.ok && r.ref.retailer === 'bestbuy' ? r.ref : null;
    },
    async fetchAvailability(refs) {
      if (!apiKey) throw new Error('BESTBUY_API_KEY is not set');
      if (refs.length === 0) return [];
      const skus = refs.map((r) => r.sku).filter((s) => /^\d+$/.test(s));
      const url =
        `https://api.bestbuy.com/v1/products(sku in(${skus.join(',')}))` +
        `?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=100` +
        `&show=sku,name,onlineAvailability,inStoreAvailability,orderable,salePrice,regularPrice,upc,url,marketplace`;
      const { body } = await getText(ctx, url, { headers: { accept: 'application/json' } });
      const json = JSON.parse(body) as { products: BestBuyProduct[] };
      const bySku = new Map(json.products.map((p) => [String(p.sku), p]));
      return refs.map((r) => mapBestBuy(r, bySku.get(r.sku), ctx.now));
    },
    async searchCatalog(query) {
      if (!apiKey) return [];
      const words = query
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `search=${encodeURIComponent(w)}`)
        .join('&');
      const url = `https://api.bestbuy.com/v1/products(${words})?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=50&show=sku,name,upc,salePrice,url,image`;
      const { body } = await getText(ctx, url);
      const json = JSON.parse(body) as { products: (BestBuyProduct & { image?: string })[] };
      return json.products.map((p) => ({
        ref: { retailer: 'bestbuy' as const, sku: String(p.sku), url: p.url },
        title: p.name,
        upc: p.upc ?? null,
        priceCents: p.salePrice != null ? Math.round(p.salePrice * 100) : null,
        imageUrl: p.image ?? null,
      }));
    },
  };
}
