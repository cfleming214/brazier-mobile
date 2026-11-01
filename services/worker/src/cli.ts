import { importSets } from './catalog/pokemontcg';
import { importSealed } from './catalog/tcgcsv';
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
    default:
      console.error(
        'Usage: cli.ts catalog:sets | catalog:sealed [--groups=1,2] [--since=2025-01-01]',
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
