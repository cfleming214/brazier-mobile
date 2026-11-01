import type {
  AvailabilityResult,
  RetailerAdapter,
  RetailerSlug,
  StockState,
} from '@drophawk/shared';
import { formatCents } from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BlockedError } from './adapters/protections';
import { decide, DEFAULT_DETECTOR, type DetectorOptions } from './detector';
import type { RetailerGovernor } from './governor';
import { Metrics } from './metrics';
import type { Notifier } from './notifier';
import { describeProtection, ProtectionTracker, type ProtectionChange } from './protection';
import { matchWatch, type WatchRule } from './rules';
import { computeTier, TIER_INTERVAL_S, type PollTier } from './tiers';

export interface WatchedSku {
  id: string;
  product_id: string;
  retailer_id: RetailerSlug;
  retailer_sku: string;
  url: string | null;
  last_state: StockState;
  last_price_cents: number | null;
  confirmations: number;
  last_in_stock_at: string | null;
  last_out_of_stock_at: string | null;
  last_checked_at: string | null;
  poll_tier: PollTier;
  watchers: number;
  pro_watchers: number;
  next_window_at: string | null;
}

/** Retailers whose adapter fetches one page per SKU (one rate token each). */
const PER_SKU: RetailerSlug[] = ['target', 'gamestop', 'pokemoncenter'];
const BATCH = 20;

const retailerName: Record<string, string> = {
  bestbuy: 'Best Buy',
  walmart: 'Walmart',
  target: 'Target',
  gamestop: 'GameStop',
  pokemoncenter: 'Pokémon Center',
  amazon: 'Amazon',
};

export interface PollerDeps {
  db: SupabaseClient;
  adapters: Map<RetailerSlug, RetailerAdapter>;
  governors: Map<RetailerSlug, RetailerGovernor>;
  notifier: Notifier;
  metrics?: Metrics;
  protections?: ProtectionTracker;
  now?: () => number;
  detector?: DetectorOptions;
  /** Delay before the confirming second read (ms). */
  confirmDelayMs?: number;
}

/**
 * One worker loop: find due SKUs, fetch availability within each retailer's budget, run the detector,
 * write stock events and activity, and alert matching watchers.
 */
export class Poller {
  readonly metrics: Metrics;
  readonly protections: ProtectionTracker;
  private firstSeen = new Map<string, number>();
  private health = new Map<
    RetailerSlug,
    { status: string; error: string | null; backoffUntil: string | null }
  >();
  private now: () => number;

  constructor(private d: PollerDeps) {
    this.now = d.now ?? Date.now;
    this.metrics = d.metrics ?? new Metrics(this.now);
    this.protections = d.protections ?? new ProtectionTracker(d.db, undefined, this.now);
  }

  private async watched(): Promise<WatchedSku[]> {
    const { data, error } = await this.d.db.rpc('watched_skus');
    if (error) throw error;
    return (data ?? []) as WatchedSku[];
  }

  /** Recompute poll tiers and persist any changes. */
  async updateTiers(skus: WatchedSku[]) {
    const perRetailer = new Map<string, number>();
    for (const s of skus) perRetailer.set(s.retailer_id, (perRetailer.get(s.retailer_id) ?? 0) + 1);
    for (const s of skus) {
      const gov = this.d.governors.get(s.retailer_id);
      if (!gov) continue;
      const tier = computeTier({
        watchers: s.watchers,
        proWatchers: s.pro_watchers,
        secondsToWindow: s.next_window_at
          ? (Date.parse(s.next_window_at) - this.now()) / 1000
          : null,
        policy: gov.policy,
        skusAtRetailer: perRetailer.get(s.retailer_id) ?? 1,
      });
      if (tier && tier !== s.poll_tier) {
        s.poll_tier = tier;
        await this.d.db.from('retailer_skus').update({ poll_tier: tier }).eq('id', s.id);
      }
    }
  }

  isDue(s: WatchedSku): boolean {
    if (!s.last_checked_at) return true;
    const age = this.now() - Date.parse(s.last_checked_at);
    if (s.confirmations > 0) return age >= (this.d.confirmDelayMs ?? 1000);
    return age >= TIER_INTERVAL_S[s.poll_tier] * 1000;
  }

