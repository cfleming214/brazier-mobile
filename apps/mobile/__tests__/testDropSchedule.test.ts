import { LISTINGS, PRODUCTS, RETAILERS } from '@/lib/testMode/dataset';
import { buildDropSchedule, DROP_WEEKDAY, nextWeekday } from '@/lib/testMode/schedule';

const upcoming = PRODUCTS.filter((p) => p.is_upcoming);
// Monday 2026-11-02 and a Sunday, to cover the wrap-around.
const MONDAY = new Date('2026-11-02T18:00:00Z');
const SUNDAY = new Date('2026-11-08T03:00:00Z');

describe('upcoming products', () => {
  it('has three, each on preorder wherever it is listed', () => {
    expect(upcoming).toHaveLength(3);
    for (const p of upcoming) {
      const listings = LISTINGS.filter((l) => l.product_id === p.id);
      expect(listings.length).toBeGreaterThan(0);
      for (const l of listings) expect(l.last_state).toBe('PREORDER');
    }
  });
});

describe('nextWeekday', () => {
  it('returns the next matching day, 1 to 7 days ahead, at 15:00 UTC', () => {
    expect(nextWeekday(MONDAY, 1).toISOString()).toBe('2026-11-09T15:00:00.000Z'); // a week, not today
    expect(nextWeekday(MONDAY, 2).toISOString()).toBe('2026-11-03T15:00:00.000Z');
    expect(nextWeekday(SUNDAY, 1).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });
});

describe.each([
  ['a Monday', MONDAY],
  ['a Sunday', SUNDAY],
])('drop schedule from %s', (_label, now) => {
  const events = buildDropSchedule(now);

  it('gives every retailer its own weekday and its own date', () => {
    expect(new Set(Object.values(DROP_WEEKDAY)).size).toBe(RETAILERS.length);
    const dayByRetailer = new Map<string, string>();
    for (const e of events) {
      const day = e.starts_at.slice(0, 10);
      expect(new Date(e.starts_at).getUTCDay()).toBe(DROP_WEEKDAY[e.retailer_id]);
      expect(dayByRetailer.get(e.retailer_id) ?? day).toBe(day);
      dayByRetailer.set(e.retailer_id, day);
    }
    expect([...dayByRetailer.keys()].sort()).toEqual(RETAILERS.map((r) => r.id).sort());
    expect(new Set(dayByRetailer.values()).size).toBe(RETAILERS.length);
  });

  it('only schedules upcoming products, at retailers that list them, within the next week', () => {
    for (const e of events) {
      expect(upcoming.map((p) => p.id)).toContain(e.product_id);
      expect(LISTINGS.some((l) => l.product_id === e.product_id && l.retailer_id === e.retailer_id)).toBe(true);
      const days = (Date.parse(e.starts_at) - now.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(7.7);
    }
    // Every upcoming product drops somewhere.
    expect(new Set(events.map((e) => e.product_id)).size).toBe(3);
  });

  it('uses pc_drop for Pokémon Center and stable ids', () => {
    for (const e of events) {
      expect(e.event_type).toBe(e.retailer_id === 'pokemoncenter' ? 'pc_drop' : 'retailer_street_date');
    }
    expect(buildDropSchedule(new Date(now.getTime() + 86_400_000)).map((e) => e.id)).toEqual(
      events.map((e) => e.id),
    );
  });
});
