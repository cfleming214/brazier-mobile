import type { RetailerSkuRef } from './adapter';
import type { RetailerSlug } from './domain';

type Parser = (u: URL) => string | null;

const first = (re: RegExp, s: string) => re.exec(s)?.[1] ?? null;

/** Per-retailer URL parsers. Each returns the retailer's own product id or null. */
const parsers: Record<RetailerSlug, { hosts: RegExp; parse: Parser }> = {
  bestbuy: {
    hosts: /(^|\.)bestbuy\.com$/,
    parse: (u) =>
      u.searchParams.get('skuId') ??
      first(/\/(\d{6,8})\.p\b/, u.pathname) ??
      first(/\/sku\/(\d{6,8})/, u.pathname),
  },
  target: {
    hosts: /(^|\.)target\.com$/,
    parse: (u) =>
      first(/\/A-(\d{6,10})(?:$|[/?#])/, u.pathname + '/') ?? u.searchParams.get('preselect'),
  },
  walmart: {
    hosts: /(^|\.)walmart\.com$/,
    parse: (u) => first(/\/ip\/(?:[^/]+\/)?(\d{5,12})(?:$|[/?#])/, u.pathname + '/'),
  },
  gamestop: {
    hosts: /(^|\.)gamestop\.com$/,
    parse: (u) => first(/\/(\d{5,10})\.html$/, u.pathname),
  },
  pokemoncenter: {
    hosts: /(^|\.)pokemoncenter\.com$/,
    parse: (u) => first(/\/product\/([0-9]{2,3}-[0-9]{5}-[0-9]{3,5})/i, u.pathname),
  },
  amazon: {
    hosts: /(^|\.)amazon\.com$/,
    parse: (u) =>
      first(
        /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:$|[/?#])/i,
        u.pathname + '/',
      )?.toUpperCase() ?? null,
  },
  tcgplayer: {
    hosts: /(^|\.)tcgplayer\.com$/,
    parse: (u) => first(/\/product\/(\d{3,9})(?:$|[/?#])/, u.pathname + '/'),
  },
};

export type ParseUrlResult =
  | { ok: true; ref: RetailerSkuRef }
  | {
      ok: false;
      reason: 'invalid' | 'unsupported_retailer' | 'no_product_id';
      retailer?: RetailerSlug;
    };

/** Parse a pasted product link into a retailer + SKU. Accepts links without a scheme. */
export function parseRetailerUrl(input: string): ParseUrlResult {
  const text = input.trim();
  const match = /https?:\/\/\S+|(?:www\.|m\.)?[a-z0-9-]+\.[a-z]{2,}\/\S*/i.exec(text);
  if (!match) return { ok: false, reason: 'invalid' };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const host = url.hostname.toLowerCase();
  for (const [retailer, p] of Object.entries(parsers) as [
    RetailerSlug,
    (typeof parsers)[RetailerSlug],
  ][]) {
    if (!p.hosts.test(host)) continue;
    const sku = p.parse(url);
    if (!sku) return { ok: false, reason: 'no_product_id', retailer };
    return { ok: true, ref: { retailer, sku, url: url.toString() } };
  }
  return { ok: false, reason: 'unsupported_retailer' };
}

export const SUPPORTED_RETAILER_HOSTS = [
  'bestbuy.com',
  'target.com',
  'walmart.com',
  'gamestop.com',
  'pokemoncenter.com',
  'amazon.com',
  'tcgplayer.com',
];
