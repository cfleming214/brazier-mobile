/**
 * Product and retailer reads against the on-device test database.
 * Each function returns the same shape as its Supabase counterpart in lib/api.ts / lib/telemetry.ts.
 * The *In(db, ...) forms take a database so tests can run them on node:sqlite.
 */
import type { RetailerSlug } from '@brazier/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ProductDetail, ProductSearchResult, StockEventRow } from '../api';
import type { AdapterHealth } from '../telemetry';
import { openTestDb } from './db';

/** Same tokenising as search_products(): lowercase, accents folded, split on non-alphanumerics. */
export function searchTerms(q: string): string[] {
  return q
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type ProductRow = Omit<ProductSearchResult, 'is_exclusive' | 'retailer_ids'> & {
  is_exclusive: number;
  retailer_ids: string | null;
};

export async function searchProductsIn(
  db: SQLiteDatabase,
  q: string,
  maxResults = 20,
): Promise<ProductSearchResult[]> {
  const words = searchTerms(q);
  if (words.length === 0) return [];
  // Every word must appear in search_text, like the Postgres function.
  const where = words.map(() => `p.search_text like '%' || ? || '%'`).join(' and ');
  const rows = await db.getAllAsync<ProductRow>(
    `select p.id, p.name, p.set_name, p.product_type, p.msrp_cents, p.image_url, p.is_exclusive,
            (select json_group_array(distinct rs.retailer_id) from retailer_skus rs
              where rs.product_id = p.id) as retailer_ids
       from products p
      where ${where}
      order by p.release_date desc nulls last, p.name
      limit ?`,
    [...words, Math.min(Math.max(maxResults, 1), 50)],
  );
  return rows.map((r) => ({
    ...r,
    is_exclusive: r.is_exclusive === 1,
    retailer_ids: JSON.parse(r.retailer_ids ?? '[]') as RetailerSlug[],
  }));
}

export async function getProductIn(db: SQLiteDatabase, id: string): Promise<ProductDetail> {
  const p = await db.getFirstAsync<Omit<ProductDetail, 'is_exclusive' | 'retailer_skus'> & { is_exclusive: number }>(
    `select id, name, set_name, product_type, msrp_cents, image_url, is_exclusive
       from products where id = ?`,
    [id],
  );
  if (!p) throw new Error('Product not found in the test dataset');
  const skus = await db.getAllAsync<ProductDetail['retailer_skus'][number]>(
    `select retailer_id, retailer_sku, url, last_state, last_price_cents
       from retailer_skus where product_id = ? order by retailer_id`,
    [id],
  );
  return { ...p, is_exclusive: p.is_exclusive === 1, retailer_skus: skus };
}

export async function findProductByRetailerSkuIn(
  db: SQLiteDatabase,
  retailer: string,
  sku: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ product_id: string }>(
    'select product_id from retailer_skus where retailer_id = ? and lower(retailer_sku) = lower(?)',
    [retailer, sku],
  );
  return row?.product_id ?? null;
}

export async function findProductByUpcIn(db: SQLiteDatabase, upc: string): Promise<string | null> {
  const digits = upc.replace(/\D/g, '');
  const row = await db.getFirstAsync<{ id: string }>(
    // Scanners may report UPC-A as 13-digit EAN with a leading zero.
    'select id from products where upc = ? or upc = ltrim(?, \'0\') or \'0\' || upc = ?',
    [digits, digits, digits],
  );
  return row?.id ?? null;
}

/**
 * Stock history for a product. Unlike the live query there is no date window: the test dataset's
 * observations are fixed in time and would otherwise age out.
 */
export async function productStockEventsIn(
  db: SQLiteDatabase,
  productId: string,
): Promise<(StockEventRow & { retailer_id: RetailerSlug })[]> {
  return db.getAllAsync<StockEventRow & { retailer_id: RetailerSlug }>(
    `select e.id, e.retailer_sku_id, e.prev_state, e.new_state, e.price_cents, e.observed_at,
            rs.retailer_id
       from stock_events e
       join retailer_skus rs on rs.id = e.retailer_sku_id
      where rs.product_id = ? and e.suppressed_reason is null
      order by e.observed_at`,
    [productId],
  );
}

export async function adapterHealthIn(db: SQLiteDatabase): Promise<AdapterHealth[]> {
  const rows = await db.getAllAsync<Omit<AdapterHealth, 'active_protections'> & { active_protections: string }>(
    `select retailer_id, status, latency_ms, success_rate, checks_per_min, active_protections, updated_at
       from adapter_health order by retailer_id`,
  );
  return rows.map((r) => ({ ...r, active_protections: JSON.parse(r.active_protections) as string[] }));
}

export const testCatalog = {
  searchProducts: async (q: string) => searchProductsIn(await openTestDb(), q),
  getProduct: async (id: string) => getProductIn(await openTestDb(), id),
  findProductByRetailerSku: async (retailer: string, sku: string) =>
    findProductByRetailerSkuIn(await openTestDb(), retailer, sku),
  findProductByUpc: async (upc: string) => findProductByUpcIn(await openTestDb(), upc),
  productStockEvents: async (productId: string) => productStockEventsIn(await openTestDb(), productId),
  adapterHealth: async () => adapterHealthIn(await openTestDb()),
};
