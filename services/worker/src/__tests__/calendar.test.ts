import { describe, expect, it } from 'vitest';
import { detectEventType, easternMidnight, extractDates, parseFeed } from '../calendar/extract';
import { describeChange, formatWhen } from '../calendar/notify';
import {
  confidenceFrom,
  mergeInto,
  normalize,
  sameEvent,
  type CalendarEventRow,
} from '../calendar/pipeline';
import { computeStats, estimateWindow, nextWeekday } from '../calendar/stats';
import { parseInboundEmail } from '../leads';

const now = new Date('2026-11-01T12:00:00Z');
const catalog = [
  {
    id: 'p-meg',
    name: 'Mega Evolution Pokémon Center Elite Trainer Box',
    setName: 'Mega Evolution',
    productType: 'etb' as const,
    upc: null,
  },
  {
    id: 'p-pfl',
    name: 'Phantasmal Flames Booster Box',
    setName: 'Phantasmal Flames',
    productType: 'booster_box' as const,
    upc: null,
  },
];

describe('date extraction', () => {
  it('reads common date formats', () => {
    const d = extractDates(
      'Preorders open November 7, 2026. In stores Jan 16th, 2027 and 3/20/2027. Prerelease 14 February 2027.',
      now,
    );
    expect(d.map((x) => x.date)).toEqual(['2026-11-07', '2027-01-16', '2027-02-14', '2027-03-20']);
  });
  it('rolls yearless dates forward', () => {
    expect(extractDates('launching January 23', now)[0]!.date).toBe('2027-01-23');
    expect(extractDates('on sale Nov 20', now)[0]!.date).toBe('2026-11-20');
  });
  it('classifies events from context', () => {
    expect(detectEventType('preorders begin')).toBe('preorder_open');
    expect(detectEventType('prerelease events at local stores')).toBe('prerelease');
    expect(detectEventType('available at Target and Walmart')).toBe('retailer_street_date');
    expect(detectEventType('the set releases')).toBe('set_release');
  });
  it('converts Eastern dates to UTC across DST', () => {
    expect(easternMidnight('2027-01-16')).toBe('2027-01-16T05:00:00.000Z');
    expect(easternMidnight('2027-07-16', 3)).toBe('2027-07-16T07:00:00.000Z');
  });
});

