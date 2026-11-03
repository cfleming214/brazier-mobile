/**
 * Runs the test-mode schema and seed against a real SQLite engine (node:sqlite) through a small
 * adapter with the expo-sqlite methods db.ts uses.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { LISTINGS, PRODUCTS, RETAILERS } from '@/lib/testMode/dataset';
import { rebuild, searchText, summarizeTestDb } from '@/lib/testMode/db';

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
    expect(s.products).toBe(20);
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
    expect((await summarizeTestDb(db)).products).toBe(20);
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
  it('has 20 products and the four retailers', () => {
    expect(PRODUCTS).toHaveLength(20);
    expect(RETAILERS.map((r) => r.id).sort()).toEqual(['amazon', 'bestbuy', 'pokemoncenter', 'walmart']);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(20);
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
