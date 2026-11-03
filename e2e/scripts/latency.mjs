#!/usr/bin/env node
/* global console, process, fetch, setTimeout */
// Pipeline latency test (DROP-62): fake-retailer flip → push recorded by fake-push, over N flips.
// Runs against the full E2E stack (`supabase start` + `pnpm e2e:up`). Fails if p95 > budget.
// Gate (BUILD_PLAN §5): "stock change observed → push accepted" p95 ≤ 3 s. "Observed" is the
// worker's first fake-retailer read of the SKU after the flip (from the request log), so the wait
// for the next scheduled poll — set by the poll tier and the retailer's rate budget — is reported
// separately as flip → push and not gated.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node e2e/scripts/latency.mjs [--flips 50] [--budget 3000]
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const FLIPS = arg('flips', 50);
const BUDGET_MS = arg('budget', 3000);
const TIMEOUT_MS = 15_000;
const SUPABASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RETAILER = process.env.FAKE_RETAILER_URL ?? 'http://localhost:4010';
const PUSH = process.env.FAKE_PUSH_URL ?? 'http://localhost:4020';
const WORKER = process.env.WORKER_URL ?? 'http://localhost:8787';
const PRODUCT = '11111111-1111-4111-8111-111111111101';
const SKU = { retailer: 'target', sku: '90000001' };
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

const sb = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
async function req(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setSku = (body) =>
  req(`${RETAILER}/control/sku/${SKU.retailer}/${SKU.sku}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const pushes = () => req(`${PUSH}/messages`);
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

async function setup() {
  const email = `latency-${Date.now()}@test.local`;
  const user = await req(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sb,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  await req(`${SUPABASE}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: sb,
    body: JSON.stringify({ plan: 'pro' }),
  });
  await req(`${SUPABASE}/rest/v1/push_tokens`, {
    method: 'POST',
    headers: sb,
    body: JSON.stringify({
      user_id: user.id,
      expo_token: `ExponentPushToken[latency-${user.id}]`,
      platform: 'ios',
    }),
  });
  await req(`${SUPABASE}/rest/v1/watches`, {
    method: 'POST',
    headers: sb,
    body: JSON.stringify({ user_id: user.id, product_id: PRODUCT, retailer_ids: [SKU.retailer] }),
  });
  return user.id;
}

async function waitFor(pred, what) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const v = await pred();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function main() {
  const userId = await setup();
  try {
    await run(userId);
  } finally {
    // Remove the test user (cascades to watch, token, alerts) so other suites see a clean DB.
    await req(`${SUPABASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: sb }).catch(
      () => {},
    );
  }
}

async function run(userId) {
  const token = `ExponentPushToken[latency-${userId}]`;
  const mine = async () => (await pushes()).filter((m) => [].concat(m.to).includes(token));
  const samples = [];

  for (let i = 0; i < FLIPS; i++) {
    // Each flip must be a fresh restock: the detector deliberately ignores in-stock bounces within
    // 10 minutes (flapping guard), so reset the SKU's history the way a long sell-out would.
    await setSku({ state: 'OUT_OF_STOCK', shipAvailable: false, priceCents: 5999 });
    await req(
      `${SUPABASE}/rest/v1/retailer_skus?retailer_id=eq.${SKU.retailer}&retailer_sku=eq.${SKU.sku}`,
      {
        method: 'PATCH',
        headers: sb,
        body: JSON.stringify({
          last_state: 'OUT_OF_STOCK',
          confirmations: 0,
          last_in_stock_at: null,
          last_out_of_stock_at: '2026-01-01T00:00:00Z',
        }),
      },
    );
    const before = (await mine()).length;
    const t0 = Date.now();
    await setSku({ state: 'IN_STOCK', shipAvailable: true, priceCents: 5999 });
    const msgs = await waitFor(
      async () => {
        const m = await mine();
        return m.length > before ? m : null;
      },
      `push for flip ${i + 1}`,
    );
    const pushedAt = Date.parse(msgs.at(-1).receivedAt);
    const firstRead = (await req(`${RETAILER}/control/requests`))
      .filter((r) => r.path.startsWith(`/${SKU.retailer}/`) && r.path.includes(SKU.sku))
      .map((r) => Date.parse(r.at))
      .find((at) => at >= t0);
    samples.push({ observedToPushMs: pushedAt - firstRead, flipToPushMs: pushedAt - t0 });
    process.stdout.write(
      `flip ${i + 1}/${FLIPS}: observed→push ${samples.at(-1).observedToPushMs} ms, flip→push ${samples.at(-1).flipToPushMs} ms\n`,
    );
  }

  const gated = samples.map((s) => s.observedToPushMs).sort((a, b) => a - b);
  const flip = samples.map((s) => s.flipToPushMs).sort((a, b) => a - b);
  const report = {
    flips: FLIPS,
    budgetMs: BUDGET_MS,
    p50Ms: pct(gated, 50),
    p95Ms: pct(gated, 95),
    maxMs: gated.at(-1),
    flipToPush: { p50Ms: pct(flip, 50), p95Ms: pct(flip, 95), maxMs: flip.at(-1) },
    workerMetrics: await req(`${WORKER}/metrics`).catch(() => null),
    samples,
    at: new Date().toISOString(),
  };
  mkdirSync('e2e/artifacts', { recursive: true });
  writeFileSync('e2e/artifacts/latency.json', JSON.stringify(report, null, 2));
  console.log(
    `observed→push p50 ${report.p50Ms} ms · p95 ${report.p95Ms} ms · max ${report.maxMs} ms (budget ${BUDGET_MS} ms)`,
  );
  console.log(
    `flip→push p50 ${report.flipToPush.p50Ms} ms · p95 ${report.flipToPush.p95Ms} ms (not gated)`,
  );
  if (report.p95Ms > BUDGET_MS) {
    console.error(`FAIL: p95 ${report.p95Ms} ms exceeds ${BUDGET_MS} ms`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
