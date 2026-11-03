import {
  countdownLabel,
  filterAgenda,
  groupByDay,
  parseLocalDateTime,
  typicalWindow,
  type AgendaEvent,
} from '@/lib/calendar';

const ev = (id: string, type: AgendaEvent['event_type'], startsAt: string): AgendaEvent => ({
  id,
  title: id,
  event_type: type,
  retailer_id: null,
  starts_at: startsAt,
  timezone: 'America/New_York',
  status: 'confirmed',
  confidence: 1,
  is_estimate: false,
  sponsored: false,
  source_refs: [],
  product_id: null,
  set_name: null,
  product_name: null,
  my_reminder: null,
});

describe('calendar helpers', () => {
  const events = [
    ev('a', 'set_release', '2026-11-07T15:00:00Z'),
    ev('b', 'preorder_open', '2026-11-07T18:00:00Z'),
    ev('c', 'restock_window', '2026-11-09T08:00:00Z'),
  ];

  it('filters by pill', () => {
    expect(filterAgenda(events, 'preorders').map((e) => e.id)).toEqual(['b']);
    expect(filterAgenda(events, 'restocks').map((e) => e.id)).toEqual(['c']);
    expect(filterAgenda(events, 'all')).toHaveLength(3);
  });

  it('groups by day in order', () => {
    const g = groupByDay(events);
    expect(g.map((x) => x.events.map((e) => e.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('labels countdowns', () => {
    const now = Date.parse('2026-11-07T14:52:00Z');
    expect(countdownLabel('2026-11-07T15:00:00Z', now)).toBe('in 8m');
    expect(countdownLabel('2026-11-07T18:00:00Z', now)).toBe('in 3h');
    expect(countdownLabel('2026-11-09T15:00:00Z', now)).toBe('in 2d');
    expect(countdownLabel('2026-11-07T14:30:00Z', now)).toBe('LIVE');
    expect(countdownLabel('2026-11-07T10:00:00Z', now)).toBe('ENDED');
  });

  it('describes a typical restock window only when the pattern is strong', () => {
    expect(
      typicalWindow({ typical_dow: 4, typical_hour: 3, pattern_share: 0.75, restocks_90d: 4 }),
    ).toBe('Thu ~3am ET');
    expect(
      typicalWindow({ typical_dow: 1, typical_hour: 15, pattern_share: 0.6, restocks_90d: 3 }),
    ).toBe('Mon ~3pm ET');
    expect(
      typicalWindow({ typical_dow: 4, typical_hour: 3, pattern_share: 0.3, restocks_90d: 4 }),
    ).toBeNull();
  });

  it('parses submitted dates', () => {
    expect(parseLocalDateTime('2026-11-07')).not.toBeNull();
    expect(parseLocalDateTime('2026-11-07 03:00')).not.toBeNull();
    expect(parseLocalDateTime('Nov 7')).toBeNull();
  });
});
