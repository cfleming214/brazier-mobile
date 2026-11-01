import { createHash } from 'node:crypto';
import type { CalendarEventType, RetailerSlug } from '@drophawk/shared';
import { bestMatch, normalizeTitle, type MatchCandidate } from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectEventType, easternMidnight, extractDates } from './extract';

export type Trust = 'official' | 'retailer' | 'news' | 'community' | 'history';

export interface SourceItem {
  source: string;
  externalId: string;
  trust: Trust;
  title: string;
  url?: string | null;
  text?: string;
  startsAt?: string | null;
  eventType?: CalendarEventType;
  retailerId?: RetailerSlug | null;
  productId?: string | null;
  setName?: string | null;
  cancelled?: boolean;
}

export interface Candidate {
  title: string;
  eventType: CalendarEventType;
  startsAt: string;
  retailerId: RetailerSlug | null;
  productId: string | null;
  setName: string | null;
  trust: Trust;
  ref: { source: string; url: string | null; trust: Trust; seen_at: string };
  cancelled: boolean;
}

export interface CalendarEventRow {
  id: string;
  title: string;
  event_type: CalendarEventType;
  retailer_id: RetailerSlug | null;
  product_id: string | null;
  set_name: string | null;
  starts_at: string;
  status: 'rumored' | 'confirmed' | 'cancelled';
  confidence: number;
  source_refs: Candidate['ref'][];
  published: boolean;
  is_estimate: boolean;
  review_status: 'auto' | 'pending' | 'approved' | 'rejected';
}

export type ChangeKind = 'created' | 'date_moved' | 'confirmed' | 'cancelled';
export interface CalendarChange {
  kind: ChangeKind;
  event: CalendarEventRow;
  previousStartsAt?: string;
}

const TRUST_WEIGHT: Record<Trust, number> = {
  official: 0.95,
  retailer: 0.9,
  history: 0.6,
  news: 0.45,
  community: 0.35,
};
const CONFIRMING: Trust[] = ['official', 'retailer'];

export const hashItem = (i: SourceItem) =>
  createHash('sha256').update(JSON.stringify(i)).digest('hex');

/** Confidence from all sources: any official/retailer source confirms; otherwise combine independent rumors. */
export function confidenceFrom(refs: { trust: Trust }[]): {
  status: 'rumored' | 'confirmed';
  confidence: number;
} {
  if (refs.some((r) => CONFIRMING.includes(r.trust))) {
    return { status: 'confirmed', confidence: Math.max(...refs.map((r) => TRUST_WEIGHT[r.trust])) };
  }
  const miss = refs.reduce((p, r) => p * (1 - TRUST_WEIGHT[r.trust]), 1);
  return { status: 'rumored', confidence: Math.round(Math.min(0.69, 1 - miss) * 100) / 100 };
}

/** Turn a raw item into a calendar candidate, or null if it has no usable date. */
export function normalize(
  item: SourceItem,
  catalog: MatchCandidate[],
  setNames: string[],
  now: Date,
): Candidate | null {
  const text = `${item.title} ${item.text ?? ''}`;
  let startsAt = item.startsAt ?? null;
  let eventType = item.eventType;
  if (!startsAt) {
    const dates = extractDates(text, now).filter(
      (d) => Date.parse(d.date) >= Date.parse(now.toISOString().slice(0, 10)) - 86_400_000,
    );
    if (dates.length === 0) return null;
    const preferred = dates.find((d) => /pre-?order/.test(d.context)) ?? dates[0]!;
    startsAt = easternMidnight(preferred.date);
    eventType ??= detectEventType(preferred.context);
  }
  eventType ??= detectEventType(text);

  const productId = item.productId ?? bestMatch({ title: text.slice(0, 200) }, catalog).productId;
  const normText = normalizeTitle(text);
  const setName =
    item.setName ??
    (productId ? (catalog.find((c) => c.id === productId)?.setName ?? null) : null) ??
    setNames.find((s) => normText.includes(normalizeTitle(s))) ??
    null;
  if (!productId && !setName && !item.retailerId) return null; // nothing to anchor it to

  return {
    title: item.title.trim().slice(0, 140),
    eventType,
    startsAt,
    retailerId: item.retailerId ?? null,
    productId,
    setName,
    trust: item.trust,
    ref: {
      source: item.source,
      url: item.url ?? null,
      trust: item.trust,
      seen_at: now.toISOString(),
    },
    cancelled: item.cancelled ?? false,
  };
}

/** Is an existing event the same real-world event as this candidate? (BUILD_PLAN 6.2 merge rule) */
export function sameEvent(
  e: Pick<CalendarEventRow, 'event_type' | 'retailer_id' | 'product_id' | 'set_name' | 'starts_at'>,
  c: Candidate,
  windowDays = 1,
): boolean {
  if (e.event_type !== c.eventType) return false;
  if ((e.retailer_id ?? null) !== (c.retailerId ?? null)) return false;
  const anchor =
    (e.product_id && c.productId && e.product_id === c.productId) ||
    (!e.product_id && !c.productId && e.set_name && c.setName && e.set_name === c.setName) ||
    (e.set_name && c.setName && e.set_name === c.setName && (!e.product_id || !c.productId));
  if (!anchor) return false;
  return Math.abs(Date.parse(e.starts_at) - Date.parse(c.startsAt)) <= windowDays * 86_400_000;
}

