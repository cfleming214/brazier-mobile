import { bestMatch, parseRetailerUrl, type RetailerSkuRef } from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCatalog } from './calendar/pipeline';

export interface InboundEmail {
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface ParsedLead {
  kind: 'restock' | 'preorder' | 'unknown';
  links: RetailerSkuRef[];
  excerpt: string;
  retailerHint: string | null;
}

const RETAILER_FROM: [RegExp, string][] = [
  [/bestbuy/i, 'bestbuy'],
  [/target/i, 'target'],
  [/walmart/i, 'walmart'],
  [/gamestop/i, 'gamestop'],
  [/pokemoncenter|pok[eé]mon center/i, 'pokemoncenter'],
  [/amazon/i, 'amazon'],
];

/** Pull product links and intent out of a retailer newsletter (Postmark/SES inbound JSON). */
export function parseInboundEmail(m: InboundEmail): ParsedLead {
  const body = `${m.subject}\n${m.text ?? ''}\n${(m.html ?? '').replace(/<[^>]+>/g, ' ')}`;
  const hrefs = [...(m.html ?? '').matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1]!);
  const bare = [...body.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]);
  const links: RetailerSkuRef[] = [];
  for (const u of [...hrefs, ...bare]) {
    const r = parseRetailerUrl(u);
    if (r.ok && !links.some((l) => l.retailer === r.ref.retailer && l.sku === r.ref.sku))
      links.push(r.ref);
  }
  const kind = /pre-?order|pre-?sale/i.test(body)
    ? 'preorder'
    : /back in stock|restock|available now|in stock now|just dropped/i.test(body)
      ? 'restock'
      : 'unknown';
  const retailerHint = RETAILER_FROM.find(([re]) => re.test(m.from))?.[1] ?? null;
  return { kind, links, excerpt: m.subject.slice(0, 200), retailerHint };
}

/**
 * Record leads and make the matching SKUs due for an immediate verifying poll.
 * Leads never alert on their own; only a confirmed poll does.
 */
export async function handleLead(
  db: SupabaseClient,
  source: 'email' | 'rss',
  lead: ParsedLead,
  text: string,
) {
  const matched: string[] = [];
  for (const ref of lead.links) {
    const { data } = await db
      .from('retailer_skus')
      .select('id, product_id')
      .eq('retailer_id', ref.retailer)
      .eq('retailer_sku', ref.sku)
      .maybeSingle();
    await db.from('restock_leads').insert({
      source,
      retailer_id: ref.retailer,
      product_id: data?.product_id ?? null,
      retailer_sku_id: data?.id ?? null,
      url: ref.url ?? null,
      excerpt: lead.excerpt,
      kind: lead.kind,
    });
    if (data) matched.push(data.id);
  }
  if (lead.links.length === 0 && lead.kind !== 'unknown') {
    // No links: match the subject/body against the catalog and the sender's retailer.
    const { catalog } = await loadCatalog(db);
    const m = bestMatch({ title: text.slice(0, 300) }, catalog);
    if (m.productId) {
      let q = db.from('retailer_skus').select('id').eq('product_id', m.productId);
      if (lead.retailerHint) q = q.eq('retailer_id', lead.retailerHint);
      const { data: skus } = await q;
      for (const s of skus ?? []) matched.push(s.id);
      await db
        .from('restock_leads')
        .insert({
          source,
          retailer_id: lead.retailerHint,
          product_id: m.productId,
          excerpt: lead.excerpt,
          kind: lead.kind,
        });
    }
  }
  if (matched.length)
    await db.from('retailer_skus').update({ last_checked_at: null }).in('id', matched);
  return { matched: matched.length };
}
