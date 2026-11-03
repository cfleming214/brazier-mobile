import {
  CreateWatchInput,
  parseRetailerUrl,
  type ProductType,
  type RetailerSlug,
  type StockState,
} from '@brazier/shared';
import { supabase } from './supabase';
import { testCatalog } from './testMode/catalog';
import { currentDataSource } from './testMode/settings';

export interface ProductSearchResult {
  id: string;
  name: string;
  set_name: string | null;
  product_type: ProductType;
  msrp_cents: number | null;
  image_url: string | null;
  is_exclusive: boolean;
  retailer_ids: RetailerSlug[];
}

export interface RetailerState {
  retailer_id: RetailerSlug;
  retailer_sku: string;
  url: string | null;
  state: StockState;
  price_cents: number | null;
  last_checked_at: string | null;
  poll_tier: 'cold' | 'normal' | 'hot' | 'burst';
}

export type WatchStatus = 'live' | 'monitoring' | 'sold_out';

export interface WatchOverview {
  watch_id: string;
  user_id: string;
  paused: boolean;
  max_price_cents: number | null;
  include_marketplace: boolean;
  pickup_radius_km: number | null;
  retailer_ids: RetailerSlug[];
  created_at: string;
  product_id: string;
  product_name: string;
  set_name: string | null;
  product_type: ProductType;
  msrp_cents: number | null;
  image_url: string | null;
  retailers: RetailerState[];
  status: WatchStatus;
}

export interface CalendarEventRow {
  id: string;
  title: string;
  event_type: string;
  retailer_id: RetailerSlug | null;
  starts_at: string;
  timezone: string;
  status: 'rumored' | 'confirmed' | 'cancelled';
  product_id: string | null;
}

