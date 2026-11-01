import {
  bestMatch,
  detectProductType,
  type MatchCandidate,
  type ProductType,
} from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FetchJson } from '../http';

/** TCGCSV mirrors TCGplayer's catalog. Category 3 is Pokémon. */
export const POKEMON_CATEGORY = 3;

export interface TcgGroup {
  groupId: number;
  name: string; // e.g. "SV: Prismatic Evolutions"
  abbreviation?: string;
  publishedOn?: string;
}

export interface TcgProduct {
  productId: number;
  name: string;
  groupId: number;
  imageUrl?: string;
  url?: string;
  extendedData?: { name: string; value: string }[];
}

/** "SV: Prismatic Evolutions" -> "Prismatic Evolutions"; "SV08.5: X" -> "X"; "ME01: Mega Evolution" -> "Mega Evolution". */
export function setNameFromGroup(groupName: string): string {
  return groupName.replace(/^[A-Z]{1,4}\d{0,3}(\.\d)?:\s*/, '').trim();
}

/** Sealed products have no card number/rarity and a recognizable sealed product type. */
export function isSealed(p: TcgProduct): boolean {
  const fields = new Set((p.extendedData ?? []).map((d) => d.name.toLowerCase()));
  if (fields.has('number') || fields.has('rarity')) return false;
  if (/\b(code card|jumbo|oversized|single)\b/i.test(p.name)) return false;
  return detectProductType(p.name) !== 'other';
}

export interface SealedCandidate {
  tcgplayerId: string;
  name: string;
  setName: string;
  productType: ProductType;
  upc: string | null;
  imageUrl: string | null;
  url: string | null;
  releaseDate: string | null;
}

export function toSealedCandidates(group: TcgGroup, products: TcgProduct[]): SealedCandidate[] {
  const setName = setNameFromGroup(group.name);
  return products.filter(isSealed).map((p) => {
    const upc =
      p.extendedData?.find((d) => d.name.toUpperCase() === 'UPC')?.value?.replace(/\D/g, '') ||
      null;
    return {
      tcgplayerId: String(p.productId),
      name: p.name.trim(),
      setName,
      productType: detectProductType(p.name),
      upc,
      imageUrl: p.imageUrl ?? null,
      url: p.url ?? null,
      releaseDate: group.publishedOn ? group.publishedOn.slice(0, 10) : null,
    };
  });
}

export interface SealedImportResult {
  groups: number;
  created: number;
  linked: number;
  skipped: number;
}

/**
 * Import sealed products for the given groups. Existing catalog products are matched by UPC or title
 * and get a TCGplayer SKU link; unmatched sealed products are created as new catalog products.
 */
export async function importSealed(opts: {
  fetchJson: FetchJson;
  db: SupabaseClient;
  baseUrl: string;
  groupIds?: number[];
  /** Only import groups published on or after this date when groupIds is not given. */
  since?: string;
}): Promise<SealedImportResult> {
  const groupsRes = await opts.fetchJson<{ results: TcgGroup[] }>(
    `${opts.baseUrl}/${POKEMON_CATEGORY}/groups`,
  );
  const groups = groupsRes.results.filter((g) =>
    opts.groupIds
      ? opts.groupIds.includes(g.groupId)
      : !opts.since || (g.publishedOn ?? '') >= opts.since,
  );

  const { data: existing, error } = await opts.db
    .from('products')
    .select('id, name, set_name, product_type, upc')
    .eq('category_id', 'pokemon_tcg');
  if (error) throw error;
  const catalog: MatchCandidate[] = (existing ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    setName: p.set_name,
    productType: p.product_type,
    upc: p.upc,
  }));

  const result: SealedImportResult = { groups: groups.length, created: 0, linked: 0, skipped: 0 };

  for (const g of groups) {
    const res = await opts.fetchJson<{ results: TcgProduct[] }>(
      `${opts.baseUrl}/${POKEMON_CATEGORY}/${g.groupId}/products`,
    );
    for (const c of toSealedCandidates(g, res.results)) {
      const match = bestMatch({ title: `${c.setName} ${c.name}`, upc: c.upc }, catalog);
      let productId = match.productId;
      if (!productId) {
        const { data, error: insErr } = await opts.db
          .from('products')
          .insert({
            category_id: 'pokemon_tcg',
            name: c.name,
            set_name: c.setName,
            product_type: c.productType,
            upc: c.upc,
            image_url: c.imageUrl,
            release_date: c.releaseDate,
          })
          .select('id')
          .single();
        if (insErr) {
          result.skipped++;
          continue;
        }
        productId = data.id as string;
        catalog.push({
          id: productId,
          name: c.name,
          setName: c.setName,
          productType: c.productType,
          upc: c.upc,
        });
        result.created++;
      } else {
        result.linked++;
      }
      const { error: skuErr } = await opts.db.from('retailer_skus').upsert(
        {
          product_id: productId,
          retailer_id: 'tcgplayer',
          retailer_sku: c.tcgplayerId,
          url: c.url,
        },
        { onConflict: 'retailer_id,retailer_sku' },
      );
      if (skuErr) throw skuErr;
    }
  }
  return result;
}