/** Merge a candidate into an existing event (pure). Official sources may move the date. */
export function mergeInto(
  e: CalendarEventRow,
  c: Candidate,
): { next: CalendarEventRow; changes: ChangeKind[] } {
  const refs = [
    ...e.source_refs.filter((r) => !(r.source === c.ref.source && r.url === c.ref.url)),
    c.ref,
  ];
  const { status, confidence } = confidenceFrom(refs);
  const changes: ChangeKind[] = [];
  let startsAt = e.starts_at;
  if (
    CONFIRMING.includes(c.trust) &&
    Math.abs(Date.parse(c.startsAt) - Date.parse(e.starts_at)) > 3_600_000
  ) {
    startsAt = c.startsAt;
    changes.push('date_moved');
  }
  let nextStatus: CalendarEventRow['status'] = status;
  if (c.cancelled && CONFIRMING.includes(c.trust)) nextStatus = 'cancelled';
  if (nextStatus === 'cancelled' && e.status !== 'cancelled') changes.push('cancelled');
  else if (e.status === 'rumored' && nextStatus === 'confirmed') changes.push('confirmed');
  const autoPublish = nextStatus !== 'rumored' || e.is_estimate;
  return {
    next: {
      ...e,
      starts_at: startsAt,
      status: e.status === 'cancelled' && !c.cancelled ? e.status : nextStatus,
      confidence,
      source_refs: refs,
      product_id: e.product_id ?? c.productId,
      set_name: e.set_name ?? c.setName,
      published: e.published || (autoPublish && e.review_status !== 'rejected'),
      review_status: e.review_status === 'pending' && autoPublish ? 'auto' : e.review_status,
    },
    changes,
  };
}

/** Load the catalog once per run for matching. */
export async function loadCatalog(
  db: SupabaseClient,
): Promise<{ catalog: MatchCandidate[]; setNames: string[] }> {
  const [{ data: products }, { data: sets }] = await Promise.all([
    db.from('products').select('id, name, set_name, product_type, upc'),
    db.from('card_sets').select('name'),
  ]);
  const catalog = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    setName: p.set_name,
    productType: p.product_type,
    upc: p.upc,
  }));
  const setNames = [
    ...new Set([
      ...(sets ?? []).map((s) => s.name as string),
      ...catalog.map((c) => c.setName).filter((s): s is string => !!s),
    ]),
  ];
  return { catalog, setNames };
}

/**
 * Ingest raw items: store them (skipping unchanged ones by content hash), normalize, and merge into
 * calendar_events. Returns the changes for published events so drop-update notifications can go out.
 */
export async function ingest(
  db: SupabaseClient,
  items: SourceItem[],
  now = new Date(),
): Promise<CalendarChange[]> {
  if (items.length === 0) return [];
  const { catalog, setNames } = await loadCatalog(db);
  const changes: CalendarChange[] = [];

  for (const item of items) {
    const hash = hashItem(item);
    const { data: existing } = await db
      .from('calendar_source_items')
      .select('id, content_hash')
      .eq('source', item.source)
      .eq('external_id', item.externalId)
      .maybeSingle();
    if (existing?.content_hash === hash) continue;

    const cand = normalize(item, catalog, setNames, now);
    let eventId: string | null = null;

    if (cand) {
      const from = new Date(Date.parse(cand.startsAt) - 2 * 86_400_000).toISOString();
      const to = new Date(Date.parse(cand.startsAt) + 2 * 86_400_000).toISOString();
      const { data: nearby } = await db
        .from('calendar_events')
        .select('*')
        .eq('event_type', cand.eventType)
        .gte('starts_at', from)
        .lte('starts_at', to);
      const match = ((nearby ?? []) as CalendarEventRow[]).find((e) => sameEvent(e, cand));

      if (match) {
        const { next, changes: kinds } = mergeInto(match, cand);
        const { error } = await db
          .from('calendar_events')
          .update({
            starts_at: next.starts_at,
            status: next.status,
            confidence: next.confidence,
            source_refs: next.source_refs,
            product_id: next.product_id,
            set_name: next.set_name,
            published: next.published,
            review_status: next.review_status,
            cancelled_at: next.status === 'cancelled' ? now.toISOString() : null,
          })
          .eq('id', match.id);
        if (error) throw error;
        eventId = match.id;
        if (next.published)
          for (const k of kinds)
            changes.push({ kind: k, event: next, previousStartsAt: match.starts_at });
        if (!match.published && next.published) changes.push({ kind: 'created', event: next });
      } else {
        const { status, confidence } = confidenceFrom([cand.ref]);
        const publish = status === 'confirmed' || cand.trust === 'history';
        const { data: row, error } = await db
          .from('calendar_events')
          .insert({
            title: cand.title,
            event_type: cand.eventType,
            starts_at: cand.startsAt,
            retailer_id: cand.retailerId,
            product_id: cand.productId,
            set_name: cand.setName,
            status: cand.cancelled ? 'cancelled' : status,
            confidence,
            source_refs: [cand.ref],
            published: publish,
            is_estimate: cand.trust === 'history',
            review_status: publish ? 'auto' : 'pending',
          })
          .select('*')
          .single();
        if (error) throw error;
        eventId = row.id;
        if (publish) changes.push({ kind: 'created', event: row as CalendarEventRow });
      }
    }

    const { error: upErr } = await db.from('calendar_source_items').upsert(
      {
        source: item.source,
        external_id: item.externalId,
        payload: item,
        content_hash: hash,
        trust: item.trust,
        event_id: eventId,
        fetched_at: now.toISOString(),
      },
      { onConflict: 'source,external_id' },
    );
    if (upErr) throw upErr;
  }
  return changes;
}
