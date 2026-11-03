import AsyncStorage from '@react-native-async-storage/async-storage';
import { getProduct, productStockEvents, resolveUpc, resolveUrl, searchProducts } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { testCatalog } from '@/lib/testMode/catalog';
import { __resetTestSettingsForTests, currentDataSource, setTestFlag } from '@/lib/testMode/settings';

jest.mock('@/lib/testMode/catalog', () => ({
  testCatalog: {
    searchProducts: jest.fn(async () => [{ id: 'test-product' }]),
    getProduct: jest.fn(async () => ({ id: 'test-product', retailer_skus: [] })),
    findProductByRetailerSku: jest.fn(async () => null),
    findProductByUpc: jest.fn(async () => 'test-product'),
    productStockEvents: jest.fn(async () => []),
    adapterHealth: jest.fn(async () => []),
  },
}));

const rpc = supabase.rpc as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  __resetTestSettingsForTests();
  await AsyncStorage.clear();
});

describe('test data switch', () => {
  it('reads saved switches before deciding the source', async () => {
    await AsyncStorage.setItem('brazier.testData.enabled', 'true');
    expect(await currentDataSource()).toBe('test');
  });

  it('uses Supabase when off', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'live-product' }], error: null });
    expect(await searchProducts('prismatic')).toEqual([{ id: 'live-product' }]);
    expect(rpc).toHaveBeenCalledWith('search_products', { q: 'prismatic', max_results: 20 });
    expect(testCatalog.searchProducts).not.toHaveBeenCalled();
  });

  it('reads products from the local dataset when on', async () => {
    await setTestFlag('testData', true);
    expect(await searchProducts('prismatic')).toEqual([{ id: 'test-product' }]);
    expect(await getProduct('test-product')).toMatchObject({ id: 'test-product' });
    await productStockEvents('test-product');
    expect(testCatalog.productStockEvents).toHaveBeenCalledWith('test-product');
    expect(rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('never sends unknown items to the review queue in test data', async () => {
    await setTestFlag('testData', true);
    expect(await resolveUpc('196214105133')).toEqual({ kind: 'found', productId: 'test-product' });
    const r = await resolveUrl('https://www.bestbuy.com/site/x/6606082.p?skuId=6606082');
    expect(r).toEqual({ kind: 'error', message: 'That product isn’t in the test dataset.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('test mode alone does not switch the data source', async () => {
    await setTestFlag('testMode', true);
    expect(await currentDataSource()).toBe('live');
  });
});
