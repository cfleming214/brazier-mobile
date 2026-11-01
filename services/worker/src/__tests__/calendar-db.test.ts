import { beforeAll, describe, expect, it } from 'vitest';
import { notifyChanges, runCalendarClock } from '../calendar/notify';
import { ingest } from '../calendar/pipeline';
import { handleLead, parseInboundEmail } from '../leads';
import { Notifier } from '../notifier';
import type { PushClient, PushMessage } from '../push';
import { hasDb, testDb } from './helpers';

describe.skipIf(!hasDb)('calendar pipeline against local Supabase', () => {
  let db: ReturnType<typeof testDb>;
  const sent: PushMessage[] = [];
  const push: PushClient = {
    send: async (m) => {
      sent.push(...m);
      return m.map(() => ({ status: 'ok' as const, id: crypto.randomUUID() }));
    },
    receipts: async () => ({}),
  };
  let user = '';
  const now = new Date();
  const day = (offsetDays: number) => {
    const d = new Date(now.getTime() + offsetDays * 86_400_000);
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  beforeAll(async () => {
    db = testDb();
    // Start clean: earlier runs leave merged events for this product.
    await db
      .from('calendar_events')
      .delete()
      .eq('product_id', '11111111-1111-4111-8111-111111111105');
    await db.from('calendar_source_items').delete().in('source', ['pokebeach', 'walmart-news']);
    const { data } = await db.auth.admin.createUser({
      email: `cal-${Date.now()}@test.local`,
      email_confirm: true,
    });
    user = data.user!.id;
    await db
      .from('push_tokens')
      .insert({ user_id: user, expo_token: 'ExponentPushToken[cal]', platform: 'android' });
    await db.from('watches').insert({
      user_id: user,
      product_id: '11111111-1111-4111-8111-111111111105',
      retailer_ids: ['walmart'],
    });
  });

  it('holds rumors for review, then confirms, moves and notifies when an official source arrives', async () => {
    const notifier = new Notifier(db, push);
    const rumor = await ingest(
      db,
      [
        {
          source: 'pokebeach',
          externalId: `pfl-${now.getTime()}`,
          trust: 'news',
          title: `Phantasmal Flames Booster Box restock expected ${day(10)}`,
        },
      ],
      now,
    );
    expect(rumor).toEqual([]); // rumored -> review queue, not published
    const { data: pending } = await db
      .from('calendar_review_pending')
      .select('id, status, published')
      .eq('product_id', '11111111-1111-4111-8111-111111111105');
    expect(pending?.[0]).toMatchObject({ status: 'rumored', published: false });

    const changes = await ingest(
      db,
      [
        {
          source: 'walmart-news',
          externalId: `pfl-off-${now.getTime()}`,
          trust: 'official',
          title: 'Phantasmal Flames Booster Box restock',
          text: `Restock on ${day(11)}`,
        },
      ],
      now,
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(['confirmed', 'created', 'date_moved']);
    const sentCount = await notifyChanges(db, notifier, changes, now);
    expect(sentCount).toBeGreaterThanOrEqual(1);
    const { data: ev } = await db
      .from('calendar_events')
      .select('status, published, source_refs')
      .eq('id', changes[0]!.event.id)
      .single();
    expect(ev).toMatchObject({ status: 'confirmed', published: true });
    expect((ev!.source_refs as unknown[]).length).toBe(2);
    expect(
      sent.some((m) => m.to === 'ExponentPushToken[cal]' && m.title === 'Drop date changed'),
    ).toBe(true);

    // Re-ingesting the same official item is a no-op (content hash).
    expect(
      await ingest(
        db,
        [
          {
            source: 'walmart-news',
            externalId: `pfl-off-${now.getTime()}`,
            trust: 'official',
            title: 'Phantasmal Flames Booster Box restock',
            text: `Restock on ${day(11)}`,
          },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it('sends a follower reminder at their chosen lead time, once', async () => {
    const startsAt = new Date(now.getTime() + 15 * 60_000 - 20_000).toISOString();
    const { data: ev } = await db
      .from('calendar_events')
      .insert({
        title: 'Test PC drop',
        event_type: 'pc_drop',
        retailer_id: 'pokemoncenter',
        starts_at: startsAt,
        status: 'confirmed',
        published: true,
      })
      .select('id')
      .single();
    await db
      .from('calendar_follows')
      .insert({ user_id: user, event_id: ev!.id, remind_minutes_before: 15 });
    const notifier = new Notifier(db, push);
    const before = sent.length;
    await runCalendarClock(db, notifier, now);
    await runCalendarClock(db, notifier, now);
    const reminders = sent.slice(before).filter((m) => m.title === 'Starting in 15 min');
    expect(reminders).toHaveLength(1);
  });

  it('turns a newsletter link into a lead and makes the SKU due for a verifying poll', async () => {
    await db
      .from('retailer_skus')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('retailer_sku', '90000001');
    const lead = parseInboundEmail({
      from: 'Target <deals@target.com>',
      subject: 'Back in stock',
      html: '<a href="https://www.target.com/p/sample/-/A-90000001">Shop</a>',
    });
    const r = await handleLead(db, 'email', lead, 'Back in stock');
    expect(r.matched).toBe(1);
    const { data } = await db
      .from('retailer_skus')
      .select('last_checked_at')
      .eq('retailer_sku', '90000001')
      .single();
    expect(data!.last_checked_at).toBeNull();
    const { data: leads } = await db
      .from('restock_leads')
      .select('kind, source')
      .eq('url', 'https://www.target.com/p/sample/-/A-90000001');
    expect(leads?.[0]).toMatchObject({ kind: 'restock', source: 'email' });
  });
});
