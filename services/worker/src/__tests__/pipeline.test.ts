import type { AddressInfo } from 'node:net';
import type { RetailerSlug } from '@drophawk/shared';
import { createFakePush } from '@drophawk/fake-push';
import { createFakeRetailer } from '@drophawk/fake-retailer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeAdapter } from '../adapters/fake';
import { RetailerGovernor } from '../governor';
import { Notifier } from '../notifier';
import { Poller } from '../poller';
import { createPushClient } from '../push';
import { hasDb, testDb } from './helpers';

/**
 * Poll -> detect -> notify against local Supabase, the fake retailer and the fake Expo push server
 * (BUILD_PLAN 10.1 integration layer and 10.4 latency test).
 */
describe.skipIf(!hasDb)('worker pipeline', () => {
  const retailer = createFakeRetailer();
  const push = createFakePush();
  let retailerUrl = '';
  let pushUrl = '';
  let db: ReturnType<typeof testDb>;
  let poller: Poller;
  const users: string[] = [];
  // Test clock: jumps 10 minutes before each read so every SKU is due, without sleeping.
  let offset = 0;
  const now = () => Date.now() + offset;
  const tick = async () => {
    offset += 600_000;
    await poller.tick();
  };

  const policy = {
    enabled: true,
    maxRequestsPerMinute: 100_000,
    allowedEndpoints: [],
    automationAllowed: true,
    backoffSeconds: 1,
  };
  const slugs: RetailerSlug[] = ['target', 'bestbuy', 'walmart', 'gamestop', 'pokemoncenter'];

  async function newUser(token: string) {
    const { data, error } = await db.auth.admin.createUser({
      email: `${token}-${Date.now()}@test.local`,
      email_confirm: true,
    });
    if (error) throw error;
    users.push(data.user.id);
    await db.from('push_tokens').insert({
      user_id: data.user.id,
      expo_token: `ExponentPushToken[${token}]`,
      platform: 'ios',
    });
    return data.user.id;
  }

  async function resetSku(retailerId: string, sku: string) {
    await db
      .from('retailer_skus')
      .update({
        last_state: 'OUT_OF_STOCK',
        confirmations: 0,
        last_in_stock_at: null,
        last_out_of_stock_at: '2026-01-01T00:00:00Z',
        last_checked_at: null,
        poll_tier: 'cold',
      })
      .eq('retailer_id', retailerId)
      .eq('retailer_sku', sku);
  }

  async function set(r: RetailerSlug, sku: string, patch: Record<string, unknown>) {
    retailer.upsert(r, sku, patch);
  }

  const skuId = async (r: string, sku: string) =>
    (
      await db
        .from('retailer_skus')
        .select('id')
        .eq('retailer_id', r)
        .eq('retailer_sku', sku)
        .single()
    ).data!.id as string;

  beforeAll(async () => {
    db = testDb();
    await new Promise<void>((r) => retailer.server.listen(0, r));
    await new Promise<void>((r) => push.server.listen(0, r));
    retailerUrl = `http://127.0.0.1:${(retailer.server.address() as AddressInfo).port}`;
    pushUrl = `http://127.0.0.1:${(push.server.address() as AddressInfo).port}`;
    const ctx = { userAgent: 'DropHawk-test', fetch, now: () => new Date(now()) };
    const adapters = new Map(
      slugs.map((s) => [s, fakeAdapter(s, policy, ctx, retailerUrl)] as const),
    );
    const governors = new Map(slugs.map((s) => [s, new RetailerGovernor(policy)] as const));
    poller = new Poller({
      db,
      adapters,
      governors,
      notifier: new Notifier(db, createPushClient(pushUrl), () => new Date(now())),
      confirmDelayMs: 0,
      now,
    });
  });

  beforeEach(async () => {
    await db
      .from('watches')
      .delete()
      .in('user_id', users.length ? users : ['00000000-0000-0000-0000-000000000000']);
    push.messages.length = 0;
    retailer.skus.clear();
  });

  afterAll(async () => {
    for (const u of users) await db.auth.admin.deleteUser(u);
    await new Promise<void>((r) => retailer.server.close(() => r()));
    await new Promise<void>((r) => push.server.close(() => r()));
  });

  it('confirms a restock, alerts the watcher and records everything', async () => {
    const user = await newUser('happy');
    await resetSku('target', '90000001');
    await set('target', '90000001', { state: 'OUT_OF_STOCK' });
    const { data: watch } = await db
      .from('watches')
      .insert({
        user_id: user,
        product_id: '11111111-1111-4111-8111-111111111101',
        retailer_ids: ['target'],
        max_price_cents: 6500,
      })
      .select('id')
      .single();

    await tick(); // baseline read
    await set('target', '90000001', { state: 'IN_STOCK', priceCents: 5999, shipAvailable: true });
    await tick(); // first in-stock read: asks for confirmation
    expect(push.messages).toHaveLength(0);
    await poller.tick(); // confirming read: alert

    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({
      to: 'ExponentPushToken[happy]',
      title: 'In stock: Prismatic Evolutions Elite Trainer Box',
      body: 'Target · $59.99 · Tap to buy',
      priority: 'high',
      interruptionLevel: 'time-sensitive',
      categoryId: 'restock',
    });
    expect(push.messages[0]!.data).toMatchObject({
      type: 'restock',
      watchId: watch!.id,
      retailer: 'target',
    });

    const id = await skuId('target', '90000001');
    const { data: events } = await db
      .from('stock_events')
      .select('new_state, suppressed_reason')
      .eq('retailer_sku_id', id)
      .order('id', { ascending: false })
      .limit(1);
    expect(events![0]).toEqual({ new_state: 'IN_STOCK', suppressed_reason: null });
    expect((await db.from('alerts').select('id').eq('watch_id', watch!.id)).data).toHaveLength(1);
    const { data: inbox } = await db
      .from('notifications')
      .select('category, push_status')
      .eq('user_id', user);
    expect(inbox).toEqual([{ category: 'restock', push_status: 'sent' }]);
    const { data: activity } = await db.from('activity_events').select('kind').eq('user_id', user);
    expect(activity!.map((a) => a.kind)).toEqual(expect.arrayContaining(['in_stock', 'push']));
    expect(poller.metrics.snapshot().p95Ms).not.toBeNull();
  });

  it('records but does not alert when the price is over the max', async () => {
    const user = await newUser('pricey');
    await resetSku('bestbuy', '9000002');
    await set('bestbuy', '9000002', { state: 'OUT_OF_STOCK' });
    await db.from('watches').insert({
      user_id: user,
      product_id: '11111111-1111-4111-8111-111111111102',
      retailer_ids: ['bestbuy'],
      max_price_cents: 2500,
    });
    await tick();
    await set('bestbuy', '9000002', { state: 'IN_STOCK', priceCents: 4999, shipAvailable: true });
    await tick();
    await tick();
    expect(push.messages.filter((m) => m.to === 'ExponentPushToken[pricey]')).toHaveLength(0);
    const { data: activity } = await db
      .from('activity_events')
      .select('message')
      .eq('user_id', user)
      .eq('kind', 'suppressed');
    expect(activity!.some((a) => a.message.includes('over_max_price'))).toBe(true);
    expect((await db.from('notifications').select('id').eq('user_id', user)).data).toHaveLength(0);
  });

  it('suppresses marketplace-only stock unless the user opted in', async () => {
    const strict = await newUser('strict');
    const open = await newUser('open');
    await resetSku('walmart', '900000005');
    await set('walmart', '900000005', { state: 'OUT_OF_STOCK' });
    const ins = await db.from('watches').insert([
      {
        user_id: strict,
        product_id: '11111111-1111-4111-8111-111111111105',
        retailer_ids: ['walmart'],
        include_marketplace: false,
      },
      {
        user_id: open,
        product_id: '11111111-1111-4111-8111-111111111105',
        retailer_ids: ['walmart'],
        include_marketplace: true,
      },
    ]);
    expect(ins.error).toBeNull();
    await tick();
    await set('walmart', '900000005', {
      state: 'IN_STOCK',
      priceCents: 18900,
      shipAvailable: true,
      marketplaceOnly: true,
    });
    await tick();
    await tick();
    expect(push.messages.map((m) => m.to)).toEqual(['ExponentPushToken[open]']);
  });

  it('ignores a ghost restock that disappears before confirmation', async () => {
    const user = await newUser('ghost');
    await resetSku('target', '90000003');
    await set('target', '90000003', { state: 'OUT_OF_STOCK' });
    await db.from('watches').insert({
      user_id: user,
      product_id: '11111111-1111-4111-8111-111111111103',
      retailer_ids: ['target'],
    });
    await tick();
    await set('target', '90000003', { state: 'IN_STOCK', priceCents: 4999, shipAvailable: true });
    await tick();
    await set('target', '90000003', { state: 'OUT_OF_STOCK' });
    await tick();
    expect(push.messages).toHaveLength(0);
    const id = await skuId('target', '90000003');
    const { data } = await db
      .from('stock_events')
      .select('suppressed_reason')
      .eq('retailer_sku_id', id)
      .order('id', { ascending: false })
      .limit(1);
    expect(data![0]!.suppressed_reason).toBe('unconfirmed');
  });

  it('notifies watchers once when a retailer turns on a queue, and again when it clears', async () => {
    const user = await newUser('queue');
    await resetSku('pokemoncenter', '99-99999-004');
    await set('pokemoncenter', '99-99999-004', { state: 'OUT_OF_STOCK', protections: ['queue'] });
    await db.from('watches').insert({
      user_id: user,
      product_id: '11111111-1111-4111-8111-111111111104',
      retailer_ids: ['pokemoncenter'],
    });
    await tick();
    expect(push.messages).toHaveLength(0); // seen once: not confirmed yet
    await db
      .from('retailer_skus')
      .update({ last_checked_at: null })
      .eq('retailer_sku', '99-99999-004');
    await tick();
    const queueMsgs = push.messages.filter((m) => m.to === 'ExponentPushToken[queue]');
    expect(queueMsgs).toHaveLength(1);
    expect(queueMsgs[0]!.body).toBe(
      "Pokémon Center turned on its queue for Mega Evolution Pokémon Center Elite Trainer Box. You'll need to wait in line yourself.",
    );
    expect(poller.protections.activeFor('pokemoncenter')).toContain('queue');
  });

  it('meets the 3 second p95 budget from stock change to push accepted', async () => {
    const user = await newUser('latency');
    await db.from('watches').insert({
      user_id: user,
      product_id: '11111111-1111-4111-8111-111111111101',
      retailer_ids: ['target'],
    });
    poller.metrics.reset();
    for (let i = 0; i < 10; i++) {
      await resetSku('target', '90000001');
      await set('target', '90000001', { state: 'OUT_OF_STOCK' });
      await tick();
      await set('target', '90000001', { state: 'IN_STOCK', priceCents: 5999, shipAvailable: true });
      await tick();
      await poller.tick(); // confirming read follows immediately, as in production (1 s later)
    }
    const snap = poller.metrics.snapshot();
    expect(snap.samples).toBeGreaterThanOrEqual(10);
    expect(snap.p95Ms!).toBeLessThan(3000);
  });
});
