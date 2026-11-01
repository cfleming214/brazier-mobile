import type { StockState } from '@drophawk/shared';

export interface JsonLdOffer {
  state: StockState;
  priceCents: number | null;
  sellerName: string | null;
}

const availabilityMap: Record<string, StockState> = {
  instock: 'IN_STOCK',
  limitedavailability: 'IN_STOCK',
  onlineonly: 'IN_STOCK',
  instoreonly: 'OUT_OF_STOCK',
  outofstock: 'OUT_OF_STOCK',
  soldout: 'OUT_OF_STOCK',
  discontinued: 'DELISTED',
  preorder: 'PREORDER',
  presale: 'PREORDER',
  backorder: 'OUT_OF_STOCK',
};

function toCents(v: unknown): number | null {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function flatten(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    return [o, ...flatten(o['@graph'] ?? [])];
  }
  return [];
}

/** Read the schema.org Product offer from a product page's JSON-LD blocks. */
export function parseJsonLdProduct(html: string): JsonLdOffer | null {
  const blocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const [, raw] of blocks) {
    let json: unknown;
    try {
      json = JSON.parse(raw!.trim());
    } catch {
      continue;
    }
    const product = flatten(json).find((n) => {
      const t = n['@type'];
      return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
    });
    if (!product) continue;
    const offersRaw = product.offers;
    const offers = flatten(offersRaw).filter(
      (o) => o['@type'] === 'Offer' || 'availability' in o || 'price' in o,
    );
    const offer = offers[0] ?? (offersRaw as Record<string, unknown> | undefined);
    if (!offer) return { state: 'UNKNOWN', priceCents: null, sellerName: null };
    const avail = String(offer.availability ?? '')
      .split('/')
      .pop()!
      .toLowerCase();
    const seller = offer.seller as { name?: string } | undefined;
    return {
      state: availabilityMap[avail] ?? 'UNKNOWN',
      priceCents: toCents(offer.price ?? offer.lowPrice),
      sellerName: seller?.name ?? null,
    };
  }
  return null;
}
