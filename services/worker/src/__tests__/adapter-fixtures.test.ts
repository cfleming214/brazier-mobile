/**
 * Fixture matrix (DROP-57): each adapter maps its fixture responses (in stock, out of stock,
 * preorder, marketplace-only, delisted) to the expected result in fixtures/manifest.json.
 * The fake retailer serves the same files at /fixtures/* for E2E.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RetailerSkuRef, RetailerSlug } from '@brazier/shared';
import { describe, expect, it } from 'vitest';
import { mapAmazon, type PaapiItem } from '../adapters/amazon';
import { mapBestBuy } from '../adapters/bestbuy';
import { pageAdapter } from '../adapters/pages';
import { mapWalmart, type WalmartItem } from '../adapters/walmart';

const dir = join(__dirname, 'fixtures');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
type Expect = Partial<{ state: string; marketplaceOnly: boolean; priceCents: number }>;
const manifest = JSON.parse(read('manifest.json')) as {
  api: Record<'bestbuy' | 'walmart' | 'amazon', { file: string; expect: Record<string, Expect> }>;
  pages: Record<string, Record<string, Expect>>;
};
const now = () => new Date('2026-11-01T08:00:00Z');

describe('API fixtures', () => {
  const ref = (retailer: RetailerSlug, sku: string): RetailerSkuRef => ({ retailer, sku });

  it.each(Object.entries(manifest.api.bestbuy.expect))('Best Buy %s', (sku, want) => {
    const { products } = JSON.parse(read(manifest.api.bestbuy.file)) as {
      products: Parameters<typeof mapBestBuy>[1][];
    };
    const p = products.find((x) => String(x!.sku) === sku);
    expect(mapBestBuy(ref('bestbuy', sku), p, now)).toMatchObject(want);
  });

  it.each(Object.entries(manifest.api.walmart.expect))('Walmart %s', (id, want) => {
    const { items } = JSON.parse(read(manifest.api.walmart.file)) as { items: WalmartItem[] };
    expect(
      mapWalmart(
        ref('walmart', id),
        items.find((i) => String(i.itemId) === id),
        now,
      ),
    ).toMatchObject(want);
  });

  it.each(Object.entries(manifest.api.amazon.expect))('Amazon %s', (asin, want) => {
    const json = JSON.parse(read(manifest.api.amazon.file)) as {
      ItemsResult: { Items: PaapiItem[] };
    };
    const item = json.ItemsResult.Items.find((i) => i.ASIN === asin);
    expect(mapAmazon(ref('amazon', asin), item, now)).toMatchObject(want);
  });
});

describe('page fixtures', () => {
  const policy = {
    enabled: true,
    maxRequestsPerMinute: 30,
    allowedEndpoints: [],
    automationAllowed: false,
    backoffSeconds: 300,
  };
  const cases = Object.entries(manifest.pages).flatMap(([slug, files]) =>
    Object.entries(files).map(([file, want]) => [slug, file, want] as const),
  );

  it.each(cases)('%s %s', async (slug, file, want) => {
    const html = read(join('pages', file));
    const adapter = pageAdapter(slug as 'target' | 'gamestop' | 'pokemoncenter', policy, {
      userAgent: 'test',
      now,
      fetch: (async () => new Response(html, { status: 200 })) as unknown as typeof fetch,
    });
    const [r] = await adapter.fetchAvailability([
      { retailer: slug as RetailerSlug, sku: '1', url: `https://example.test/${file}` },
    ]);
    expect(r).toMatchObject(want);
  });
});
