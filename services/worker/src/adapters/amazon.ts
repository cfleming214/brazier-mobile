import { createHash, createHmac } from 'node:crypto';
import type {
  AvailabilityResult,
  RetailerAdapter,
  RetailerPolicy,
  RetailerSkuRef,
} from '@drophawk/shared';
import { parseRetailerUrl } from '@drophawk/shared';
import { getText, result, type AdapterContext } from './base';

/**
 * Amazon Product Advertising API 5.0 (GetItems). Requires an Associates account with qualifying
 * sales; check whether Amazon has moved this to its newer Creators API before enabling.
 */
export interface PaapiItem {
  ASIN: string;
  ItemInfo?: { Title?: { DisplayValue?: string } };
  Offers?: {
    Listings?: {
      Availability?: { Type?: string };
      Price?: { Amount?: number };
      MerchantInfo?: { Name?: string };
    }[];
  };
}

export function mapAmazon(
  ref: RetailerSkuRef,
  item: PaapiItem | undefined,
  now?: () => Date,
): AvailabilityResult {
  const l = item?.Offers?.Listings?.[0];
  if (!item) return result(ref, { state: 'DELISTED' }, now);
  if (!l) return result(ref, { state: 'OUT_OF_STOCK' }, now);
  const type = l.Availability?.Type ?? '';
  const state = type === 'Now' ? 'IN_STOCK' : type === 'Preorderable' ? 'PREORDER' : 'OUT_OF_STOCK';
  const merchant = l.MerchantInfo?.Name ?? '';
  return result(
    ref,
    {
      state,
      priceCents: l.Price?.Amount != null ? Math.round(l.Price.Amount * 100) : null,
      marketplaceOnly: merchant !== '' && !/^amazon(\.com)?$/i.test(merchant),
    },
    now,
  );
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();

/** AWS Signature V4 headers for a PA-API POST. Exported for tests. */
export function signPaapi(opts: {
  accessKey: string;
  secretKey: string;
  body: string;
  target: string;
  date?: Date;
  host?: string;
  region?: string;
  path?: string;
}) {
  const host = opts.host ?? 'webservices.amazon.com';
  const region = opts.region ?? 'us-east-1';
  const path = opts.path ?? '/paapi5/getitems';
  const d = opts.date ?? new Date();
  const amzDate = d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': opts.target,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'POST',
    path,
    '',
    ...Object.keys(headers)
      .sort()
      .map((k) => `${k}:${headers[k]}`),
    '',
    signedHeaders,
    sha256(opts.body),
  ].join('\n');
  const scope = `${day}/${region}/ProductAdvertisingAPI/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${opts.secretKey}`, day);
  key = hmac(key, region);
  key = hmac(key, 'ProductAdvertisingAPI');
  key = hmac(key, 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function amazonAdapter(
  policy: RetailerPolicy,
  ctx: AdapterContext,
  creds: { accessKey?: string; secretKey?: string; partnerTag?: string },
): RetailerAdapter {
  return {
    slug: 'amazon',
    policy,
    parseUrl: (url) => {
      const r = parseRetailerUrl(url);
      return r.ok && r.ref.retailer === 'amazon' ? r.ref : null;
    },
    async fetchAvailability(refs) {
      if (!creds.accessKey || !creds.secretKey || !creds.partnerTag)
        throw new Error('Amazon PA-API credentials are not set');
      if (refs.length === 0) return [];
      const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
      const body = JSON.stringify({
        ItemIds: refs.map((r) => r.sku).slice(0, 10),
        PartnerTag: creds.partnerTag,
        PartnerType: 'Associates',
        Marketplace: 'www.amazon.com',
        Resources: [
          'ItemInfo.Title',
          'Offers.Listings.Availability.Type',
          'Offers.Listings.Price',
          'Offers.Listings.MerchantInfo',
        ],
      });
      const headers = signPaapi({
        accessKey: creds.accessKey,
        secretKey: creds.secretKey,
        body,
        target,
      });
      const { body: text } = await getText(ctx, 'https://webservices.amazon.com/paapi5/getitems', {
        method: 'POST',
        headers,
        body,
      });
      const json = JSON.parse(text) as { ItemsResult?: { Items?: PaapiItem[] } };
      const byAsin = new Map((json.ItemsResult?.Items ?? []).map((i) => [i.ASIN, i]));
      return refs.map((r) => mapAmazon(r, byAsin.get(r.sku), ctx.now));
    },
  };
}
