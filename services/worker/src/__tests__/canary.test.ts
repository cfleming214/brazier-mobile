import type { RetailerAdapter } from '@brazier/shared';
import { describe, expect, it } from 'vitest';
import { BlockedError } from '../adapters/protections';
import { checkAdapter, checkFeed, isFailure, issueBody } from '../canary';

const adapter = (impl: RetailerAdapter['fetchAvailability']): RetailerAdapter => ({
  slug: 'target',
  policy: {
    enabled: true,
    maxRequestsPerMinute: 30,
    allowedEndpoints: [],
    automationAllowed: false,
    backoffSeconds: 60,
  },
  parseUrl: () => null,
  fetchAvailability: impl,
});
const t = { retailer: 'target' as const, sku: '93954435' };
const reading = (state: string) => async () =>
  [
    {
      ref: t,
      state,
      priceCents: null,
      marketplaceOnly: false,
      shipAvailable: false,
      pickupAvailable: false,
      observedAt: '',
    },
  ] as never;

describe('canary', () => {
  it('passes a definite reading', async () => {
    expect((await checkAdapter(adapter(reading('OUT_OF_STOCK')), t)).outcome).toBe('ok');
  });

  it('flags UNKNOWN and DELISTED as parser breakage', async () => {
    expect((await checkAdapter(adapter(reading('UNKNOWN')), t)).outcome).toBe('parser_broken');
    expect((await checkAdapter(adapter(reading('DELISTED')), t)).outcome).toBe('parser_broken');
  });

  it('reports blocking without counting it as breakage', async () => {
    const r = await checkAdapter(
      adapter(async () => {
        throw new BlockedError(429, ['ratelimit']);
      }),
      t,
    );
    expect(r.outcome).toBe('blocked');
    expect(isFailure(r)).toBe(false);
  });

  it('skips adapters without credentials or disabled', async () => {
    expect((await checkAdapter(undefined, t)).outcome).toBe('skipped');
    const noKey = adapter(async () => {
      throw new Error('BESTBUY_API_KEY is not set');
    });
    expect((await checkAdapter(noKey, t)).outcome).toBe('skipped');
  });

  it('checks feeds parse to at least one item', async () => {
    const rss =
      '<rss><channel><item><title>Mega Evolution ETB preorders</title><link>https://x.test/a</link><guid>a</guid></item></channel></rss>';
    const f = { url: 'https://x.test/feed', source: 'news', trust: 'news' as const };
    expect((await checkFeed(async () => rss, f)).outcome).toBe('ok');
    expect((await checkFeed(async () => '<rss><channel></channel></rss>', f)).outcome).toBe(
      'parser_broken',
    );
    expect(
      (
        await checkFeed(async () => {
          throw new Error('HTTP 500');
        }, f)
      ).outcome,
    ).toBe('error');
  });

  it('writes an issue body listing every result', () => {
    const body = issueBody([
      { kind: 'adapter', name: 'target', outcome: 'parser_broken', detail: 'a|b' },
    ]);
    expect(body).toContain('| adapter | target | parser_broken | a/b |');
  });
});
