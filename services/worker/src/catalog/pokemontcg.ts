import type { SupabaseClient } from '@supabase/supabase-js';
import type { FetchJson } from '../http';

/** Shape of a set from GET /v2/sets (Pokémon TCG API). */
export interface ApiSet {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string; // "2025/01/17"
  images?: { logo?: string; symbol?: string };
}

export interface CardSetRow {
  id: string;
  category_id: 'pokemon_tcg';
  name: string;
  series: string | null;
  release_date: string | null;
  logo_url: string | null;
}

export function mapSet(s: ApiSet): CardSetRow {
  const date = s.releaseDate?.replace(/\//g, '-') ?? null;
  return {
    id: s.id,
    category_id: 'pokemon_tcg',
    name: s.name.trim(),
    series: s.series?.trim() || null,
    release_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    logo_url: s.images?.logo ?? null,
  };
}

/** Fetch every set (paged) and upsert into card_sets. Idempotent. */
export async function importSets(opts: {
  fetchJson: FetchJson;
  db: SupabaseClient;
  baseUrl: string;
  apiKey?: string;
}): Promise<{ upserted: number }> {
  const headers = opts.apiKey ? { 'X-Api-Key': opts.apiKey } : undefined;
  const rows: CardSetRow[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await opts.fetchJson<{ data: ApiSet[]; totalCount?: number; pageSize?: number }>(
      `${opts.baseUrl}/sets?page=${page}&pageSize=250&orderBy=releaseDate`,
      { headers },
    );
    rows.push(...res.data.map(mapSet));
    if (res.data.length < 250) break;
  }
  if (rows.length === 0) return { upserted: 0 };
  const { error } = await opts.db.from('card_sets').upsert(
    rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
    { onConflict: 'id' },
  );
  if (error) throw error;
  return { upserted: rows.length };
}