describe('feeds', () => {
  it('parses RSS and Atom', () => {
    const rss = `<rss><channel><item><title><![CDATA[Phantasmal Flames arrives November 14]]></title><link>https://news.test/pfl</link><guid>pfl-1</guid><description>&lt;p&gt;Booster boxes &amp; ETBs&lt;/p&gt;</description><pubDate>Sat, 31 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([
      {
        id: 'pfl-1',
        title: 'Phantasmal Flames arrives November 14',
        link: 'https://news.test/pfl',
        published: 'Sat, 31 Oct 2026 10:00:00 GMT',
        text: 'Phantasmal Flames arrives November 14 Booster boxes & ETBs',
      },
    ]);
    const atom = `<feed><entry><id>tag:1</id><title>Mega Evolution ETB preorder</title><link href="https://x.test/a"/><summary>Opens Nov 5</summary><updated>2026-10-30</updated></entry></feed>`;
    expect(parseFeed(atom)[0]).toMatchObject({
      id: 'tag:1',
      link: 'https://x.test/a',
      text: 'Mega Evolution ETB preorder Opens Nov 5',
    });
  });
});

describe('confidence and merging', () => {
  it('confirms on any official or retailer source, otherwise combines rumors below confirmed', () => {
    expect(confidenceFrom([{ trust: 'news' }, { trust: 'official' }]).status).toBe('confirmed');
    const r = confidenceFrom([{ trust: 'news' }, { trust: 'community' }]);
    expect(r.status).toBe('rumored');
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.confidence).toBeGreaterThan(confidenceFrom([{ trust: 'news' }]).confidence);
  });

  const rumored = normalize(
    {
      source: 'pokebeach',
      externalId: '1',
      trust: 'news',
      title: 'Mega Evolution Pokémon Center ETB preorders open November 7',
    },
    catalog,
    ['Mega Evolution'],
    now,
  )!;
  const official = normalize(
    {
      source: 'pokemon.com',
      externalId: 'a',
      trust: 'official',
      title: 'Mega Evolution Pokémon Center ETB preorders',
      text: 'Preorders open November 8, 2026',
      retailerId: null,
    },
    catalog,
    [],
    now,
  )!;

  it('normalizes a news item to a product-anchored candidate', () => {
    expect(rumored).toMatchObject({
      eventType: 'preorder_open',
      productId: 'p-meg',
      setName: 'Mega Evolution',
      startsAt: '2026-11-07T05:00:00.000Z',
    });
  });
  it('drops items with no date or nothing to anchor to', () => {
    expect(
      normalize(
        { source: 's', externalId: 'x', trust: 'news', title: 'Big news coming' },
        catalog,
        [],
        now,
      ),
    ).toBeNull();
    expect(
      normalize(
        { source: 's', externalId: 'x', trust: 'news', title: 'Something on November 9' },
        catalog,
        [],
        now,
      ),
    ).toBeNull();
  });
  it('treats items within a day for the same product and type as the same event', () => {
    const e = {
      event_type: 'preorder_open' as const,
      retailer_id: null,
      product_id: 'p-meg',
      set_name: 'Mega Evolution',
      starts_at: rumored.startsAt,
    };
    expect(sameEvent(e, official)).toBe(true);
    expect(sameEvent({ ...e, retailer_id: 'target' }, official)).toBe(false);
    expect(sameEvent({ ...e, starts_at: '2026-11-20T05:00:00Z' }, official)).toBe(false);
  });
  it('merges: official confirms, moves the date, keeps both source refs and publishes', () => {
    const existing: CalendarEventRow = {
      id: 'e1',
      title: rumored.title,
      event_type: 'preorder_open',
      retailer_id: null,
      product_id: 'p-meg',
      set_name: 'Mega Evolution',
      starts_at: rumored.startsAt,
      status: 'rumored',
      confidence: 0.45,
      source_refs: [rumored.ref],
      published: false,
      is_estimate: false,
      review_status: 'pending',
    };
    const { next, changes } = mergeInto(existing, official);
    expect(changes).toEqual(['date_moved', 'confirmed']);
    expect(next).toMatchObject({
      status: 'confirmed',
      starts_at: '2026-11-08T05:00:00.000Z',
      published: true,
      review_status: 'auto',
    });
    expect(next.source_refs.map((r) => r.source)).toEqual(['pokebeach', 'pokemon.com']);
  });
  it('does not let a rumor move a confirmed date', () => {
    const confirmed: CalendarEventRow = {
      id: 'e2',
      title: 't',
      event_type: 'preorder_open',
      retailer_id: null,
      product_id: 'p-meg',
      set_name: null,
      starts_at: official.startsAt,
      status: 'confirmed',
      confidence: 0.95,
      source_refs: [official.ref],
      published: true,
      is_estimate: false,
      review_status: 'auto',
    };
    const { next, changes } = mergeInto(confirmed, {
      ...rumored,
      startsAt: '2026-11-08T20:00:00Z',
    });
    expect(changes).toEqual([]);
    expect(next.starts_at).toBe(official.startsAt);
  });
});

describe('notification text', () => {
  it('formats times in Eastern', () => {
    expect(formatWhen('2026-11-06T08:00:00Z')).toBe('Fri, Nov 6 · 3:00 AM ET');
  });
  it('describes changes', () => {
    const e = {
      id: 'e',
      title: 'Mega Evolution ETB preorder',
      event_type: 'preorder_open',
      retailer_id: 'pokemoncenter',
      product_id: null,
      set_name: null,
      starts_at: '2026-11-08T05:00:00Z',
      status: 'confirmed',
      confidence: 1,
      source_refs: [],
      published: true,
      is_estimate: false,
      review_status: 'auto',
    } as CalendarEventRow;
    expect(
      describeChange({ kind: 'date_moved', event: e, previousStartsAt: '2026-11-07T05:00:00Z' })
        .body,
    ).toBe(
      'Mega Evolution ETB preorder moved from Sat, Nov 7 · 12:00 AM ET to Sun, Nov 8 · 12:00 AM ET',
    );
    expect(describeChange({ kind: 'confirmed', event: e }).title).toBe('Drop confirmed');
    expect(describeChange({ kind: 'created', event: { ...e, is_estimate: true } }).body).toContain(
      'estimate from past restocks',
    );
  });
});

describe('restock stats', () => {
  // Three Thursday ~3am ET restocks lasting 6, 8 and 4 minutes, plus one Monday noon.
  const ev = (iso: string, s: string) => ({ new_state: s, observed_at: iso });
  const events = [
    ev('2026-10-08T07:02:00Z', 'IN_STOCK'),
    ev('2026-10-08T07:08:00Z', 'OUT_OF_STOCK'),
    ev('2026-10-15T07:05:00Z', 'IN_STOCK'),
    ev('2026-10-15T07:13:00Z', 'OUT_OF_STOCK'),
    ev('2026-10-22T07:01:00Z', 'IN_STOCK'),
    ev('2026-10-22T07:05:00Z', 'OUT_OF_STOCK'),
    ev('2026-10-26T17:00:00Z', 'IN_STOCK'),
    ev('2026-10-26T17:30:00Z', 'OUT_OF_STOCK'),
  ];
  it('computes median time in stock and the typical weekday and hour (Eastern)', () => {
    const s = computeStats(events, now);
    expect(s).toMatchObject({
      restocks_30d: 4,
      restocks_90d: 4,
      median_in_stock_min: 8,
      typical_dow: 4,
      typical_hour: 3,
      pattern_share: 0.75,
    });
    expect(estimateWindow(s)).toBe(true);
  });
  it('needs enough restocks before publishing an estimate', () => {
    expect(estimateWindow(computeStats(events.slice(0, 4), now))).toBe(false);
  });
  it('finds the next weekday', () => {
    expect(nextWeekday(4, now)).toBe('2026-11-05'); // Nov 1 2026 is a Sunday
  });
});

describe('newsletter parsing', () => {
  it('extracts product links and intent', () => {
    const lead = parseInboundEmail({
      from: 'Target <deals@em.target.com>',
      subject: 'Back in stock: Pokémon cards',
      html: '<a href="https://www.target.com/p/pokemon-prismatic-etb/-/A-93954435?cid=email">Shop</a> <a href="https://www.target.com/c/toys">Toys</a>',
    });
    expect(lead).toMatchObject({
      kind: 'restock',
      retailerHint: 'target',
      links: [{ retailer: 'target', sku: '93954435' }],
    });
  });
  it('recognises preorder announcements without links', () => {
    expect(
      parseInboundEmail({
        from: 'Pokémon Center <news@pokemoncenter.com>',
        subject: 'Preorder the Mega Evolution ETB now',
        text: '',
      }),
    ).toMatchObject({ kind: 'preorder', links: [], retailerHint: 'pokemoncenter' });
  });
});