export interface StockEventRow {
  id: number;
  retailer_sku_id: string;
  prev_state: StockState;
  new_state: StockState;
  price_cents: number | null;
  observed_at: string;
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function searchProducts(q: string): Promise<ProductSearchResult[]> {
  if (q.trim().length < 2) return [];
  if ((await currentDataSource()) === 'test') return testCatalog.searchProducts(q);
  return check(await supabase.rpc('search_products', { q, max_results: 20 }));
}

export interface ProductDetail {
  id: string;
  name: string;
  set_name: string | null;
  product_type: ProductType;
  msrp_cents: number | null;
  image_url: string | null;
  is_exclusive: boolean;
  retailer_skus: {
    retailer_id: RetailerSlug;
    retailer_sku: string;
    url: string | null;
    last_state: StockState;
    last_price_cents: number | null;
  }[];
}

export async function getProduct(id: string): Promise<ProductDetail> {
  if ((await currentDataSource()) === 'test') return testCatalog.getProduct(id);
  return check<ProductDetail>(
    (await supabase
      .from('products')
      .select(
        'id, name, set_name, product_type, msrp_cents, image_url, is_exclusive, retailer_skus(retailer_id, retailer_sku, url, last_state, last_price_cents)',
      )
      .eq('id', id)
      .single()) as unknown as { data: ProductDetail | null; error: { message: string } | null },
  );
}

export type ResolveResult =
  | { kind: 'found'; productId: string; retailer?: RetailerSlug }
  | { kind: 'submitted'; message: string }
  | { kind: 'error'; message: string };

/** Turn a pasted link into a catalog product, or send it to the review queue. */
export async function resolveUrl(text: string): Promise<ResolveResult> {
  const parsed = parseRetailerUrl(text);
  if (!parsed.ok) {
    const messages = {
      invalid: "That doesn't look like a product link.",
      unsupported_retailer:
        'That store isn’t supported yet. Try Best Buy, Target, Walmart, GameStop, Pokémon Center or Amazon.',
      no_product_id: 'That link isn’t a product page. Open the product and copy its link.',
    } as const;
    return { kind: 'error', message: messages[parsed.reason] };
  }
  const { retailer, sku, url } = parsed.ref;
  if ((await currentDataSource()) === 'test') {
    const id = await testCatalog.findProductByRetailerSku(retailer, sku);
    return id
      ? { kind: 'found', productId: id, retailer }
      : { kind: 'error', message: 'That product isn’t in the test dataset.' };
  }
  const productId = check(
    await supabase.rpc('find_product_by_retailer_sku', { p_retailer: retailer, p_sku: sku }),
  ) as string | null;
  if (productId) return { kind: 'found', productId, retailer };
  check(
    await supabase.rpc('submit_unknown_item', {
      p_kind: 'url',
      p_retailer: retailer,
      p_sku: sku,
      p_url: url ?? null,
    }),
  );
  return {
    kind: 'submitted',
    message:
      'We don’t have that product yet. We’ve sent it for review and it usually appears within 24 hours.',
  };
}

/** Look up a scanned barcode, or send it to the review queue. */
export async function resolveUpc(code: string): Promise<ResolveResult> {
  if ((await currentDataSource()) === 'test') {
    const id = await testCatalog.findProductByUpc(code);
    return id
      ? { kind: 'found', productId: id }
      : { kind: 'error', message: 'That barcode isn’t in the test dataset.' };
  }
  const productId = check(await supabase.rpc('find_product_by_upc', { p_upc: code })) as
    string | null;
  if (productId) return { kind: 'found', productId };
  check(await supabase.rpc('submit_unknown_item', { p_kind: 'upc', p_upc: code }));
  return {
    kind: 'submitted',
    message:
      'We don’t recognise that barcode yet. We’ve sent it for review. Try searching or pasting a link instead.',
  };
}

export async function listWatches(): Promise<WatchOverview[]> {
  return check(
    await supabase.from('watch_overview').select('*').order('created_at', { ascending: false }),
  );
}

export async function getWatch(id: string): Promise<WatchOverview> {
  return check(await supabase.from('watch_overview').select('*').eq('watch_id', id).single());
}

export async function createWatch(input: CreateWatchInput): Promise<{ id: string }> {
  const parsed = CreateWatchInput.parse(input);
  return check(
    await supabase
      .from('watches')
      .insert({
        product_id: parsed.productId,
        retailer_ids: parsed.retailerIds,
        max_price_cents: parsed.maxPriceCents,
        include_marketplace: parsed.includeMarketplace,
        pickup_radius_km: parsed.pickupRadiusKm,
      })
      .select('id')
      .single(),
  );
}

export async function updateWatch(
  id: string,
  patch: Partial<{
    paused: boolean;
    retailer_ids: string[];
    max_price_cents: number | null;
    include_marketplace: boolean;
    pickup_radius_km: number | null;
  }>,
) {
  check(await supabase.from('watches').update(patch).eq('id', id).select('id').single());
}

export async function deleteWatch(id: string) {
  check(await supabase.from('watches').delete().eq('id', id));
}

export async function nextCalendarEvent(): Promise<CalendarEventRow | null> {
  if ((await currentDataSource()) === 'test') return testCatalog.nextCalendarEvent();
  const rows = check(
    await supabase
      .from('calendar_events')
      .select('id, title, event_type, retailer_id, starts_at, timezone, status, product_id')
      .gte('starts_at', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('starts_at')
      .limit(1),
  ) as CalendarEventRow[];
  return rows[0] ?? null;
}

/** Stock events for a product's retailer SKUs over the last N days (sparkline + history). */
export async function productStockEvents(
  productId: string,
  days = 14,
): Promise<(StockEventRow & { retailer_id: RetailerSlug })[]> {
  if ((await currentDataSource()) === 'test') return testCatalog.productStockEvents(productId);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = check(
    await supabase
      .from('stock_events')
      .select(
        'id, retailer_sku_id, prev_state, new_state, price_cents, observed_at, retailer_skus!inner(retailer_id, product_id)',
      )
      .eq('retailer_skus.product_id', productId)
      .is('suppressed_reason', null)
      .gte('observed_at', since)
      .order('observed_at'),
  ) as unknown as (StockEventRow & { retailer_skus: { retailer_id: RetailerSlug } })[];
  return rows.map((r) => ({ ...r, retailer_id: r.retailer_skus.retailer_id }));
}

// ---------------------------------------------------------------------------
// Account, plans and hit rate (Phase 4)
// ---------------------------------------------------------------------------

export type Plan = 'free' | 'pro' | 'pro_squad';
export const FREE_WATCH_LIMIT = 3;

export interface MyProfile {
  id: string;
  plan: Plan;
  plan_expires_at: string | null;
}

export interface HitRateStats {
  alerts_received: number;
  carts_opened: number;
  avg_response_seconds: number | null;
}

/** True when an insert/update was rejected by the free-tier watch limit trigger. */
export function isFreeLimitError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('FREE_LIMIT');
}

export async function getMyProfile(): Promise<MyProfile | null> {
  const rows = check(
    await supabase.from('profiles').select('id, plan, plan_expires_at').limit(1),
  ) as MyProfile[];
  return rows[0] ?? null;
}

export async function getHitRate(): Promise<HitRateStats> {
  const rows = check(
    await supabase
      .from('hit_rate_stats')
      .select('alerts_received, carts_opened, avg_response_seconds')
      .limit(1),
  ) as HitRateStats[];
  return rows[0] ?? { alerts_received: 0, carts_opened: 0, avg_response_seconds: null };
}

/** Records that the user opened a retailer from the Checkout Sheet (feeds hit-rate stats). */
export async function markCartOpened(watchId: string) {
  check(await supabase.rpc('mark_cart_opened', { p_watch_id: watchId }));
}

export async function exportMyData(): Promise<Record<string, unknown>> {
  return check(await supabase.rpc('export_my_data'));
}

export async function deleteMyAccount() {
  check(await supabase.rpc('delete_my_account'));
}