  /** Run one loop. Returns how many SKUs were checked. */
  async tick(): Promise<number> {
    const skus = await this.watched();
    await this.updateTiers(skus);
    const due = skus.filter((s) => this.isDue(s));
    const byRetailer = new Map<RetailerSlug, WatchedSku[]>();
    for (const s of due)
      byRetailer.set(s.retailer_id, [...(byRetailer.get(s.retailer_id) ?? []), s]);

    let checked = 0;
    await Promise.all(
      [...byRetailer].map(async ([retailer, list]) => {
        const adapter = this.d.adapters.get(retailer);
        const gov = this.d.governors.get(retailer);
        if (!adapter || !gov) return;
        if (!gov.policy.enabled) return this.setHealth(retailer, 'disabled', null);
        const size = PER_SKU.includes(retailer) ? 1 : BATCH;
        for (let i = 0; i < list.length; i += size) {
          const chunk = list.slice(i, i + size);
          if (!gov.acquire()) break; // over budget or backing off: try again next tick
          const started = this.now();
          try {
            const results = await adapter.fetchAvailability(
              chunk.map((s) => ({ retailer, sku: s.retailer_sku, url: s.url ?? undefined })),
            );
            gov.breaker.success();
            this.metrics.recordCheck(retailer, true, this.now() - started, chunk.length);
            this.setHealth(retailer, 'ok', null);
            for (const r of results) {
              const sku = chunk.find((s) => s.retailer_sku === r.ref.sku);
              if (sku) await this.handle(sku, r);
            }
            checked += chunk.length;
          } catch (e) {
            const blocked = e instanceof BlockedError;
            gov.breaker.failure(blocked);
            this.metrics.recordCheck(retailer, false, this.now() - started, chunk.length);
            this.setHealth(
              retailer,
              blocked ? 'backoff' : 'degraded',
              e instanceof Error ? e.message : String(e),
              gov.breaker.state === 'open' ? new Date(gov.breaker.openUntil).toISOString() : null,
            );
            if (blocked) {
              for (const s of chunk)
                await this.applyProtections(s, (e as BlockedError).protections);
            }
            break;
          }
        }
      }),
    );
    return checked;
  }

  private setHealth(
    r: RetailerSlug,
    status: string,
    error: string | null,
    backoffUntil: string | null = null,
  ) {
    this.health.set(r, { status, error, backoffUntil });
  }

  /** Persist adapter health and system metrics (called every few seconds by main). */
  async flushTelemetry() {
    const rows = [...this.health].map(([retailer, h]) => {
      const m = this.metrics.retailer(retailer);
      return {
        retailer_id: retailer,
        status: h.status,
        last_error: h.error,
        backoff_until: h.backoffUntil,
        latency_ms: m?.latencyMs ?? null,
        success_rate: m?.successRate ?? null,
        checks_per_min: m?.checksPerMin ?? 0,
        active_protections: this.protections.activeFor(retailer),
        updated_at: new Date(this.now()).toISOString(),
      };
    });
    if (rows.length)
      await this.d.db.from('adapter_health').upsert(rows, { onConflict: 'retailer_id' });
    await this.d.db.from('system_metrics').upsert({
      key: 'poller',
      value: { ...this.metrics.snapshot(), online: true },
      updated_at: new Date(this.now()).toISOString(),
    });
  }

  private async watchersOf(sku: WatchedSku): Promise<(WatchRule & { product_name: string })[]> {
    const { data, error } = await this.d.db
      .from('watches')
      .select(
        'id, user_id, paused, alerts_enabled, retailer_ids, max_price_cents, include_marketplace, pickup_radius_km, products(name)',
      )
      .eq('product_id', sku.product_id)
      .contains('retailer_ids', [sku.retailer_id]);
    if (error) throw error;
    return (data ?? []).map((w) => ({
      watch_id: w.id,
      user_id: w.user_id,
      paused: w.paused,
      alerts_enabled: w.alerts_enabled,
      retailer_ids: w.retailer_ids,
      max_price_cents: w.max_price_cents,
      include_marketplace: w.include_marketplace,
      pickup_radius_km: w.pickup_radius_km,
      product_name: (w.products as unknown as { name: string } | null)?.name ?? 'This product',
    }));
  }

  private async activity(users: string[], sku: WatchedSku, kind: string, message: string) {
    if (!users.length) return;
    await this.d.db.from('activity_events').insert(
      [...new Set(users)].map((u) => ({
        user_id: u,
        retailer_id: sku.retailer_id,
        product_id: sku.product_id,
        kind,
        message,
      })),
    );
  }

  private async applyProtections(sku: WatchedSku, seen: string[]) {
    const changes = await this.protections.observe(sku.retailer_id, sku.id, seen);
    if (changes.length) await this.notifyProtections(sku, changes);
  }

