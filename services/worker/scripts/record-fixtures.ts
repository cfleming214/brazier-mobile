/**
 * Re-record adapter fixtures from live sources, politely (DROP-57).
 *
 *   pnpm --filter @brazier/worker exec tsx scripts/record-fixtures.ts bestbuy:6624827 walmart:5236617690
 *   ... --pages target:93954435      (page retailers are opt-in and checked against robots.txt)
 *
 * Rules: one request at a time, at least 10 s apart, the identifying Brazier user agent, official
 * APIs by default, robots.txt honoured for pages, and a 429/403/queue/challenge stops the run —
 * it is never retried or worked around. Output goes to src/__tests__/fixtures/recorded/ for review;
 * copy what you need into the api/ or pages/ fixtures and update manifest.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RetailerPolicy, RetailerSlug } from '@brazier/shared';
import { BlockedError } from '../src/adapters/protections';
import { buildAdapters, POLLED_RETAILERS } from '../src/adapters/registry';
import { loadConfig } from '../src/config';

const MIN_GAP_MS = 10_000;
const API_RETAILERS: RetailerSlug[] = ['bestbuy', 'walmart', 'amazon'];
const out = join(__dirname, '../src/__tests__/fixtures/recorded');

const args = process.argv.slice(2);
const allowPages = args.includes('--pages');
const targets = args
  .filter((a) => a.includes(':'))
  .map((a) => {
    const [retailer, sku] = a.split(':') as [RetailerSlug, string];
    return { retailer, sku };
  });
if (targets.length === 0) {
  console.error('Usage: record-fixtures.ts <retailer:sku> [...] [--pages]');
  process.exit(2);
}

async function robotsAllows(url: URL, ua: string): Promise<boolean> {
  const res = await fetch(`${url.origin}/robots.txt`, { headers: { 'user-agent': ua } });
  if (!res.ok) return res.status === 404;
  let applies = false;
  const disallowed: string[] = [];
  for (const raw of (await res.text()).split('\n')) {
    const line = raw.split('#')[0]!.trim();
    const [k, ...v] = line.split(':');
    const value = v.join(':').trim();
    if (/^user-agent$/i.test(k ?? '')) applies = value === '*' || /brazier/i.test(value);
    else if (applies && /^disallow$/i.test(k ?? '') && value) disallowed.push(value);
  }
  return !disallowed.some((p) => url.pathname.startsWith(p));
}

async function main() {
  const config = loadConfig({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'unused-for-recording' });
  const policy: RetailerPolicy = {
    enabled: true,
    maxRequestsPerMinute: 6,
    allowedEndpoints: [],
    automationAllowed: false,
    backoffSeconds: 600,
  };
  let lastRequest = 0;
  let captured: { url: string; status: number; body: string } | null = null;
  const politeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!API_RETAILERS.some((r) => url.hostname.includes(r === 'bestbuy' ? 'bestbuy' : r))) {
      if (!allowPages) throw new Error(`Page recording is opt-in (--pages): ${url.hostname}`);
      if (!(await robotsAllows(url, config.USER_AGENT)))
        throw new Error(`robots.txt disallows ${url.pathname} on ${url.hostname}`);
    }
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(input, init);
    const body = await res.text();
    captured = { url: url.origin + url.pathname, status: res.status, body };
    return new Response(body, { status: res.status, headers: res.headers });
  }) as typeof fetch;

  const adapters = buildAdapters(
    { ...config, FAKE_RETAILER_URL: undefined },
    new Map(POLLED_RETAILERS.map((s) => [s, policy])),
    { userAgent: config.USER_AGENT, fetch: politeFetch },
  );
  mkdirSync(out, { recursive: true });

  for (const t of targets) {
    const adapter = adapters.get(t.retailer);
    if (!adapter) throw new Error(`No adapter for ${t.retailer}`);
    captured = null;
    try {
      const [result] = await adapter.fetchAvailability([{ retailer: t.retailer, sku: t.sku }]);
      const c = captured as { url: string; status: number; body: string } | null;
      if (!c) throw new Error('nothing captured');
      const ext = c.body.trimStart().startsWith('<') ? 'html' : 'json';
      const file = join(out, `${t.retailer}-${t.sku}.${ext}`);
      writeFileSync(file, c.body);
      console.log(`${t.retailer}:${t.sku} → ${result?.state} (${c.status}) saved ${file}`);
    } catch (e) {
      if (e instanceof BlockedError) {
        console.error(
          `${t.retailer} is limiting or challenging requests (${e.protections.join(', ')}). Stopping.`,
        );
        process.exit(1);
      }
      throw e;
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
