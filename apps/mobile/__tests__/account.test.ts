import { isFreeLimitError } from '@/lib/api';
import { formatResponseTime } from '@/lib/format';
import { shouldPersistQuery } from '@/lib/queryClient';

describe('account helpers', () => {
  it('detects the free-tier trigger error', () => {
    expect(isFreeLimitError(new Error('FREE_LIMIT: free plan allows 3 active watches'))).toBe(true);
    expect(isFreeLimitError(new Error('duplicate key'))).toBe(false);
    expect(isFreeLimitError('FREE_LIMIT')).toBe(false);
  });

  it('formats response times', () => {
    expect(formatResponseTime(null)).toBe('—');
    expect(formatResponseTime(42)).toBe('42s');
    expect(formatResponseTime(125)).toBe('2m 5s');
  });

  it('never persists device-only queries to AsyncStorage', () => {
    expect(shouldPersistQuery({ state: { status: 'success' } })).toBe(true);
    expect(shouldPersistQuery({ state: { status: 'success' }, meta: { persist: false } })).toBe(
      false,
    );
    expect(shouldPersistQuery({ state: { status: 'error' } })).toBe(false);
  });
});

describe('affiliate tagging', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withAffiliate } = require('@/lib/openRetailer') as typeof import('@/lib/openRetailer');
  it('adds the Amazon associate tag and leaves other retailers alone', () => {
    expect(withAffiliate('https://www.amazon.com/dp/B0X', 'brazier-20')).toBe(
      'https://www.amazon.com/dp/B0X?tag=brazier-20',
    );
    expect(withAffiliate('https://www.amazon.com/dp/B0X?tag=other', 'brazier-20')).toContain(
      'tag=other',
    );
    expect(withAffiliate('https://www.target.com/p/-/A-1', 'brazier-20')).toBe(
      'https://www.target.com/p/-/A-1',
    );
    expect(withAffiliate('https://www.amazon.com/dp/B0X', undefined)).toBe(
      'https://www.amazon.com/dp/B0X',
    );
  });
});
