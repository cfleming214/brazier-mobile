import type { CalendarEventType } from '@brazier/shared';

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export interface ExtractedDate {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Text around the date, used to classify the event. */
  context: string;
}

/**
 * Find calendar dates in free text: "January 17, 2025", "Jan. 17th", "17 January 2025", "1/17/2025".
 * Dates without a year take the next occurrence after `ref`.
 */
export function extractDates(text: string, ref: Date): ExtractedDate[] {
  const out: ExtractedDate[] = [];
  const push = (y: number | null, m: number, d: number, idx: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    let year = y ?? ref.getUTCFullYear();
    if (
      y == null &&
      Date.UTC(year, m, d) <
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()) - 86_400_000 * 30
    )
      year++;
    const iso = new Date(Date.UTC(year, m, d)).toISOString().slice(0, 10);
    if (!out.some((o) => o.date === iso))
      out.push({ date: iso, context: text.slice(Math.max(0, idx - 90), idx + 40).toLowerCase() });
  };
  const monthNames = Object.keys(MONTHS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const mdy = new RegExp(
    `\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    'gi',
  );
  for (const m of text.matchAll(mdy))
    push(m[3] ? Number(m[3]) : null, MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), m.index ?? 0);
  const dmy = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?,?\\s+(\\d{4})\\b`,
    'gi',
  );
  for (const m of text.matchAll(dmy))
    push(Number(m[3]), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), m.index ?? 0);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g))
    push(Number(m[3]), Number(m[1]) - 1, Number(m[2]), m.index ?? 0);
  return out;
}

/** Classify an event from its surrounding text. */
export function detectEventType(text: string): CalendarEventType {
  const t = text.toLowerCase();
  if (/pre-?order|pre-?sale|reserve/.test(t)) return 'preorder_open';
  if (/pre-?release|prerelease event/.test(t)) return 'prerelease';
  if (/restock|back in stock|replenish/.test(t)) return 'restock_window';
  if (/pok[eé]mon center (exclusive|drop)/.test(t)) return 'pc_drop';
  if (/in stores|street date|available at|on shelves|launch(es)? at/.test(t))
    return 'retailer_street_date';
  return 'set_release';
}

export interface FeedItem {
  id: string;
  title: string;
  link: string | null;
  published: string | null;
  text: string;
}

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/<[^>]+>/g, ' ') // entity-encoded HTML inside descriptions
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? strip(m[1]!) : null;
};

/** Parse RSS 2.0 or Atom into items. */
export function parseFeed(xml: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml);
  const blocks = [
    ...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi),
  ].map((m) => m[0]);
  return blocks.map((b) => {
    const atomLink = /<link[^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ?? null;
    const link = isAtom ? atomLink : tag(b, 'link');
    const title = tag(b, 'title') ?? '';
    const id = tag(b, isAtom ? 'id' : 'guid') ?? link ?? title;
    const text = [
      title,
      tag(b, isAtom ? 'summary' : 'description'),
      tag(b, 'content'),
      tag(b, 'content:encoded'),
    ]
      .filter(Boolean)
      .join(' ');
    return { id, title, link, published: tag(b, isAtom ? 'updated' : 'pubDate'), text };
  });
}

/** Midnight America/New_York on an ISO date, as a UTC ISO string (handles EST/EDT). */
export function easternMidnight(isoDate: string, hour = 0): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Try EST (-5) then EDT (-4): pick the offset whose local hour matches.
  for (const offset of [5, 4]) {
    const t = new Date(Date.UTC(y!, m! - 1, d!, hour + offset));
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(t);
    if (Number(local) === hour) return t.toISOString();
  }
  return new Date(Date.UTC(y!, m! - 1, d!, hour + 5)).toISOString();
}
