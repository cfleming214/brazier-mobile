/**
 * Runs the test-mode schema and seed against a real SQLite engine (node:sqlite) through a small
 * adapter with the expo-sqlite methods db.ts uses.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { LISTINGS, PRODUCTS, RETAILERS } from '@/lib/testMode/dataset';
import {
  adapterHealthIn,
  agendaIn,
  nextCalendarEventIn,
  setReminderIn,
  findProductByRetailerSkuIn,
  findProductByUpcIn,
  getProductIn,
  productStockEventsIn,
  searchProductsIn,
} from '@/lib/testMode/catalog';
import { rebuild, searchText, summarizeTestDb } from '@/lib/testMode/db';
import { refreshDropSchedule } from '@/lib/testMode/schedule';

type Params = (string | number | null)[];
type NodeDb = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...p: Params): unknown; get(...p: Params): unknown; all(...p: Params): unknown[] };
};

let DatabaseSync: (new (path: string) => NodeDb) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

function adapt(db: NodeDb): SQLiteDatabase {
  const adapter = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, params: Params = []) => db.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, params: Params = []) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, params: Params = []) => db.prepare(sql).all(...params),
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('begin');
      try {
        await task();
        db.exec('commit');
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
  return adapter as unknown as SQLiteDatabase;
}

const describeSqlite = DatabaseSync ? describe : describe.skip;

describeSqlite('test-mode database', () => {
  let raw: NodeDb;
  let db: SQLiteDatabase;

  beforeEach(async () => {
    raw = new DatabaseSync!(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    db = adapt(raw);
    await rebuild(db);
  });

  afterEach(() => raw.close());

  it('seeds every product, retailer and listing', async () => {
    const s = await summarizeTestDb(db);
    expect(s.products).toBe(23);
    expect(s.retailers).toBe(4);
    expect(s.listings).toBe(LISTINGS.length);
    expect(raw.prepare('select count(*) n from stock_events').get()).toEqual({ n: LISTINGS.length });
  });

  it('passes the SQLite foreign key check', () => {
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('gives every retailer its own inventory', () => {
    const rows = raw
      .prepare('select retailer_id, count(*) n from retailer_skus group by retailer_id order by retailer_id')
      .all() as { retailer_id: string; n: number }[];
    expect(rows.map((r) => r.retailer_id)).toEqual(['amazon', 'bestbuy', 'pokemoncenter', 'walmart']);
    for (const r of rows) expect(r.n).toBeGreaterThan(0);
  });

  it('can be rebuilt over an existing copy', async () => {
    await rebuild(db);
    expect((await summarizeTestDb(db)).products).toBe(23);
  });

  it('searches like search_products(): every word must match, accents folded', async () => {
    const etbs = await searchProductsIn(db, 'pokemon ETB');
    expect(etbs.length).toBeGreaterThan(5);
    for (const r of etbs) expect(r.product_type).toBe('etb');

    const [pf] = await searchProductsIn(db, 'phantasmal display');
    expect(pf.name).toContain('Booster Display Box');
    expect(pf.retailer_ids.sort()).toEqual(['bestbuy', 'pokemoncenter']);
    // Capped at 20 like the live search; every product matches when the cap allows.
    expect(await searchProductsIn(db, 'Pokémon')).toHaveLength(20);
    expect(await searchProductsIn(db, 'Pokémon', 50)).toHaveLength(23);
    expect(await searchProductsIn(db, 'pokemon digimon')).toEqual([]);
  });

  it('flags exclusives in search results', async () => {
    const [chaos] = await searchProductsIn(db, 'chaos rising');
    expect(chaos.is_exclusive).toBe(true);
    expect(chaos.retailer_ids).toEqual(['pokemoncenter']);
  });

  it('loads a product with its retailer listings', async () => {
    const p = PRODUCTS[0];
    const detail = await getProductIn(db, p.id);
    expect(detail.name).toBe(p.name);
    expect(detail.is_exclusive).toBe(false);
    expect(detail.retailer_skus.map((s) => s.retailer_id)).toEqual(['bestbuy', 'walmart']);
    await expect(getProductIn(db, 'missing')).rejects.toThrow(/not found/);
  });

  it('resolves retailer SKUs and UPCs (including EAN-13 with a leading zero)', async () => {
    expect(await findProductByRetailerSkuIn(db, 'amazon', 'b0dn98rvzm')).toBe(PRODUCTS[1].id);
    expect(await findProductByRetailerSkuIn(db, 'amazon', 'nope')).toBeNull();
    expect(await findProductByUpcIn(db, '196214105133')).toBe(PRODUCTS[0].id);
    expect(await findProductByUpcIn(db, '0196214105133')).toBe(PRODUCTS[0].id);
    expect(await findProductByUpcIn(db, '000000000000')).toBeNull();
  });

  it('returns stock history and retailer health', async () => {
    const events = await productStockEventsIn(db, PRODUCTS[0].id);
    expect(events.map((e) => e.retailer_id).sort()).toEqual(['bestbuy', 'walmart']);
    const health = await adapterHealthIn(db);
    expect(health.map((h) => h.retailer_id)).toEqual(['amazon', 'bestbuy', 'pokemoncenter', 'walmart']);
    for (const h of health) {
      expect(h.status).toBe('ok');
      expect(h.active_protections).toEqual([]);
    }
  });

  it('shows the drop schedule in the agenda and keeps reminders across refreshes', async () => {
    const now = new Date('2026-11-02T18:00:00Z');
    await refreshDropSchedule(db, now);
    const agenda = await agendaIn(db, now);
    expect(agenda.length).toBeGreaterThanOrEqual(4);
    expect(new Set(agenda.map((e) => e.retailer_id)).size).toBe(4);
    for (const e of agenda) {
      expect(e.product_name).toBeTruthy();
      expect(e.my_reminder).toBeNull();
    }
    expect((await nextCalendarEventIn(db, now))?.id).toBe(agenda[0].id);

    await setReminderIn(db, agenda[0].id, 30);
    const later = new Date('2026-11-20T18:00:00Z');
    await refreshDropSchedule(db, later);
    const refreshed = await agendaIn(db, later);
    expect(refreshed.map((e) => e.id).sort()).toEqual(agenda.map((e) => e.id).sort());
    expect(refreshed.find((e) => e.id === agenda[0].id)?.my_reminder).toBe(30);
    for (const e of refreshed) expect(Date.parse(e.starts_at)).toBeGreaterThan(later.getTime());
  });

  it('enforces the same checks as Postgres', () => {
    expect(() =>
      raw.exec(
        "insert into products (id, category_id, name, product_type) values ('x', 'pokemon_tcg', 'X', 'plushie')",
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      raw.exec(`update retailer_skus set quantity_available = -1 where id = '${LISTINGS[0].id}'`),
    ).toThrow(/CHECK/);
  });
});

describe('test-mode dataset', () => {
  it('has 20 released and 3 upcoming products, and the four retailers', () => {
    expect(PRODUCTS.filter((p) => !p.is_upcoming)).toHaveLength(20);
    expect(PRODUCTS.filter((p) => p.is_upcoming)).toHaveLength(3);
    expect(RETAILERS.map((r) => r.id).sort()).toEqual(['amazon', 'bestbuy', 'pokemoncenter', 'walmart']);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(23);
  });

  it('lists every product at one or more retailers, exclusives only at their retailer', () => {
    for (const p of PRODUCTS) {
      const at = LISTINGS.filter((l) => l.product_id === p.id).map((l) => l.retailer_id);
      expect(at.length).toBeGreaterThan(0);
      if (p.exclusive_retailer_id) expect(new Set(at)).toEqual(new Set([p.exclusive_retailer_id]));
    }
  });

  it('uses https product photos', () => {
    for (const p of PRODUCTS) expect(p.image_url).toMatch(/^https:\/\//);
  });

  it('builds search text like the Postgres trigger', () => {
    expect(
      searchText({
        name: 'Pokémon Center Elite Trainer Box',
        set_name: 'Mega Evolution',
        product_type: 'etb',
        exclusive_retailer_id: 'pokemoncenter',
      }),
    ).toBe('pokemon center elite trainer box mega evolution etb exclusive pc pokemon center');
  });
});
