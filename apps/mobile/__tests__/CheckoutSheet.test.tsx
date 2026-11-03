import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { saveProfile } from '@/lib/checkoutProfile';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'w1' }),
}));
jest.mock('@/lib/openRetailer', () => ({ openRetailer: jest.fn(async () => {}) }));

import CheckoutSheet from '../app/checkout/[id]';
import { openRetailer } from '@/lib/openRetailer';

const watch = {
  watch_id: 'w1',
  product_name: 'Prismatic Evolutions ETB',
  retailers: [
    { retailer_id: 'target', state: 'OUT_OF_STOCK', url: 'https://t', price_cents: 4999 },
    { retailer_id: 'bestbuy', state: 'IN_STOCK', url: 'https://bb', price_cents: 5499 },
  ],
};

function mockSupabase() {
  const single = jest.fn(async () => ({ data: watch, error: null }));
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: () => ({ eq: () => ({ single }) }),
    insert: jest.fn(async () => ({ error: null })),
  }));
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
}

async function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheckoutSheet />
    </QueryClientProvider>,
  );
}

describe('CheckoutSheet', () => {
  beforeEach(() => {
    (SecureStore as unknown as { __reset: () => void }).__reset();
    jest.clearAllMocks();
    mockSupabase();
  });

  it('lists only in-stock retailers and records the open for hit rate', async () => {
    await renderSheet();
    const go = await screen.findByTestId('checkout-go-bestbuy');
    expect(screen.queryByTestId('checkout-go-target')).toBeNull();
    fireEvent.press(go);
    await waitFor(() => expect(openRetailer).toHaveBeenCalledWith(watch.retailers[1]));
    expect(supabase.rpc).toHaveBeenCalledWith('mark_cart_opened', { p_watch_id: 'w1' });
  });

  it('prompts to add a profile when none is saved', async () => {
    await renderSheet();
    expect(await screen.findByTestId('checkout-add-profile')).toBeTruthy();
  });

  it('copies profile fields to the clipboard', async () => {
    await saveProfile({
      id: 'p1',
      label: 'Home',
      fullName: 'Ash Ketchum',
      email: 'ash@example.com',
      phone: '+1 555 010 0199',
      address1: '1 Pallet Rd',
      city: 'Pallet',
      region: 'KS',
      postalCode: '66002',
    });
    await renderSheet();
    fireEvent.press(await screen.findByTestId('copy-postalCode'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('66002'));
  });
});
