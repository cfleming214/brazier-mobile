import type {
  RetailerAdapter,
  RetailerPolicy,
  RetailerSkuRef,
  RetailerSlug,
} from '@drophawk/shared';
import { parseRetailerUrl } from '@drophawk/shared';
import { getText, result, type AdapterContext } from './base';
import { parseJsonLdProduct } from './jsonld';
import { detectProtections } from './protections';

/**
 * Adapters for retailers without a public API (Target, GameStop, Pokémon Center): read the product
 * page's structured data at the low rates set by each retailer's policy. They never try to get past
 * queues or challenges; those raise BlockedError and the governor backs off.
 */
export function pageAdapter(
  slug: Extract<RetailerSlug, 'target' | 'gamestop' | 'pokemoncenter'>,
  policy: RetailerPolicy,
  ctx: AdapterContext,
): RetailerAdapter {
  const pageUrl = (ref: RetailerSkuRef) => {
    if (ref.url) return ref.url;
    if (slug === 'target') return `https://www.target.com/p/-/A-${ref.sku}`;
    if (slug === 'pokemoncenter') return `https://www.pokemoncenter.com/product/${ref.sku}`;
    throw new Error(`No product URL stored for ${slug} ${ref.sku}`);
  };
  const firstParty: Record<string, RegExp> = {
    target: /^target/i,
    gamestop: /^gamestop/i,
    pokemoncenter: /^pok[eé]mon center/i,
  };

  return {
    slug,
    policy,
    parseUrl: (url) => {
      const r = parseRetailerUrl(url);
      return r.ok && r.ref.retailer === slug ? r.ref : null;
    },
    async fetchAvailability(refs) {
      const out = [];
      for (const ref of refs) {
        const { status, body } = await getText(ctx, pageUrl(ref));
        if (status === 404) {
          out.push(result(ref, { state: 'DELISTED' }, ctx.now));
          continue;
        }
        const offer = parseJsonLdProduct(body);
        const protections = detectProtections(status, body);
        const marketplaceOnly = !!offer?.sellerName && !firstParty[slug]!.test(offer.sellerName);
        const pickupOnly = protections.includes('in_store_only');
        out.push(
          result(
            ref,
            {
              state:
                pickupOnly && offer?.state !== 'IN_STOCK'
                  ? 'OUT_OF_STOCK'
                  : (offer?.state ?? 'UNKNOWN'),
              priceCents: offer?.priceCents ?? null,
              marketplaceOnly,
              shipAvailable: offer?.state === 'IN_STOCK' && !pickupOnly,
              pickupAvailable: /pick up today|ready within|order pickup/i.test(body),
              protections,
            },
            ctx.now,
          ),
        );
      }
      return out;
    },
  };
}
