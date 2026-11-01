import type { RetailerAdapter, RetailerSlug } from '@drophawk/shared';
import { bestMatch } from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FetchJson } from '../http';
import { easternMidnight, parseFeed } from './extract';
import { loadCatalog, type SourceItem, type Trust } from './pipeline';

/** Official set release dates from card_sets (populated from the Pokémon TCG API). */
export async function setReleaseItems(db: SupabaseClient, now = new Date()): Promise<SourceItem[]> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db
    .from('card_sets')
    .select('id, name, release_date')
    .gte('release_date', since);
  return (data ?? []).map((s) => ({
    source: 'pokemontcg',
    externalId: `set:${s.id}`,
    trust: 'official' as const,
    title: `${s.name} release`,
    startsAt: easternMidnight(s.release_date),
    eventType: 'set_release' as const,
    setName: s.name,
  }));
}

export interface FeedConfig {
  url: string;
  source: string;
  trust: Trust;
}

/** Parse configured RSS/Atom feeds (official news = official, TCG news sites = news). */
export async function feedItems(
  fetchText: (url: string) => Promise<string>,
  feeds: FeedConfig[],
): Promise<SourceItem[]> {
  const out: SourceItem[] = [];
  for (const f of feeds) {
    try {
      for (const item of parseFeed(await fetchText(f.url))) {
        out.push({
          source: f.source,
          externalId: item.id,
          trust: f.trust,
          title: item.title,
          url: item.link,
          text: item.text,
        });
      }
    } catch (e) {
      console.error(`feed ${f.source} failed`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** Preorders our own polling has confirmed become confirmed per-retailer preorder events. */
export async function preorderItems(db: SupabaseClient, now = new Date()): Promise<SourceItem[]> {
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const { data } = await db
    .from('stock_events')
    .select('id, observed_at, retailer_skus(retailer_id, product_id, url, products(name))')
    .eq('new_state', 'PREORDER')
    .is('suppressed_reason', null)
    .gte('observed_at', since);
  return (
    (data ?? []) as unknown as {
      id: number;
      observed_at: string;
      retailer_skus: {
        retailer_id: RetailerSlug;
        product_id: string;
        url: string | null;
        products: { name: string };
      };
    }[]
  ).map((e) => ({
    source: 'drophawk-poll',
    externalId: `preorder:${e.id}`,
    trust: 'retailer' as const,
    title: `Preorder open: ${e.retailer_skus.products.name}`,
    url: e.retailer_skus.url,
    startsAt: e.observed_at,
    eventType: 'preorder_open' as const,
    retailerId: e.retailer_skus.retailer_id,
    productId: e.retailer_skus.product_id,
  }));
}

/** Pending in-app submissions -> rumored items (marked ingested). */
export async function submissionItems(db: SupabaseClient): Promise<SourceItem[]> {
  const { data } = await db
    .from('calendar_submissions')
    .select('*')
    .eq('status', 'pending')
    .limit(200);
  if (!data?.length) return [];
  await db
    .from('calendar_submissions')
    .update({ status: 'ingested' })
    .in(
      'id',
      data.map((d) => d.id),
    );
  return data.map((s) => ({
    source: 'community',
    externalId: `submission:${s.id}`,
    trust: 'community' as const,
    title: s.title,
    url: s.source_url,
    text: s.note ?? '',
    startsAt: s.starts_at,
    eventType: s.event_type,
    retailerId: s.retailer_id,
    productId: s.product_id,
  }));
}

/**
 * Daily retailer discovery (DROP-43): search each adapter for upcoming sets, link matching listings to
 * catalog products, and queue unmatched ones for review. Preorder windows then come from polling.
 */
export async function discoverListings(
  db: SupabaseClient,
  adapters: RetailerAdapter[],
  now = new Date(),
) {
  const { catalog } = await loadCatalog(db);
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: sets } = await db.from('card_sets').select('name').gte('release_date', since);
  const queries = [...new Set([...(sets ?? []).map((s) => `pokemon ${s.name}`)])];
  let linked = 0;
  let queued = 0;
  for (const adapter of adapters) {
    if (!adapter.searchCatalog || !adapter.policy.enabled) continue;
    for (const q of queries) {
      let listings;
      try {
        listings = await adapter.searchCatalog(q);
      } catch {
        continue;
      }
      for (const l of listings) {
        const m = bestMatch({ title: l.title, upc: l.upc }, catalog);
        if (m.productId) {
          const { error } = await db
            .from('retailer_skus')
            .upsert(
              {
                product_id: m.productId,
                retailer_id: l.ref.retailer,
                retailer_sku: l.ref.sku,
                url: l.ref.url ?? null,
              },
              { onConflict: 'retailer_id,retailer_sku', ignoreDuplicates: true },
            );
          if (!error) linked++;
        } else if (/pok[eé]mon/i.test(l.title)) {
          await db
            .from('catalog_review_queue')
            .upsert(
              {
                kind: 'listing',
                retailer_id: l.ref.retailer,
                retailer_sku: l.ref.sku,
                url: l.ref.url ?? null,
                upc: l.upc,
                title: l.title,
                match_score: m.score,
              },
              { ignoreDuplicates: true },
            );
          queued++;
        }
      }
    }
  }
  return { linked, queued };
}

export type { FetchJson };
