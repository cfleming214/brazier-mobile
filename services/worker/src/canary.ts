/**
 * Nightly live canaries (DROP-64): ONE polite real request per configured adapter and calendar feed,
 * to catch parser breakage from site or API changes before users miss alerts.
 *
 * A failing adapter is flipped to `degraded` in adapter_health (Radar shows it) and the run exits 1
 * with a JSON report the GitHub workflow turns into an `adapter-broken` issue. A rate limit or
 * challenge is reported as "blocked", not retried.
 */
import type { RetailerAdapter, RetailerSlug } from '@drophawk/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BlockedError } from './adapters/protections';
import { parseFeed } from './calendar/extract';
import type { FeedConfig } from './calendar/sources';

export interface CanaryTarget {
  retailer: RetailerSlug;
  sku: string;
  url?: string;
}

export type CanaryOutcome = 'ok' | 'parser_broken' | 'blocked' | 'error' | 'skipped';

export interface CanaryResult {
  kind: 'adapter' | 'feed';
  name: string;
  outcome: CanaryOutcome;
  detail: string;
}

/** A canary SKU is a long-lived catalog product, so it must parse to a definite state. */
export async function checkAdapter(
  adapter: RetailerAdapter | undefined,
  t: CanaryTarget,
): Promise<CanaryResult> {
  const name = t.retailer;
  if (!adapter) return { kind: 'adapter', name, outcome: 'skipped', detail: 'not configured' };
  try {
    const [r] = await adapter.fetchAvailability([t]);
    if (!r)
      return { kind: 'adapter', name, outcome: 'parser_broken', detail: 'no result returned' };
    if (r.state === 'UNKNOWN')
      return {
        kind: 'adapter',
        name,
        outcome: 'parser_broken',
        detail: 'page or API no longer parses (UNKNOWN)',
      };
    if (r.state === 'DELISTED')
      return {
        kind: 'adapter',
        name,
        outcome: 'parser_broken',
        detail: `canary SKU ${t.sku} reads as DELISTED`,
      };
    return { kind: 'adapter', name, outcome: 'ok', detail: `${r.state}` };
  } catch (e) {
    if (e instanceof BlockedError)
      return {
        kind: 'adapter',
        name,
        outcome: 'blocked',
        detail: `HTTP ${e.status} ${e.protections.join(',')}`,
      };
    const msg = e instanceof Error ? e.message : String(e);
    if (/not set/i.test(msg)) return { kind: 'adapter', name, outcome: 'skipped', detail: msg };
    return { kind: 'adapter', name, outcome: 'error', detail: msg };
  }
}

export async function checkFeed(
  fetchText: (url: string) => Promise<string>,
  f: FeedConfig,
): Promise<CanaryResult> {
  try {
    const items = parseFeed(await fetchText(f.url));
    return items.length > 0
      ? { kind: 'feed', name: f.source, outcome: 'ok', detail: `${items.length} items` }
      : {
          kind: 'feed',
          name: f.source,
          outcome: 'parser_broken',
          detail: 'feed parsed to 0 items',
        };
  } catch (e) {
    return {
      kind: 'feed',
      name: f.source,
      outcome: 'error',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export const isFailure = (r: CanaryResult) =>
  r.outcome === 'parser_broken' || r.outcome === 'error';

/** Flip broken adapters to degraded so Radar and the poller's health view reflect it. */
export async function markDegraded(db: SupabaseClient, results: CanaryResult[]) {
  for (const r of results.filter((x) => x.kind === 'adapter' && isFailure(x))) {
    await db
      .from('adapter_health')
      .update({
        status: 'degraded',
        last_error: `canary: ${r.detail}`,
        updated_at: new Date().toISOString(),
      })
      .eq('retailer_id', r.name);
  }
}

/** Markdown body for the GitHub issue. */
export function issueBody(results: CanaryResult[]): string {
  const rows = results.map(
    (r) => `| ${r.kind} | ${r.name} | ${r.outcome} | ${r.detail.replace(/\|/g, '/')} |`,
  );
  return [
    'The nightly canary found adapters or calendar feeds that no longer parse.',
    '',
    '| Kind | Name | Outcome | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'Broken adapters were set to `degraded`. Re-record fixtures (`services/worker/scripts/record-fixtures.ts`), fix the parser, and confirm with the contract tests.',
  ].join('\n');
}
