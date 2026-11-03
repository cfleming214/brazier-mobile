import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { CATEGORIES, LISTINGS, PRODUCTS, RETAILERS, type Listing, type Product } from './dataset';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export const TEST_DB_NAME = 'brazier-test-mode.db';

/** expo-sqlite on web needs wasm + COOP/COEP headers, which this app doesn't set up. */
export const testDbSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let opening: Promise<SQLiteDatabase> | null = null;

/** Open the test-mode database, creating and seeding it on first use. */
export function openTestDb(): Promise<SQLiteDatabase> {
  if (!testDbSupported) return Promise.reject(new Error('Test mode data needs iOS or Android'));
  opening ??= (async () => {
    // Load lazily so web bundles and unit tests never pull in the native module.
    const SQLite = await import('expo-sqlite');
    const db = await SQLite.openDatabaseAsync(TEST_DB_NAME);
    await migrate(db);
    return db;
  })().catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((row?.user_version ?? 0) === SCHEMA_VERSION) return;
  // Test data only: rebuild from scratch whenever the schema version changes.
  await rebuild(db);
}

const TABLES = ['stock_events', 'retailer_skus', 'products', 'retailers', 'categories'];

/** Drop everything and reload the bundled dataset. */
export async function rebuild(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    await db.execAsync(TABLES.map((t) => `drop table if exists ${t};`).join('\n'));
    await db.execAsync(SCHEMA_SQL);
    await seed(db);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

async function seed(db: SQLiteDatabase) {
  for (const c of CATEGORIES) {
    await db.runAsync('insert into categories (id, name) values (?, ?)', [c.id, c.name]);
  }
  for (const r of RETAILERS) {
    await db.runAsync(
      'insert into retailers (id, name, policy, website_url) values (?, ?, ?, ?)',
      [r.id, r.name, JSON.stringify(r.policy), r.website_url],
    );
  }
  for (const p of PRODUCTS) {
    await db.runAsync(
      `insert into products (id, category_id, name, set_name, product_type, upc, msrp_cents,
         image_url, release_date, is_exclusive, exclusive_retailer_id, search_text)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id, p.category_id, p.name, p.set_name, p.product_type, p.upc, p.msrp_cents,
        p.image_url, p.release_date, p.exclusive_retailer_id ? 1 : 0, p.exclusive_retailer_id,
        searchText(p),
      ],
    );
  }
  for (const l of LISTINGS) {
    await db.runAsync(
      `insert into retailer_skus (id, product_id, retailer_id, retailer_sku, url, last_state,
         last_price_cents, last_checked_at, quantity_available, last_in_stock_at,
         last_out_of_stock_at, confirmations, marketplace_only)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        l.id, l.product_id, l.retailer_id, l.retailer_sku, l.url, l.last_state,
        l.last_price_cents, l.last_checked_at, l.quantity_available,
        l.last_state === 'IN_STOCK' ? l.last_checked_at : null,
        l.last_state === 'OUT_OF_STOCK' ? l.last_checked_at : null,
        l.last_state === 'UNKNOWN' ? 0 : 1,
        l.marketplace_only ? 1 : 0,
      ],
    );
    await db.runAsync(...firstStockEvent(l));
  }
}

/** Each listing starts with one tracked observation: unknown -> its current state. */
function firstStockEvent(l: Listing): [string, (string | number | null)[]] {
  return [
    `insert into stock_events (retailer_sku_id, prev_state, new_state, price_cents, qty_hint,
       source, observed_at) values (?, 'UNKNOWN', ?, ?, ?, 'poll', ?)`,
    [l.id, l.last_state, l.last_price_cents, l.quantity_available, l.last_checked_at],
  ];
}

/** Same idea as products_set_search_text() in Postgres: lowercase, accents folded. */
export function searchText(p: Pick<Product, 'name' | 'set_name' | 'product_type' | 'exclusive_retailer_id'>) {
  const parts = [p.name, p.set_name ?? '', p.product_type.replace('_', ' ')];
  if (p.exclusive_retailer_id) parts.push('exclusive pc pokemon center');
  return parts.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export type TestDbSummary = { products: number; retailers: number; listings: number; inStock: number };

export async function summarizeTestDb(db: SQLiteDatabase): Promise<TestDbSummary> {
  const row = await db.getFirstAsync<TestDbSummary>(
    `select (select count(*) from products) as products,
            (select count(*) from retailers) as retailers,
            (select count(*) from retailer_skus) as listings,
            (select count(*) from retailer_skus where last_state = 'IN_STOCK') as inStock`,
  );
  return row ?? { products: 0, retailers: 0, listings: 0, inStock: 0 };
}
