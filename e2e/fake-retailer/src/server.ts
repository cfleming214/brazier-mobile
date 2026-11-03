import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join, normalize, resolve } from 'node:path';
import { RetailerSlug, StockState } from '@brazier/shared';

/**
 * Fake retailer for integration and E2E tests (BUILD_PLAN section 10.2).
 * Serves per-retailer product availability and exposes a control API so tests can
 * flip stock, price and protections on demand. Retailer response shapes are filled in
 * per adapter as adapters are built (DROP-29 onward); the generic JSON shape below is
 * what every adapter's fixture mode reads in Phase 0.
 */

export interface SkuState {
  retailer: RetailerSlug;
  sku: string;
  state: StockState;
  priceCents: number | null;
  marketplaceOnly: boolean;
  shipAvailable: boolean;
  pickupAvailable: boolean;
  /** Active protections, e.g. "queue", "captcha", "limit:1". Used by DROP-91 tests. */
  protections: string[];
  updatedAt: string;
}

export interface RequestLog {
  method: string;
  path: string;
  at: string;
}

/** Recorded adapter fixtures shared with the worker's contract tests (DROP-57). */
const FIXTURES_DIR = resolve(
  process.env.FIXTURES_DIR ??
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../services/worker/src/__tests__/fixtures',
    ),
);

export function createFakeRetailer() {
  const skus = new Map<string, SkuState>();
  const requests: RequestLog[] = [];
  const key = (retailer: string, sku: string) => `${retailer}:${sku}`;

  function upsert(retailer: RetailerSlug, sku: string, patch: Partial<SkuState>): SkuState {
    const prev = skus.get(key(retailer, sku));
    const next: SkuState = {
      retailer,
      sku,
      state: 'OUT_OF_STOCK',
      priceCents: null,
      marketplaceOnly: false,
      shipAvailable: false,
      pickupAvailable: false,
      protections: [],
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    skus.set(key(retailer, sku), next);
    return next;
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (parts[0] !== 'control' && parts[0] !== 'health') {
      requests.push({ method, path: url.pathname + url.search, at: new Date().toISOString() });
    }

    try {
      if (parts[0] === 'health') return send(res, 200, { ok: true });

      // ---- Recorded fixtures: GET /fixtures/api/bestbuy-products.json, /fixtures/pages/x.html ----
      if (method === 'GET' && parts[0] === 'fixtures') {
        const rel = normalize(parts.slice(1).map(decodeURIComponent).join('/'));
        const file = resolve(FIXTURES_DIR, rel);
        if (!file.startsWith(FIXTURES_DIR + '/')) return send(res, 400, { error: 'bad path' });
        try {
          const body = await readFile(file);
          res.writeHead(200, {
            'content-type': file.endsWith('.html') ? 'text/html' : 'application/json',
          });
          return res.end(body);
        } catch {
          return send(res, 404, { error: 'no such fixture' });
        }
      }

      // ---- Control API (used by tests only) ----
      if (parts[0] === 'control') {
        if (method === 'POST' && parts[1] === 'reset') {
          skus.clear();
          requests.length = 0;
          return send(res, 200, { ok: true });
        }
        if (method === 'GET' && parts[1] === 'requests') return send(res, 200, requests);
        if (method === 'GET' && parts[1] === 'skus') return send(res, 200, [...skus.values()]);
        if (parts[1] === 'sku' && parts[2] && parts[3]) {
          const retailer = RetailerSlug.parse(parts[2]);
          if (method === 'POST') {
            const body = (await readJson(req)) as Partial<SkuState>;
            if (body.state) StockState.parse(body.state);
            return send(res, 200, upsert(retailer, parts[3], body));
          }
          if (method === 'GET') {
            const s = skus.get(key(retailer, parts[3]));
            return s ? send(res, 200, s) : send(res, 404, { error: 'unknown sku' });
          }
        }
        return send(res, 404, { error: 'unknown control route' });
      }

      // ---- Retailer-facing API: GET /:retailer/availability?skus=a,b ----
      if (method === 'GET' && parts.length === 2 && parts[1] === 'availability') {
        const retailer = RetailerSlug.parse(parts[0]);
        const list = (url.searchParams.get('skus') ?? '').split(',').filter(Boolean);
        const results = list.map(
          (sku) =>
            skus.get(key(retailer, sku)) ?? {
              retailer,
              sku,
              state: 'DELISTED' as const,
              priceCents: null,
              marketplaceOnly: false,
              shipAvailable: false,
              pickupAvailable: false,
              protections: [],
              updatedAt: new Date().toISOString(),
            },
        );
        const blocked = results.find((r) => r.protections.includes('ratelimit'));
        if (blocked) return send(res, 429, { error: 'rate limited' });
        return send(res, 200, { retailer, results });
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
    }
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  return { server, skus, requests, upsert };
}
