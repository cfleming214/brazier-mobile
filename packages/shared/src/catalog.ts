import type { ProductType } from './domain';

/** Normalize a retailer or catalog title for matching. */
export function normalizeTitle(title: string): string {
  let s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ');
  const replacements: [RegExp, string][] = [
    [/\bpokemon\s+trading\s+card\s+game\b/g, ' '],
    [/\bpokemon\s+tcg\b/g, ' '],
    [/\btcg\b/g, ' '],
    [/\bscarlet\s+and\s+violet\b/g, ' '],
    [/\bsv\d{1,2}(\.\d)?\b/g, ' '],
    [/\bsword\s+and\s+shield\b/g, ' '],
    [/\belite\s+trainer\s+box(es)?\b/g, ' etb '],
    [/\bpokemon\s+center\b/g, ' pc '],
    [/\bbooster\s+display\s+box\b/g, ' booster box '],
    [/\bdisplay\s+box\b/g, ' booster box '],
    [/\b(\d+)\s*-?\s*pack\b/g, ' $1pk '],
    [/\bpokemon\b/g, ' '],
  ];
  for (const [re, to] of replacements) s = s.replace(re, to);
  return s
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|of|card|cards|game|new|sealed|english)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Guess the sealed product type from a title. */
export function detectProductType(title: string): ProductType {
  const n = normalizeTitle(title);
  if (/\betb\b/.test(n)) return 'etb';
  if (/\bbooster bundle\b/.test(n)) return 'booster_bundle';
  if (/\bbooster box\b/.test(n)) return 'booster_box';
  if (/\btin\b/.test(n)) return 'tin';
  if (/\bblister\b|\b3pk\b|\bcheck\s?lane\b/.test(n)) return 'blister';
  if (/\bcollection\b|\bpremium\b|\bbox\b/.test(n)) return 'collection';
  return 'other';
}

const tokens = (s: string) => new Set(normalizeTitle(s).split(' ').filter(Boolean));

export interface MatchCandidate {
  id: string;
  name: string;
  setName: string | null;
  productType: ProductType;
  upc: string | null;
}

export interface MatchInput {
  title: string;
  upc?: string | null;
}

export interface MatchResult {
  productId: string | null;
  score: number;
  reason: 'upc' | 'title' | 'none';
}

/** Score a listing against one catalog product (0..1). */
export function scoreMatch(input: MatchInput, c: MatchCandidate): number {
  const cleanUpc = (u: string) => u.replace(/\D/g, '').replace(/^0+/, '');
  if (input.upc && c.upc && cleanUpc(input.upc) && cleanUpc(input.upc) === cleanUpc(c.upc))
    return 1;

  const a = tokens(input.title);
  const b = tokens(c.name);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of b) if (a.has(t)) inter++;
  // Coverage of the catalog name matters more than extra words in the listing.
  const coverage = inter / b.size;
  const jaccard = inter / (a.size + b.size - inter);
  let score = 0.7 * coverage + 0.3 * jaccard;

  const listingType = detectProductType(input.title);
  if (listingType !== 'other' && listingType !== c.productType) score *= 0.4;
  if (c.setName) {
    const setTokens = tokens(c.setName);
    const setHit = [...setTokens].every((t) => a.has(t));
    if (!setHit) score *= 0.5;
  }
  return Math.min(1, Math.round(score * 1000) / 1000);
}

export const AUTO_MATCH_THRESHOLD = 0.8;

/** Pick the best catalog product for a listing. Below the threshold, send it to review. */
export function bestMatch(input: MatchInput, candidates: MatchCandidate[]): MatchResult {
  let best: MatchResult = { productId: null, score: 0, reason: 'none' };
  for (const c of candidates) {
    const s = scoreMatch(input, c);
    if (s > best.score)
      best = { productId: c.id, score: s, reason: s === 1 && input.upc ? 'upc' : 'title' };
  }
  if (best.score < AUTO_MATCH_THRESHOLD) return { ...best, productId: null, reason: 'none' };
  return best;
}
