/**
 * A real SQLite engine (node:sqlite) behind the expo-sqlite methods the test-mode code uses,
 * so tests run the actual schema and queries. `sqliteAvailable` is false on Node versions
 * without node:sqlite; wrap suites in `describeSqlite`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

type Params = (string | number | null)[];
export type NodeDb = {
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

export const sqliteAvailable = DatabaseSync != null;
export const describeSqlite = sqliteAvailable ? describe : describe.skip;

export function openMemoryDb(): { raw: NodeDb; db: SQLiteDatabase } {
  const raw = new DatabaseSync!(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const adapter = {
    execAsync: async (sql: string) => raw.exec(sql),
    runAsync: async (sql: string, params: Params = []) => raw.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, params: Params = []) => raw.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, params: Params = []) => raw.prepare(sql).all(...params),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('begin');
      try {
        await task();
        raw.exec('commit');
      } catch (e) {
        raw.exec('rollback');
        throw e;
      }
    },
  };
  return { raw, db: adapter as unknown as SQLiteDatabase };
}