  private async notifyProtections(sku: WatchedSku, changes: ProtectionChange[]) {
    const watchers = (await this.watchersOf(sku)).filter((w) => !w.paused);
    const soon =
      sku.next_window_at != null && Date.parse(sku.next_window_at) - this.now() < 30 * 60_000;
    for (const c of changes) {
      for (const w of watchers) {
        const text = describeProtection(c, w.product_name);
        await this.d.notifier.notify({
          userId: w.user_id,
          category: 'bot_status',
          ...text,
          data: {
            type: 'protection',
            watchId: w.watch_id,
            productId: sku.product_id,
            retailer: sku.retailer_id,
            protection: c.protection,
            active: c.active,
          },
          timeSensitive: c.active && soon,
          dedupeKey: `protection:${sku.id}:${c.protection}:${c.active}:${Math.floor(this.now() / 60_000)}`,
        });
      }
      await this.activity(
        watchers.map((w) => w.user_id),
        sku,
        'protection',
        `${retailerName[sku.retailer_id]} ${c.active ? 'ON' : 'OFF'} ${c.protection}`,
      );
    }
  }

  private async handle(sku: WatchedSku, r: AvailabilityResult) {
    const decision = decide(sku, r, this.d.detector ?? DEFAULT_DETECTOR);
    const { error: upErr } = await this.d.db
      .from('retailer_skus')
      .update(decision.update)
      .eq('id', sku.id);
    if (upErr) throw upErr;
    Object.assign(sku, decision.update);

    await this.applyProtections(sku, r.protections ?? []);

    if (decision.needsConfirmation) this.firstSeen.set(sku.id, Date.parse(r.observedAt));
    if (!decision.event) return;

    const { data: ev, error: evErr } = await this.d.db
      .from('stock_events')
      .insert({
        retailer_sku_id: sku.id,
        prev_state: decision.event.prev_state,
        new_state: decision.event.new_state,
        price_cents: decision.event.price_cents,
        source: 'poll',
        suppressed_reason: decision.event.suppressed_reason,
        observed_at: r.observedAt,
      })
      .select('id')
      .single();
    if (evErr) throw evErr;

    const watchers = await this.watchersOf(sku);
    const users = watchers.map((w) => w.user_id);
    const store = retailerName[sku.retailer_id] ?? sku.retailer_id;
    const price = formatCents(r.priceCents);

    if (decision.event.suppressed_reason) {
      await this.activity(
        users,
        sku,
        decision.event.suppressed_reason === 'flapping' ? 'flap' : 'suppressed',
        `${store} ${decision.event.suppressed_reason.toUpperCase()} ${price}`,
      );
      this.firstSeen.delete(sku.id);
      return;
    }
    if (!decision.alert) {
      await this.activity(
        users,
        sku,
        decision.event.new_state === 'IN_STOCK' ? 'in_stock' : 'out_of_stock',
        `${store} ${decision.event.new_state} ${price}`,
      );
      return;
    }

    await this.activity(users, sku, 'in_stock', `${store} ${r.state} ${price} confirmed 2/2`);
    const observed = this.firstSeen.get(sku.id) ?? Date.parse(r.observedAt);
    this.firstSeen.delete(sku.id);

    for (const w of watchers) {
      const m = matchWatch(w, r);
      if (!m.notify) {
        await this.activity(
          [w.user_id],
          sku,
          'suppressed',
          `${store} SUPPRESS ${m.reason} ${price}`,
        );
        continue;
      }
      const preorder = r.state === 'PREORDER';
      const res = await this.d.notifier.notify({
        userId: w.user_id,
        category: 'restock',
        title: `${preorder ? 'Preorder open' : 'In stock'}: ${w.product_name}`,
        body: `${store} · ${price}${r.pickupAvailable && !r.shipAvailable ? ' · pickup' : ''} · Tap to buy`,
        data: {
          type: 'restock',
          watchId: w.watch_id,
          productId: sku.product_id,
          retailer: sku.retailer_id,
          url: sku.url,
          stockEventId: ev.id,
        },
        timeSensitive: true,
        collapseKey: `restock:${w.watch_id}`,
        dedupeKey: `restock:${ev.id}:${w.watch_id}`,
        categoryId: 'restock',
      });
      await this.d.db
        .from('alerts')
        .insert({ watch_id: w.watch_id, user_id: w.user_id, stock_event_id: ev.id });
      if (res.pushed > 0) {
        this.metrics.recordLatency(this.now() - observed);
        await this.activity(
          [w.user_id],
          sku,
          'push',
          `PUSH ${res.pushed} device${res.pushed === 1 ? '' : 's'} ${this.now() - observed}ms`,
        );
      }
    }
  }
}
