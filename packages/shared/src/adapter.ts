import type { RetailerSlug, StockState } from './domain';

/** Per-retailer rules every adapter must follow. Enforced by the worker's rate governor. */
export interface RetailerPolicy {
  /** Kill switch: when false the worker never contacts this retailer. */
  enabled: boolean;
  /** Maximum requests per minute across the whole fleet. */
  maxRequestsPerMinute: number;
  /** Host + path prefixes the adapter is allowed to call. */
  allowedEndpoints: string[];
  /** Whether cart-ready automation may run for this retailer. */
  automationAllowed: boolean;
  /** Seconds to back off after a 429/403 before retrying. */
  backoffSeconds: number;
}

export interface RetailerSkuRef {
  retailer: RetailerSlug;
  /** Retailer's own identifier: Best Buy SKU, Target TCIN, Walmart item id, etc. */
  sku: string;
  url?: string;
}

export interface AvailabilityResult {
  ref: RetailerSkuRef;
  state: StockState;
  priceCents: number | null;
  /** True when the only offers come from third-party marketplace sellers. */
  marketplaceOnly: boolean;
  shipAvailable: boolean;
  pickupAvailable: boolean;
  observedAt: string;
}

export interface RetailerListing {
  ref: RetailerSkuRef;
  title: string;
  upc: string | null;
  priceCents: number | null;
  imageUrl: string | null;
}

export interface RetailerAdapter {
  slug: RetailerSlug;
  policy: RetailerPolicy;
  parseUrl(url: string): RetailerSkuRef | null;
  fetchAvailability(refs: RetailerSkuRef[]): Promise<AvailabilityResult[]>;
  searchCatalog?(query: string): Promise<RetailerListing[]>;
}
