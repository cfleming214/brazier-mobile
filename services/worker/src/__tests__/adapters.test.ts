import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapAmazon, signPaapi } from '../adapters/amazon';
import { bestBuyAdapter, mapBestBuy } from '../adapters/bestbuy';
import { parseJsonLdProduct } from '../adapters/jsonld';
import { pageAdapter } from '../adapters/pages';
import { BlockedError, detectProtections } from '../adapters/protections';
import { mapWalmart, walmartHeaders } from '../adapters/walmart';
import { ProtectionTracker, describeProtection } from '../protection';

const page = (name: string) => readFileSync(join(__dirname, 'fixtures/pages', name), 'utf8');
const now = () => new Date('2026-11-01T08:00:00Z');
const policy = {
  enabled: true,
  maxRequestsPerMinute: 30,
  allowedEndpoints: [],
  automationAllowed: true,
  backoffSeconds: 300,
};
const stubFetch = (status: number, body: string) =>
  (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;

describe('Best Buy', () => {
  const ref = { retailer: 'bestbuy' as const, sku: '6624827' };
  it('maps the Products API response', () => {
    expect(
      mapBestBuy(
        ref,
        {
          sku: 6624827,
          name: 'x',
          onlineAvailability: true,
          inStoreAvailability: false,
          salePrice: 26.99,
        },
        now,
      ),
    ).toMatchObject({
      state: 'IN_STOCK',
      priceCents: 2699,
      shipAvailable: true,
    });
    expect(
      mapBestBuy(
        ref,
        {
          sku: 1,
          name: 'x',
          onlineAvailability: false,
          inStoreAvailability: true,
          orderable: 'SoldOut',
        },
        now,
      ),
    ).toMatchObject({
      state: 'OUT_OF_STOCK',
      pickupAvailable: true,
    });
    expect(
      mapBestBuy(
        ref,
        {
          sku: 1,
          name: 'x',
          onlineAvailability: false,
          inStoreAvailability: false,
          orderable: 'PreOrder',
        },
        now,
      ).state,
    ).toBe('PREORDER');
    expect(mapBestBuy(ref, undefined, now).state).toBe('DELISTED');
  });
  it('batches SKUs into one request and maps by SKU', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response(
        JSON.stringify({
          products: [
            {
              sku: 2,
              name: 'b',
              onlineAvailability: true,
              inStoreAvailability: false,
              salePrice: 10,
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const a = bestBuyAdapter(policy, { userAgent: 'test', fetch: fetchImpl, now }, 'KEY');
    const res = await a.fetchAvailability([
      { retailer: 'bestbuy', sku: '1' },
      { retailer: 'bestbuy', sku: '2' },
    ]);
    expect(url).toContain('products(sku in(1,2))');
    expect(res.map((r) => r.state)).toEqual(['DELISTED', 'IN_STOCK']);
  });
  it('throws BlockedError on 429', async () => {
    const a = bestBuyAdapter(
      policy,
      { userAgent: 'test', fetch: stubFetch(429, 'slow down'), now },
      'KEY',
    );
    await expect(a.fetchAvailability([ref])).rejects.toBeInstanceOf(BlockedError);
  });
});

describe('Walmart', () => {
  const ref = { retailer: 'walmart' as const, sku: '13816151308' };
  it('separates first-party stock from marketplace sellers', () => {
    expect(
      mapWalmart(
        ref,
        { itemId: 1, name: 'x', stock: 'Available', salePrice: 49.97, sellerInfo: 'Walmart.com' },
        now,
      ),
    ).toMatchObject({
      state: 'IN_STOCK',
      marketplaceOnly: false,
      priceCents: 4997,
    });
    expect(
      mapWalmart(
        ref,
        { itemId: 1, name: 'x', stock: 'Available', salePrice: 189, sellerInfo: 'TCG Flips Inc' },
        now,
      ).marketplaceOnly,
    ).toBe(true);
    expect(mapWalmart(ref, { itemId: 1, name: 'x', stock: 'Not available' }, now).state).toBe(
      'OUT_OF_STOCK',
    );
  });
  it('signs requests with RSA-SHA256', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const h = walmartHeaders('consumer-1', pem, '1', 1793520000000);
    const ok = createVerify('RSA-SHA256')
      .update('consumer-1\n1793520000000\n1\n')
      .verify(publicKey, h['WM_SEC.AUTH_SIGNATURE'], 'base64');
    expect(ok).toBe(true);
    expect(h['WM_CONSUMER.INTIMESTAMP']).toBe('1793520000000');
  });
});

describe('Amazon', () => {
  const ref = { retailer: 'amazon' as const, sku: 'B0DLPL7LC5' };
  it('maps PA-API offers', () => {
    expect(
      mapAmazon(
        ref,
        {
          ASIN: ref.sku,
          Offers: {
            Listings: [
              {
                Availability: { Type: 'Now' },
                Price: { Amount: 59.99 },
                MerchantInfo: { Name: 'Amazon.com' },
              },
            ],
          },
        },
        now,
      ),
    ).toMatchObject({ state: 'IN_STOCK', priceCents: 5999, marketplaceOnly: false });
    expect(
      mapAmazon(
        ref,
        {
          ASIN: ref.sku,
          Offers: {
            Listings: [{ Availability: { Type: 'Now' }, MerchantInfo: { Name: 'Some Seller' } }],
          },
        },
        now,
      ).marketplaceOnly,
    ).toBe(true);
    expect(mapAmazon(ref, { ASIN: ref.sku }, now).state).toBe('OUT_OF_STOCK');
  });
  it('produces a stable SigV4 signature', () => {
    const args = {
      accessKey: 'AKID',
      secretKey: 'SECRET',
      body: '{}',
      target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
      date: new Date('2026-11-01T08:00:00Z'),
    };
    const a = signPaapi(args);
    expect(a['x-amz-date']).toBe('20261101T080000Z');
    expect(a.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20261101\/us-east-1\/ProductAdvertisingAPI\/aws4_request, SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
    );
    expect(signPaapi(args).Authorization).toBe(a.Authorization);
    expect(signPaapi({ ...args, body: '{"x":1}' }).Authorization).not.toBe(a.Authorization);
  });
});

describe('page adapters (JSON-LD)', () => {
  it('parses in-stock, out-of-stock, preorder and marketplace offers', () => {
    expect(parseJsonLdProduct(page('target-in-stock.html'))).toEqual({
      state: 'IN_STOCK',
      priceCents: 5999,
      sellerName: 'Target',
    });
    expect(parseJsonLdProduct(page('target-oos-limit.html'))).toMatchObject({
      state: 'OUT_OF_STOCK',
      priceCents: 5999,
    });
    expect(parseJsonLdProduct(page('pkc-preorder.html'))?.state).toBe('PREORDER');
    expect(parseJsonLdProduct('<html>no data</html>')).toBeNull();
  });
  it('flags marketplace sellers and pickup, and reports protections', async () => {
    const gme = pageAdapter('gamestop', policy, {
      userAgent: 't',
      fetch: stubFetch(200, page('gamestop-marketplace.html')),
      now,
    });
    const [g] = await gme.fetchAvailability([
      { retailer: 'gamestop', sku: '1', url: 'https://www.gamestop.com/x/1.html' },
    ]);
    expect(g).toMatchObject({ state: 'IN_STOCK', marketplaceOnly: true });

    const tgt = pageAdapter('target', policy, {
      userAgent: 't',
      fetch: stubFetch(200, page('target-in-stock.html')),
      now,
    });
    const [t] = await tgt.fetchAvailability([{ retailer: 'target', sku: '93954435' }]);
    expect(t).toMatchObject({ state: 'IN_STOCK', marketplaceOnly: false, pickupAvailable: true });

    const lim = pageAdapter('target', policy, {
      userAgent: 't',
      fetch: stubFetch(200, page('target-oos-limit.html')),
      now,
    });
    const [l] = await lim.fetchAvailability([{ retailer: 'target', sku: '1' }]);
    expect(l!.protections).toEqual(['limit:1']);
  });
  it('treats a queue page as blocked and never tries to get past it', async () => {
    const pkc = pageAdapter('pokemoncenter', policy, {
      userAgent: 't',
      fetch: stubFetch(200, page('pkc-queue.html')),
      now,
    });
    await expect(
      pkc.fetchAvailability([{ retailer: 'pokemoncenter', sku: '10-10037-118' }]),
    ).rejects.toMatchObject({ protections: ['queue'] });
  });
  it('reports a 404 as delisted', async () => {
    const a = pageAdapter('target', policy, { userAgent: 't', fetch: stubFetch(404, 'gone'), now });
    expect((await a.fetchAvailability([{ retailer: 'target', sku: '1' }]))[0]!.state).toBe(
      'DELISTED',
    );
  });
});

describe('protections', () => {
  it('detects each protection type', () => {
    expect(detectProtections(429)).toEqual(['ratelimit']);
    expect(detectProtections(200, '<div id="px-captcha"></div>')).toEqual(['captcha']);
    expect(detectProtections(403, 'Forbidden')).toEqual(['blocked']);
    expect(detectProtections(200, 'Limit 2 per order. Available only in the app.')).toEqual(
      expect.arrayContaining(['limit:2', 'app_only']),
    );
    expect(detectProtections(200, 'In-store only')).toEqual(['in_store_only']);
    expect(detectProtections(200, 'Enter the drawing for a chance')).toEqual(['raffle']);
  });

  it('needs two sightings to turn on and a quiet period to turn off', async () => {
    let t = 0;
    const tracker = new ProtectionTracker(null, { confirmChecks: 2, clearMs: 5 * 60_000 }, () => t);
    expect(await tracker.observe('pokemoncenter', 's1', ['queue'])).toEqual([]);
    expect(await tracker.observe('pokemoncenter', 's1', ['queue'])).toEqual([
      { retailer: 'pokemoncenter', skuId: 's1', protection: 'queue', active: true },
    ]);
    expect(await tracker.observe('pokemoncenter', 's1', ['queue'])).toEqual([]);
    expect(tracker.activeFor('pokemoncenter')).toEqual(['queue']);
    t = 60_000;
    expect(await tracker.observe('pokemoncenter', 's1', [])).toEqual([]);
    t = 6 * 60_000;
    expect(await tracker.observe('pokemoncenter', 's1', [])).toEqual([
      { retailer: 'pokemoncenter', skuId: 's1', protection: 'queue', active: false },
    ]);
  });

  it('writes clear notification text', () => {
    expect(
      describeProtection(
        { retailer: 'pokemoncenter', skuId: null, protection: 'queue', active: true },
        'Mega Evolution ETB',
      ).body,
    ).toBe(
      "Pokémon Center turned on its queue for Mega Evolution ETB. You'll need to wait in line yourself.",
    );
    expect(
      describeProtection(
        { retailer: 'target', skuId: null, protection: 'limit:1', active: true },
        'PRE ETB',
      ).body,
    ).toBe('Target now limits PRE ETB to 1 per customer.');
    expect(
      describeProtection(
        { retailer: 'target', skuId: null, protection: 'limit:1', active: false },
        'PRE ETB',
      ).title,
    ).toBe('Target is back to normal');
  });
});
