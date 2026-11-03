import { fireEvent, render, screen } from '@testing-library/react-native';
import { liveRetailer, priceDelta, WatchCard } from '@/components/WatchCard';
import { WatchRow } from '@/components/WatchRow';
import type { WatchOverview } from '@/lib/api';
import { summarize } from '@/lib/radar';

const now = Date.parse('2026-11-01T03:05:00Z');

const base: WatchOverview = {
  watch_id: 'w1',
  user_id: 'u1',
  paused: false,
  max_price_cents: 6500,
  include_marketplace: false,
  pickup_radius_km: null,
  retailer_ids: ['target', 'bestbuy'],
  created_at: '2026-10-30T00:00:00Z',
  product_id: 'p1',
  product_name: 'Prismatic Evolutions Elite Trainer Box',
  set_name: 'Prismatic Evolutions',
  product_type: 'etb',
  msrp_cents: 5999,
  image_url: null,
  status: 'live',
  retailers: [
    {
      retailer_id: 'target',
      retailer_sku: '90000001',
      url: 'https://www.target.com/p/x/-/A-90000001',
      state: 'IN_STOCK',
      price_cents: 5999,
      last_checked_at: '2026-11-01T03:04:13Z',
      poll_tier: 'hot',
    },
    {
      retailer_id: 'bestbuy',
      retailer_sku: '9000001',
      url: null,
      state: 'OUT_OF_STOCK',
      price_cents: null,
      last_checked_at: '2026-11-01T03:04:50Z',
      poll_tier: 'normal',
    },
  ],
};

describe('WatchCard', () => {
  it('shows the live retailer, price and time in stock', async () => {
    await render(<WatchCard watch={base} now={now} onGo={() => {}} />);
    expect(screen.getByText('Prismatic Evolutions Elite Trainer Box')).toBeTruthy();
    expect(screen.getByText('IN STOCK')).toBeTruthy();
    expect(screen.getByText('TARGET · 90000001')).toBeTruthy();
    expect(screen.getByTestId('live-for')).toHaveTextContent('0:47');
  });

  it('calls onGo with the live retailer', async () => {
    const onGo = jest.fn();
    await render(<WatchCard watch={base} now={now} onGo={onGo} />);
    await fireEvent.press(screen.getByTestId('go-button'));
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ retailer_id: 'target' }));
  });

  it('hides GO when nothing is in stock', async () => {
    const soldOut = {
      ...base,
      status: 'sold_out' as const,
      retailers: base.retailers.map((r) => ({ ...r, state: 'OUT_OF_STOCK' as const })),
    };
    await render(<WatchCard watch={soldOut} now={now} onGo={() => {}} />);
    expect(screen.queryByTestId('go-button')).toBeNull();
  });
});

describe('WatchRow', () => {
  it('shows retailers, poll tier, filters and last check', async () => {
    await render(
      <WatchRow
        watch={{
          ...base,
          status: 'monitoring',
          retailers: base.retailers.map((r) => ({ ...r, state: 'OUT_OF_STOCK' as const })),
        }}
        now={now}
      />,
    );
    expect(screen.getByText(/TGT BBY · 30s · ≤ \$65\.00/)).toBeTruthy();
    expect(screen.getByText('10s ago')).toBeTruthy();
  });
});

describe('helpers', () => {
  it('picks the cheapest live retailer', async () => {
    const two = {
      ...base,
      retailers: [
        ...base.retailers,
        { ...base.retailers[0]!, retailer_id: 'walmart' as const, price_cents: 5499 },
      ],
    };
    expect(liveRetailer(two)?.retailer_id).toBe('walmart');
  });
  it('labels price vs MSRP', async () => {
    expect(priceDelta(5999, 5999).label).toBe('MSRP');
    expect(priceDelta(8999, 5999).label).toBe('+50%');
    expect(priceDelta(4999, 5999).label).toBe('-17%');
  });
  it('summarizes watches for the KPI tiles, ignoring paused ones', async () => {
    const s = summarize([
      base,
      { ...base, watch_id: 'w2', status: 'monitoring' },
      { ...base, watch_id: 'w3', status: 'sold_out', paused: true },
    ]);
    expect(s).toMatchObject({ live: 1, monitoring: 1, soldOut: 0, total: 3 });
  });
});
