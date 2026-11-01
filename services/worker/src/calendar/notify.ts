import type { SupabaseClient } from '@supabase/supabase-js';
import type { Notifier } from '../notifier';
import type { CalendarChange, CalendarEventRow } from './pipeline';

const retailerName: Record<string, string> = {
  bestbuy: 'Best Buy',
  walmart: 'Walmart',
  target: 'Target',
  gamestop: 'GameStop',
  pokemoncenter: 'Pokémon Center',
  amazon: 'Amazon',
};

/** "Thu, Nov 6 · 3:00 AM ET" */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${day} · ${time} ET`;
}

/** Notification text for a calendar change (DROP-86). */
export function describeChange(c: CalendarChange): { title: string; body: string } {
  const e = c.event;
  const where = e.retailer_id ? ` at ${retailerName[e.retailer_id] ?? e.retailer_id}` : '';
  switch (c.kind) {
    case 'created':
      return e.is_estimate
        ? {
            title: 'Likely restock window',
            body: `${e.title}${where} · ${formatWhen(e.starts_at)} (estimate from past restocks)`,
          }
        : {
            title: e.status === 'confirmed' ? 'New drop confirmed' : 'New drop announced',
            body: `${e.title}${where} · ${formatWhen(e.starts_at)}`,
          };
    case 'date_moved':
      return {
        title: 'Drop date changed',
        body: `${e.title} moved from ${formatWhen(c.previousStartsAt!)} to ${formatWhen(e.starts_at)}`,
      };
    case 'confirmed':
      return {
        title: 'Drop confirmed',
        body: `${e.title}${where} is confirmed for ${formatWhen(e.starts_at)}`,
      };
    case 'cancelled':
      return { title: 'Drop cancelled', body: `${e.title}${where} was cancelled.` };
  }
}

/** Users who follow the event or watch its product (or any product in its set, for set releases). */
export async function recipientsFor(
  db: SupabaseClient,
  e: Pick<CalendarEventRow, 'id' | 'product_id' | 'set_name' | 'event_type'>,
): Promise<string[]> {
  const users = new Set<string>();
  const { data: follows } = await db
    .from('calendar_follows')
    .select('user_id')
    .eq('event_id', e.id);
  for (const f of follows ?? []) users.add(f.user_id);
  let productIds: string[] = e.product_id ? [e.product_id] : [];
  if (!e.product_id && e.set_name) {
    const { data: ps } = await db.from('products').select('id').eq('set_name', e.set_name);
    productIds = (ps ?? []).map((p) => p.id);
  }
  if (productIds.length) {
    const { data: watches } = await db
      .from('watches')
      .select('user_id')
      .in('product_id', productIds)
      .eq('paused', false);
    for (const w of watches ?? []) users.add(w.user_id);
  }
  return [...users];
}

export async function notifyChanges(
  db: SupabaseClient,
  notifier: Notifier,
  changes: CalendarChange[],
  now = new Date(),
) {
  let sent = 0;
  for (const c of changes) {
    const text = describeChange(c);
    const soon = Date.parse(c.event.starts_at) - now.getTime() < 60 * 60_000;
    for (const userId of await recipientsFor(db, c.event)) {
      const r = await notifier.notify({
        userId,
        category: 'drop_updates',
        ...text,
        data: {
          type: 'calendar',
          eventId: c.event.id,
          productId: c.event.product_id,
          change: c.kind,
        },
        timeSensitive: c.event.event_type === 'preorder_open' && soon && c.kind !== 'cancelled',
        dedupeKey: `cal:${c.event.id}:${c.kind}:${c.event.starts_at}`,
      });
      if (r.notificationId) sent++;
    }
  }
  return sent;
}

/**
 * Time-based calendar notifications, run every minute:
 *  - reminders for followers at their chosen lead time (category: reminders)
 *  - "starts in 10 minutes" (T-10) and "live now" for preorder windows to followers and watchers
 */
export async function runCalendarClock(db: SupabaseClient, notifier: Notifier, now = new Date()) {
  const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const { data: events } = await db
    .from('calendar_events')
    .select('id, title, event_type, retailer_id, product_id, set_name, starts_at, status')
    .eq('published', true)
    .neq('status', 'cancelled')
    .gte('starts_at', new Date(now.getTime() - 5 * 60_000).toISOString())
    .lte('starts_at', horizon);
  let sent = 0;
  for (const e of events ?? []) {
    const mins = (Date.parse(e.starts_at) - now.getTime()) / 60_000;
    const where = e.retailer_id ? ` at ${retailerName[e.retailer_id] ?? e.retailer_id}` : '';

    const { data: follows } = await db
      .from('calendar_follows')
      .select('user_id, remind_minutes_before')
      .eq('event_id', e.id);
    for (const f of follows ?? []) {
      if (
        mins <= f.remind_minutes_before &&
        mins > f.remind_minutes_before - 1.5 &&
        f.remind_minutes_before > 0
      ) {
        const r = await notifier.notify({
          userId: f.user_id,
          category: 'reminders',
          title: `Starting in ${f.remind_minutes_before >= 60 ? `${Math.round(f.remind_minutes_before / 60)}h` : `${f.remind_minutes_before} min`}`,
          body: `${e.title}${where} · ${formatWhen(e.starts_at)}`,
          data: { type: 'calendar', eventId: e.id, productId: e.product_id },
          timeSensitive: f.remind_minutes_before <= 15,
          dedupeKey: `remind:${e.id}:${f.remind_minutes_before}:${e.starts_at}`,
        });
        if (r.notificationId) sent++;
      }
    }

    if (
      e.event_type !== 'preorder_open' &&
      e.event_type !== 'pc_drop' &&
      e.event_type !== 'restock_window'
    )
      continue;
    const phase = mins <= 10 && mins > 8.5 ? 'soon' : mins <= 0 && mins > -1.5 ? 'live' : null;
    if (!phase) continue;
    for (const userId of await recipientsFor(db, e as CalendarEventRow)) {
      const r = await notifier.notify({
        userId,
        category: 'drop_updates',
        title: phase === 'soon' ? 'Drop window in 10 minutes' : 'Drop window is live',
        body: `${e.title}${where}${phase === 'live' ? ' · Tap to open' : ''}`,
        data: { type: 'calendar', eventId: e.id, productId: e.product_id },
        timeSensitive: true,
        dedupeKey: `window:${e.id}:${phase}:${e.starts_at}`,
      });
      if (r.notificationId) sent++;
    }
  }
  return sent;
}

/** Daily digest for users who chose it: one push summarizing held drop updates. */
export async function sendDigests(db: SupabaseClient, notifier: Notifier, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const { data: held } = await db
    .from('notifications')
    .select('user_id, title')
    .eq('push_status', 'held_digest')
    .gte('created_at', since);
  const byUser = new Map<string, string[]>();
  for (const h of held ?? []) byUser.set(h.user_id, [...(byUser.get(h.user_id) ?? []), h.title]);
  const day = now.toISOString().slice(0, 10);
  for (const [userId, titles] of byUser) {
    await notifier.notify({
      userId,
      category: 'drop_updates',
      title: `${titles.length} drop update${titles.length === 1 ? '' : 's'} today`,
      body: [...new Set(titles)].slice(0, 3).join(' · '),
      data: { type: 'digest' },
      timeSensitive: true, // the digest itself is delivered even though it's in the drop updates category
      dedupeKey: `digest:${day}`,
    });
  }
  return byUser.size;
}
