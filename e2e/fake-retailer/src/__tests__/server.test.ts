import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeRetailer } from '../server';

const fake = createFakeRetailer();
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => fake.server.listen(0, r));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => fake.server.close(() => r())));

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

describe('fake retailer', () => {
  it('flips stock through the control API and reports it on the availability endpoint', async () => {
    await post('/control/reset', {});
    await post('/control/sku/target/SAMPLE-TGT-0001', { state: 'OUT_OF_STOCK' });
    let res = await fetch(`${base}/target/availability?skus=SAMPLE-TGT-0001`).then((r) => r.json());
    expect(res.results[0].state).toBe('OUT_OF_STOCK');

    await post('/control/sku/target/SAMPLE-TGT-0001', {
      state: 'IN_STOCK',
      priceCents: 5999,
      shipAvailable: true,
    });
    res = await fetch(`${base}/target/availability?skus=SAMPLE-TGT-0001`).then((r) => r.json());
    expect(res.results[0]).toMatchObject({
      state: 'IN_STOCK',
      priceCents: 5999,
      shipAvailable: true,
    });
  });

  it('reports unknown SKUs as delisted', async () => {
    const res = await fetch(`${base}/bestbuy/availability?skus=NOPE`).then((r) => r.json());
    expect(res.results[0].state).toBe('DELISTED');
  });

  it('returns 429 when a rate-limit protection is set', async () => {
    await post('/control/sku/pokemoncenter/SAMPLE-PKC-0004', { protections: ['ratelimit'] });
    const r = await fetch(`${base}/pokemoncenter/availability?skus=SAMPLE-PKC-0004`);
    expect(r.status).toBe(429);
  });

  it('logs retailer-facing requests but not control calls', async () => {
    await post('/control/reset', {});
    await fetch(`${base}/walmart/availability?skus=X`);
    const log = await fetch(`${base}/control/requests`).then((r) => r.json());
    expect(log).toHaveLength(1);
    expect(log[0].path).toBe('/walmart/availability?skus=X');
  });

  it('rejects unknown retailers and states', async () => {
    const r1 = await fetch(`${base}/control/sku/ebay/X`, { method: 'POST', body: '{}' });
    expect(r1.status).toBe(400);
    const r2 = await fetch(`${base}/control/sku/target/X`, {
      method: 'POST',
      body: JSON.stringify({ state: 'MAYBE' }),
    });
    expect(r2.status).toBe(400);
  });
});

describe('fixtures route', () => {
  it('serves the shared adapter fixtures and refuses path traversal', async () => {
    const { server } = createFakeRetailer();
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    try {
      const ok = await fetch(`${base}/fixtures/api/bestbuy-products.json`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { products: unknown[] }).products.length).toBeGreaterThan(0);
      const html = await fetch(`${base}/fixtures/pages/target-in-stock.html`);
      expect(html.headers.get('content-type')).toBe('text/html');
      expect((await fetch(`${base}/fixtures/..%2F..%2Fpackage.json`)).status).toBe(400);
      expect((await fetch(`${base}/fixtures/api/missing.json`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
