import type { AvailabilityResult, RetailerSkuRef, StockState } from '@drophawk/shared';
import { BlockedError, detectProtections } from './protections';

export interface AdapterContext {
  userAgent: string;
  fetch: typeof fetch;
  now?: () => Date;
}

export function result(
  ref: RetailerSkuRef,
  r: Partial<Omit<AvailabilityResult, 'ref'>> & { state: StockState },
  now: () => Date = () => new Date(),
): AvailabilityResult {
  return {
    ref,
    priceCents: null,
    marketplaceOnly: false,
    shipAvailable: r.state === 'IN_STOCK',
    pickupAvailable: false,
    protections: [],
    observedAt: now().toISOString(),
    ...r,
  };
}

/** GET a page or API with the identifying user agent; throws BlockedError on 429/403/challenges. */
export async function getText(
  ctx: AdapterContext,
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string }> {
  const res = await ctx.fetch(url, {
    ...init,
    headers: {
      'user-agent': ctx.userAgent,
      accept: 'text/html,application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  if (res.status === 429 || res.status === 403)
    throw new BlockedError(res.status, detectProtections(res.status, body));
  const protections = detectProtections(res.status, body);
  if (protections.includes('queue') || protections.includes('captcha'))
    throw new BlockedError(res.status, protections);
  if (res.status === 404) return { status: 404, body: '' };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { status: res.status, body };
}
