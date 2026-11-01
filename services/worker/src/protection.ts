import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProtectionChange {
  retailer: string;
  skuId: string | null;
  protection: string;
  active: boolean;
}

const retailerName: Record<string, string> = {
  bestbuy: 'Best Buy',
  walmart: 'Walmart',
  target: 'Target',
  gamestop: 'GameStop',
  pokemoncenter: 'Pokémon Center',
  amazon: 'Amazon',
};

/** Human-readable notification text for a protection change (DROP-91). */
export function describeProtection(
  c: ProtectionChange,
  productName: string,
): { title: string; body: string } {
  const store = retailerName[c.retailer] ?? c.retailer;
  if (!c.active) {
    return {
      title: `${store} is back to normal`,
      body: `${store} removed the ${label(c.protection)} for ${productName}.`,
    };
  }
  const limit = /^limit:(\d+)$/.exec(c.protection);
  if (limit)
    return {
      title: `${store} added a purchase limit`,
      body: `${store} now limits ${productName} to ${limit[1]} per customer.`,
    };
  const bodies: Record<string, string> = {
    queue: `${store} turned on its queue for ${productName}. You'll need to wait in line yourself.`,
    captcha: `${store} added a human check for ${productName}. You'll need to complete it yourself.`,
    signin_required: `${store} now requires you to sign in to add ${productName} to your cart.`,
    raffle: `${store} switched ${productName} to a raffle. Enter on ${store}'s site or app.`,
    app_only: `${store} is selling ${productName} in its app only.`,
    in_store_only: `${store} is selling ${productName} in stores only.`,
    ratelimit: `${store} is slowing down our checks. Alerts for ${productName} may be a little slower.`,
    blocked: `${store} is blocking our checks right now. Alerts for ${productName} may be delayed.`,
  };
  return {
    title: `${store}: ${label(c.protection)} is on`,
    body: bodies[c.protection] ?? `${store} changed how ${productName} is sold.`,
  };
}

function label(p: string): string {
  if (p.startsWith('limit:')) return 'purchase limit';
  return (
    (
      {
        queue: 'queue',
        captcha: 'human check',
        signin_required: 'sign-in requirement',
        raffle: 'raffle',
        app_only: 'app-only sale',
        in_store_only: 'in-store-only sale',
        ratelimit: 'rate limit',
        blocked: 'block',
      } as Record<string, string>
    )[p] ?? p
  );
}

/**
 * Debounces protection signals: a protection must be seen on `confirmChecks` consecutive checks
 * before it counts as on, and be absent for `clearMs` before it counts as off.
 */
export class ProtectionTracker {
  private pending = new Map<string, number>();
  private active = new Map<string, { since: number; missingSince: number | null }>();
  constructor(
    private db: SupabaseClient | null,
    private opts = { confirmChecks: 2, clearMs: 5 * 60_000 },
    private now: () => number = Date.now,
  ) {}

  private key(retailer: string, skuId: string | null, p: string) {
    return `${retailer}|${skuId ?? ''}|${p}`;
  }

  /** Feed the protections seen on one check; returns confirmed changes. */
  async observe(
    retailer: string,
    skuId: string | null,
    seen: string[],
  ): Promise<ProtectionChange[]> {
    const changes: ProtectionChange[] = [];
    const t = this.now();
    for (const p of seen) {
      const k = this.key(retailer, skuId, p);
      const a = this.active.get(k);
      if (a) {
        a.missingSince = null;
        continue;
      }
      const n = (this.pending.get(k) ?? 0) + 1;
      this.pending.set(k, n);
      if (n >= this.opts.confirmChecks) {
        this.pending.delete(k);
        this.active.set(k, { since: t, missingSince: null });
        changes.push({ retailer, skuId, protection: p, active: true });
      }
    }
    for (const [k, a] of this.active) {
      const [r, s, p] = k.split('|');
      if (r !== retailer || (s || null) !== skuId || seen.includes(p!)) continue;
      a.missingSince ??= t;
      if (t - a.missingSince >= this.opts.clearMs) {
        this.active.delete(k);
        changes.push({ retailer, skuId, protection: p!, active: false });
      }
    }
    for (const k of [...this.pending.keys()]) {
      const [r, s, p] = k.split('|');
      if (r === retailer && (s || null) === skuId && !seen.includes(p!)) this.pending.delete(k);
    }
    if (this.db && changes.length) {
      await this.db.from('protection_events').insert(
        changes.map((c) => ({
          retailer_id: c.retailer,
          retailer_sku_id: c.skuId,
          protection: c.protection,
          active: c.active,
        })),
      );
    }
    return changes;
  }

  activeFor(retailer: string): string[] {
    return [
      ...new Set(
        [...this.active.keys()]
          .filter((k) => k.startsWith(`${retailer}|`))
          .map((k) => k.split('|')[2]!),
      ),
    ];
  }
}
