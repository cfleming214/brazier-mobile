import type { SupabaseClient } from '@supabase/supabase-js';
import { easternMidnight } from './extract';
import type { SourceItem } from './pipeline';

export interface StockEventLite {
  new_state: string;
  observed_at: string;
}

export interface RestockStats {
  restocks_30d: number;
  restocks_90d: number;
  median_in_stock_min: number | null;
  typical_dow: number | null;
  typical_hour: number | null;
  pattern_share: number | null;
  last_restock_at: string | null;
}

function eastern(d: Date): { dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts.find((p) => p.type === 'weekday')!.value,
  );
  return { dow, hour: Number(parts.find((p) => p.type === 'hour')!.value) };
}

/** Descriptive restock stats from a SKU's (unsuppressed) stock events, oldest first (BUILD_PLAN 5.4). */
export function computeStats(events: StockEventLite[], now: Date): RestockStats {
  const sorted = [...events].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const restocks = sorted.filter((e) => e.new_state === 'IN_STOCK');
  const durations: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.new_state !== 'IN_STOCK') continue;
    const end = sorted.slice(i + 1).find((e) => e.new_state !== 'IN_STOCK');
    if (end)
      durations.push((Date.parse(end.observed_at) - Date.parse(sorted[i]!.observed_at)) / 60_000);
  }
  durations.sort((a, b) => a - b);
  const in30 = restocks.filter(
    (e) => now.getTime() - Date.parse(e.observed_at) <= 30 * 86_400_000,
  ).length;
  const in90 = restocks.filter((e) => now.getTime() - Date.parse(e.observed_at) <= 90 * 86_400_000);

  let typical: { dow: number; hour: number; share: number } | null = null;
  if (in90.length) {
    const counts = new Map<string, number>();
    for (const e of in90) {
      const { dow, hour } = eastern(new Date(e.observed_at));
      counts.set(`${dow}:${hour}`, (counts.get(`${dow}:${hour}`) ?? 0) + 1);
    }
    const [key, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    const [dow, hour] = key.split(':').map(Number);
    typical = { dow: dow!, hour: hour!, share: Math.round((n / in90.length) * 100) / 100 };
  }

  return {
    restocks_30d: in30,
    restocks_90d: in90.length,
    median_in_stock_min: durations.length
      ? Math.round(durations[Math.floor(durations.length / 2)]!)
      : null,
    typical_dow: typical?.dow ?? null,
    typical_hour: typical?.hour ?? null,
    pattern_share: typical?.share ?? null,
    last_restock_at: restocks.at(-1)?.observed_at ?? null,
  };
}

/** Next date (Eastern) with the given weekday, strictly after `now`'s date. */
export function nextWeekday(dow: number, now: Date): string {
  const today = eastern(now).dow;
  const add = (dow - today + 7) % 7 || 7;
  return new Date(now.getTime() + add * 86_400_000).toISOString().slice(0, 10);
}

/** A recurring window worth publishing as an estimate: at least 3 restocks, 60%+ in one weekday/hour slot. */
export function estimateWindow(s: RestockStats): boolean {
  return (
    s.restocks_90d >= 3 &&
    (s.pattern_share ?? 0) >= 0.6 &&
    s.typical_dow != null &&
    s.typical_hour != null
  );
}

/** Nightly: recompute restock_stats for every SKU with history, and emit estimate windows as calendar items. */
export async function runRestockStats(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ skus: number; estimates: SourceItem[] }> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { data: events } = await db
    .from('stock_events')
    .select(
      'retailer_sku_id, new_state, observed_at, retailer_skus(retailer_id, product_id, products(name))',
    )
    .is('suppressed_reason', null)
    .gte('observed_at', since)
    .order('observed_at');
  const bySku = new Map<
    string,
    { events: StockEventLite[]; retailer: string; productId: string; productName: string }
  >();
  for (const e of (events ?? []) as unknown as {
    retailer_sku_id: string;
    new_state: string;
    observed_at: string;
    retailer_skus: { retailer_id: string; product_id: string; products: { name: string } };
  }[]) {
    const entry = bySku.get(e.retailer_sku_id) ?? {
      events: [],
      retailer: e.retailer_skus.retailer_id,
      productId: e.retailer_skus.product_id,
      productName: e.retailer_skus.products.name,
    };
    entry.events.push(e);
    bySku.set(e.retailer_sku_id, entry);
  }
  const estimates: SourceItem[] = [];
  for (const [skuId, v] of bySku) {
    const s = computeStats(v.events, now);
    await db
      .from('restock_stats')
      .upsert(
        { retailer_sku_id: skuId, ...s, updated_at: now.toISOString() },
        { onConflict: 'retailer_sku_id' },
      );
    if (estimateWindow(s)) {
      const date = nextWeekday(s.typical_dow!, now);
      estimates.push({
        source: 'brazier-history',
        externalId: `history:${skuId}:${date}`,
        trust: 'history',
        title: `Likely restock: ${v.productName}`,
        startsAt: easternMidnight(date, s.typical_hour!),
        eventType: 'restock_window',
        retailerId: v.retailer as SourceItem['retailerId'],
        productId: v.productId,
      });
    }
  }
  return { skus: bySku.size, estimates };
}
