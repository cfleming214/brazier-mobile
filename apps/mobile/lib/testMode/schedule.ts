/**
 * Test-data drop schedule for upcoming products.
 *
 * Each retailer drops on its own day of the week, so no two retailers share a day. On that day it
 * drops every upcoming product it lists. Dates are always the next occurrence of each weekday
 * (1–7 days out), recomputed whenever the database opens, so the schedule never goes stale.
 * Event ids are stable, so reminders on them survive a refresh.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { LISTINGS, PRODUCTS, RETAILERS, type TestRetailerId } from './dataset';

/** 0 = Sunday … 6 = Saturday. Must all differ. */
export const DROP_WEEKDAY: Record<TestRetailerId, number> = {
  bestbuy: 1, // Monday
  walmart: 2, // Tuesday
  amazon: 3, // Wednesday
  pokemoncenter: 4, // Thursday
};

/** Drops start at 15:00 UTC: 10 AM Eastern in winter, 11 AM during daylight saving. */
const DROP_HOUR_UTC = 15;

export type DropEvent = {
  id: string;
  product_id: string;
  set_name: string | null;
  title: string;
  event_type: 'retailer_street_date' | 'pc_drop';
  retailer_id: TestRetailerId;
  starts_at: string;
};

/** The next date after `now`'s UTC day that falls on `weekday`, at the drop hour. */
export function nextWeekday(now: Date, weekday: number): Date {
  const ahead = ((weekday - now.getUTCDay() + 7) % 7) || 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ahead, DROP_HOUR_UTC),
  );
}

const eventId = (retailerIndex: number, productIndex: number) =>
  `44444444-4444-4444-8444-${String((retailerIndex + 1) * 100 + productIndex + 1).padStart(12, '0')}`;

export function buildDropSchedule(now: Date): DropEvent[] {
  const upcoming = PRODUCTS.filter((p) => p.is_upcoming);
  return RETAILERS.flatMap((r, ri) => {
    const startsAt = nextWeekday(now, DROP_WEEKDAY[r.id]).toISOString();
    return upcoming.flatMap((p) => {
      const listed = LISTINGS.some((l) => l.product_id === p.id && l.retailer_id === r.id);
      if (!listed) return [];
      return [
        {
          id: eventId(ri, PRODUCTS.indexOf(p)),
          product_id: p.id,
          set_name: p.set_name,
          title: `${r.name} drop: ${p.name.replace(/^Pokémon TCG: /, '')}`,
          event_type: r.id === 'pokemoncenter' ? 'pc_drop' : 'retailer_street_date',
          retailer_id: r.id,
          starts_at: startsAt,
        } satisfies DropEvent,
      ];
    });
  });
}

/** Write the schedule for `now`, keeping event ids (and any reminders on them) stable. */
export async function refreshDropSchedule(db: SQLiteDatabase, now = new Date()) {
  const events = buildDropSchedule(now);
  const sourceRefs = JSON.stringify([{ source: 'test-data', url: null, trust: 'test' }]);
  for (const e of events) {
    await db.runAsync(
      `insert into calendar_events (id, product_id, set_name, title, event_type, retailer_id,
         starts_at, status, confidence, source_refs, published)
       values (?, ?, ?, ?, ?, ?, ?, 'confirmed', 0.9, ?, 1)
       on conflict (id) do update set starts_at = excluded.starts_at, title = excluded.title,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [e.id, e.product_id, e.set_name, e.title, e.event_type, e.retailer_id, e.starts_at, sourceRefs],
    );
  }
  // Drop events for products that are no longer upcoming or listed.
  const keep = events.map((e) => e.id);
  await db.runAsync(
    `delete from calendar_events where id like '44444444-%' and id not in (${keep.map(() => '?').join(',') || "''"})`,
    keep,
  );
}
