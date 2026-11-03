/**
 * Adapter contract tests (DROP-57). Every polled retailer adapter is built through the real
 * registry and must satisfy the same contract, whatever API or page it reads:
 *  - one result per requested ref, in order, with the ref echoed back
 *  - a valid StockState, integer-or-null price, ISO timestamp, boolean flags
 *  - unknown products come back as DELISTED (never a crash, never IN_STOCK)
 *  - 429/403 surface as BlockedError so the governor backs off (never retried in-adapter)
 *  - only the retailer's own host is contacted, with the identifying Brazier user agent
 *  - parseUrl only accepts the adapter's own retailer
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StockState,
  type AvailabilityResult,
  type RetailerPolicy,
  type RetailerSkuRef,
  type RetailerSlug,
} from '@brazier/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { BlockedError } from '../adapters/protections';
import { buildAdapters, POLLED_RETAILERS } from '../adapters/registry';
import type { Config } from '../config';

const UA = 'Brazier/0.1 (+https://brazier.app/bot)';
const page = (name: string) => readFileSync(join(__dirname, 'fixtures/pages', name), 'utf8');
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const policy: RetailerPolicy = {
  enabled: true,
  maxRequestsPerMinute: 30,
  allowedEndpoints: [],
  automationAllowed: false,
  backoffSeconds: 300,
};

const config = {
  USER_AGENT: UA,
  BESTBUY_API_KEY: 'bb-key',
  WALMART_CONSUMER_ID: 'wm-consumer',
  WALMART_PRIVATE_KEY: pem,
  WALMART_KEY_VERSION: '1',
  AMAZON_ACCESS_KEY: 'AKIA_TEST',
  AMAZON_SECRET_KEY: 'secret',
  AMAZON_PARTNER_TAG: 'brazier-20',
} as Config;

const HOSTS: Record<RetailerSlug, RegExp> = {
  bestbuy: /^api\.bestbuy\.com$/,
  walmart: /^developer\.api\.walmart\.com$/,
  amazon: /^webservices\.amazon\.com$/,
  target: /(^|\.)target\.com$/,
  gamestop: /(^|\.)gamestop\.com$/,
  pokemoncenter: /(^|\.)pokemoncenter\.com$/,
} as Record<RetailerSlug, RegExp>;

/** A known in-stock SKU and an unknown SKU per retailer. */
const REFS: Record<string, { known: RetailerSkuRef; unknown: RetailerSkuRef; foreignUrl: string }> =
  {
    bestbuy: {
      known: { retailer: 'bestbuy', sku: '6624827' },
      unknown: { retailer: 'bestbuy', sku: '1111111' },
      foreignUrl: 'https://www.target.com/p/-/A-12345678',
    },
    walmart: {
      known: { retailer: 'walmart', sku: '5236617690' },
      unknown: { retailer: 'walmart', sku: '1' },
      foreignUrl: 'https://www.bestbuy.com/site/x/6624827.p',
    },
    amazon: {
      known: { retailer: 'amazon', sku: 'B0DLPL7LC5' },
      unknown: { retailer: 'amazon', sku: 'B000000000' },
      foreignUrl: 'https://www.walmart.com/ip/x/5236617690',
    },
    target: {
      known: { retailer: 'target', sku: '93954435' },
      unknown: { retailer: 'target', sku: '00000000' },
      foreignUrl: 'https://www.amazon.com/dp/B0DLPL7LC5',
    },
    gamestop: {
      known: {
        retailer: 'gamestop',
        sku: '424242',
        url: 'https://www.gamestop.com/toys/424242.html',
      },
      unknown: { retailer: 'gamestop', sku: '0', url: 'https://www.gamestop.com/toys/0.html' },
      foreignUrl: 'https://www.target.com/p/-/A-12345678',
    },
    pokemoncenter: {
      known: { retailer: 'pokemoncenter', sku: '100-10019' },
      unknown: { retailer: 'pokemoncenter', sku: '000-00000' },
      foreignUrl: 'https://www.target.com/p/-/A-12345678',
    },
  };

type Mode = 'ok' | 'blocked';
interface Call {
  url: URL;
  headers: Headers;
}

