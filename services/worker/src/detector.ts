import type { AvailabilityResult, StockState } from '@brazier/shared';

export interface SkuSnapshot {
  last_state: StockState;
  last_price_cents: number | null;
  confirmations: number;
  last_in_stock_at: string | null;
  last_out_of_stock_at: string | null;
}

export interface DetectorOptions {
  /** A SKU must have been out of stock at least this long before a new alert (flapping guard). */
  minOutOfStockMs: number;
}

export const DEFAULT_DETECTOR: DetectorOptions = { minOutOfStockMs: 10 * 60_000 };

export interface Decision {
  /** Columns to write back to retailer_skus. */
  update: Partial<SkuSnapshot> & {
    last_checked_at: string;
    marketplace_only: boolean;
    pickup_only: boolean;
  };
  /** Schedule an immediate second read before trusting an in-stock flip. */
  needsConfirmation: boolean;
  /** stock_events row to append, if anything changed. */
  event: {
    prev_state: StockState;
    new_state: StockState;
    price_cents: number | null;
    suppressed_reason: string | null;
  } | null;
  /** True when the notifier should consider alerting watchers. */
  alert: boolean;
}

const ALERTABLE: StockState[] = ['IN_STOCK', 'PREORDER'];

/**
 * Turn one availability reading into a state update, an optional stock event and an alert decision.
 * Rules (BUILD_PLAN section 5.1):
 *  - An out-of-stock -> in-stock/preorder flip needs a confirming second read.
 *  - If the confirming read disagrees, record a suppressed "unconfirmed" event and reset.
 *  - Price-only changes update the price but never create an event.
 *  - If the SKU went out of stock less than minOutOfStockMs ago, record "flapping" without alerting.
 *  - UNKNOWN readings (page didn't parse) only touch last_checked_at.
 */
export function decide(
  prev: SkuSnapshot,
  r: AvailabilityResult,
  opts: DetectorOptions = DEFAULT_DETECTOR,
): Decision {
  const at = r.observedAt;
  const base = {
    last_checked_at: at,
    marketplace_only: r.marketplaceOnly,
    pickup_only: !r.shipAvailable && r.pickupAvailable,
  };

  if (r.state === 'UNKNOWN') {
    return { update: base, needsConfirmation: false, event: null, alert: false };
  }

  const wasAlertable = ALERTABLE.includes(prev.last_state);
  const nowAlertable = ALERTABLE.includes(r.state);

  // Waiting on a confirmation read.
  if (prev.confirmations > 0 && !wasAlertable) {
    if (!nowAlertable) {
      return {
        update: { ...base, confirmations: 0, last_state: r.state, last_price_cents: r.priceCents },
        needsConfirmation: false,
        event: {
          prev_state: prev.last_state,
          new_state: 'IN_STOCK',
          price_cents: r.priceCents,
          suppressed_reason: 'unconfirmed',
        },
        alert: false,
      };
    }
    const outSince = prev.last_out_of_stock_at
      ? Date.parse(at) - Date.parse(prev.last_out_of_stock_at)
      : Infinity;
    const flapping = prev.last_in_stock_at != null && outSince < opts.minOutOfStockMs;
    return {
      update: {
        ...base,
        confirmations: 0,
        last_state: r.state,
        last_price_cents: r.priceCents,
        last_in_stock_at: at,
      },
      needsConfirmation: false,
      event: {
        prev_state: prev.last_state,
        new_state: r.state,
        price_cents: r.priceCents,
        suppressed_reason: flapping ? 'flapping' : null,
      },
      alert: !flapping,
    };
  }

  // Fresh flip to in stock: confirm first.
  if (!wasAlertable && nowAlertable) {
    return {
      update: { ...base, confirmations: 1 },
      needsConfirmation: true,
      event: null,
      alert: false,
    };
  }

  // Back out of stock (or delisted).
  if (wasAlertable && !nowAlertable) {
    return {
      update: {
        ...base,
        confirmations: 0,
        last_state: r.state,
        last_price_cents: r.priceCents,
        last_out_of_stock_at: at,
      },
      needsConfirmation: false,
      event: {
        prev_state: prev.last_state,
        new_state: r.state,
        price_cents: r.priceCents,
        suppressed_reason: null,
      },
      alert: false,
    };
  }

  // Other state changes without an alert (e.g. OUT_OF_STOCK -> DELISTED, IN_STOCK -> PREORDER).
  if (prev.last_state !== r.state) {
    return {
      update: {
        ...base,
        last_state: r.state,
        last_price_cents: r.priceCents,
        ...(prev.last_state === 'UNKNOWN' && !nowAlertable ? { last_out_of_stock_at: at } : {}),
      },
      needsConfirmation: false,
      event: {
        prev_state: prev.last_state,
        new_state: r.state,
        price_cents: r.priceCents,
        suppressed_reason: null,
      },
      alert: false,
    };
  }

  // Same state: price-only change or nothing.
  return {
    update: { ...base, last_price_cents: r.priceCents },
    needsConfirmation: false,
    event: null,
    alert: false,
  };
}
