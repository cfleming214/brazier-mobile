import { importSets } from './catalog/pokemontcg';
import { importSealed } from './catalog/tcgcsv';
import { writeFileSync } from 'node:fs';
import type { RetailerPolicy, RetailerSlug } from '@brazier/shared';
import { buildAdapters, POLLED_RETAILERS } from './adapters/registry';
import {
  checkAdapter,
  checkFeed,
  isFailure,
  issueBody,
  markDegraded,
  type CanaryTarget,
} from './canary';
import { loadConfig } from './config';
import { createServiceClient } from './db';
import { createFetchJson } from './http';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const db = createServiceClient(config);
  const fetchJson = createFetchJson(config.USER_AGENT);
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  switch (command) {
    case 'catalog:sets': {
      const r = await importSets({
        fetchJson,
        db,
        baseUrl: config.POKEMONTCG_BASE_URL,
        apiKey: config.POKEMONTCG_API_KEY,
      });
      console.log(`Upserted ${r.upserted} sets`);
      break;
    }
    case 'catalog:sealed': {
      const groups = flag('groups')?.split(',').map(Number);
      const r = await importSealed({
        fetchJson,
        db,
        baseUrl: config.TCGCSV_BASE_URL,
        groupIds: groups,
        since: flag('since'),
      });
      console.log(
        `Groups ${r.groups}: created ${r.created}, linked ${r.linked}, skipped ${r.skipped}`,
      );
      break;
    }
    case 'canary': {
      // CANARY_SKUS='[{"retailer":"bestbuy","sku":"6624827"}, ...]' — long-lived catalog products.
      const targets = JSON.parse(process.env.CANARY_SKUS ?? '[]') as CanaryTarget[];
      const { data: rows } = await db.from('retailers').select('id, policy');
      const policies = new Map(
        (rows ?? []).map((r) => [r.id as RetailerSlug, r.policy as RetailerPolicy]),
      );
      const adapters = buildAdapters({ ...config, FAKE_RETAILER_URL: undefined }, policies, {
        userAgent: config.USER_AGENT,
        fetch,
      });
      const results = [];
      for (const t of targets.filter((x) => POLLED_RETAILERS.includes(x.retailer))) {
        const a = adapters.get(t.retailer);
        results.push(await checkAdapter(a?.policy.enabled ? a : undefined, t));
      }
      const fetchText = async (url: string) => {
        const res = await fetch(url, { headers: { 'user-agent': config.USER_AGENT } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      };
      for (const f of config.CALENDAR_FEEDS) results.push(await checkFeed(fetchText, f));
      await markDegraded(db, results);
      for (const r of results)
        console.log(`${r.outcome.padEnd(13)} ${r.kind} ${r.name}: ${r.detail}`);
      writeFileSync('canary-report.json', JSON.stringify(results, null, 2));
      if (results.some(isFailure)) {
        writeFileSync('canary-issue.md', issueBody(results));
        process.exit(1);
      }
      break;
    }
    default:
      console.error(
        'Usage: cli.ts catalog:sets | catalog:sealed [--groups=1,2] [--since=2025-01-01] | canary',
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