function stubFetch(mode: { value: Mode }, calls: Call[]): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (mode.value === 'blocked') return new Response('Too Many Requests', { status: 429 });
    const json = (o: unknown) =>
      new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    switch (url.hostname) {
      case 'api.bestbuy.com': {
        const skus =
          /sku in\(([^)]*)\)/.exec(decodeURIComponent(url.pathname))?.[1]?.split(',') ?? [];
        return json({
          products: skus
            .filter((s) => s === REFS.bestbuy!.known.sku)
            .map((s) => ({
              sku: Number(s),
              name: 'ETB',
              onlineAvailability: true,
              salePrice: 49.99,
            })),
        });
      }
      case 'developer.api.walmart.com': {
        const ids = url.searchParams.get('ids')?.split(',') ?? [];
        return json({
          items: ids
            .filter((i) => i === REFS.walmart!.known.sku)
            .map((i) => ({
              itemId: Number(i),
              name: 'ETB',
              salePrice: 49.97,
              stock: 'Available',
              sellerInfo: 'Walmart.com',
            })),
        });
      }
      case 'webservices.amazon.com': {
        const body = JSON.parse(String(init?.body)) as { ItemIds: string[] };
        return json({
          ItemsResult: {
            Items: body.ItemIds.filter((a) => a === REFS.amazon!.known.sku).map((ASIN) => ({
              ASIN,
              Offers: {
                Listings: [
                  {
                    Availability: { Type: 'Now' },
                    Price: { Amount: 49.99 },
                    MerchantInfo: { Name: 'Amazon.com' },
                  },
                ],
              },
            })),
          },
        });
      }
      default: {
        const known = Object.values(REFS).some(
          (r) => url.href.includes(r.known.sku) && HOSTS[r.known.retailer].test(url.hostname),
        );
        if (!known) return new Response('not found', { status: 404 });
        const fixture = url.hostname.includes('pokemoncenter')
          ? 'pkc-preorder.html'
          : url.hostname.includes('gamestop')
            ? 'gamestop-marketplace.html'
            : 'target-in-stock.html';
        return new Response(page(fixture), { headers: { 'content-type': 'text/html' } });
      }
    }
  }) as typeof fetch;
}

function assertWellFormed(r: AvailabilityResult, ref: RetailerSkuRef) {
  expect(r.ref.retailer).toBe(ref.retailer);
  expect(r.ref.sku).toBe(ref.sku);
  expect(StockState.safeParse(r.state).success).toBe(true);
  expect(r.priceCents === null || Number.isInteger(r.priceCents)).toBe(true);
  if (r.priceCents !== null) expect(r.priceCents).toBeGreaterThan(0);
  expect(typeof r.marketplaceOnly).toBe('boolean');
  expect(typeof r.shipAvailable).toBe('boolean');
  expect(typeof r.pickupAvailable).toBe('boolean');
  expect(new Date(r.observedAt).toISOString()).toBe(r.observedAt);
  expect(Array.isArray(r.protections ?? [])).toBe(true);
}

const policies = new Map(POLLED_RETAILERS.map((s) => [s, policy]));

describe.each(POLLED_RETAILERS)('%s adapter contract', (slug) => {
  const mode = { value: 'ok' as Mode };
  const calls: Call[] = [];
  const adapter = buildAdapters(config, policies, {
    userAgent: UA,
    fetch: stubFetch(mode, calls),
    now: () => new Date('2026-11-01T08:00:00Z'),
  }).get(slug)!;
  const { known, unknown, foreignUrl } = REFS[slug]!;

  beforeEach(() => {
    mode.value = 'ok';
    calls.length = 0;
  });

  it('is registered with its slug and policy', () => {
    expect(adapter.slug).toBe(slug);
    expect(adapter.policy).toBe(policy);
  });

  it('returns one well-formed result per ref, in order', async () => {
    const out = await adapter.fetchAvailability([known, unknown]);
    expect(out).toHaveLength(2);
    assertWellFormed(out[0]!, known);
    assertWellFormed(out[1]!, unknown);
    expect(out[0]!.state).not.toBe('DELISTED');
  });

  it('reports unknown products as DELISTED', async () => {
    const [r] = await adapter.fetchAvailability([unknown]);
    expect(r!.state).toBe('DELISTED');
  });

  it('returns nothing (and makes no request) for an empty batch', async () => {
    expect(await adapter.fetchAvailability([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('surfaces rate limiting as BlockedError without retrying', async () => {
    mode.value = 'blocked';
    await expect(adapter.fetchAvailability([known])).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toHaveLength(1);
  });

  it('only contacts its own host, identifying itself', async () => {
    await adapter.fetchAvailability([known, unknown]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url.protocol).toBe('https:');
      expect(c.url.hostname).toMatch(HOSTS[slug]);
      expect(c.headers.get('user-agent')).toBe(UA);
    }
  });

  it("rejects other retailers' URLs", () => {
    expect(adapter.parseUrl(foreignUrl)).toBeNull();
  });
});
