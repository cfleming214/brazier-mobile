import { beforeAll, describe, expect, it } from 'vitest';
import { importSets, mapSet } from '../catalog/pokemontcg';
import { importSealed, isSealed, setNameFromGroup, toSealedCandidates } from '../catalog/tcgcsv';
import sets from './fixtures/pokemontcg-sets.json';
import groups from './fixtures/tcgcsv-groups.json';
import pre from './fixtures/tcgcsv-products-23821.json';
import jtg from './fixtures/tcgcsv-products-24073.json';
import { fixtureFetch, hasDb, testDb } from './helpers';

describe('pokemontcg mapping', () => {
  it('maps API sets to rows', () => {
    expect(mapSet(sets.data[0]!)).toEqual({
      id: 'sv8pt5',
      category_id: 'pokemon_tcg',
      name: 'Prismatic Evolutions',
      series: 'Scarlet & Violet',
      release_date: '2025-01-17',
      logo_url: 'https://images.pokemontcg.io/sv8pt5/logo.png',
    });
    expect(mapSet(sets.data[2]!).logo_url).toBeNull();
  });
});

describe('tcgcsv mapping', () => {
  it('strips set code prefixes from group names', () => {
    expect(setNameFromGroup('SV: Prismatic Evolutions')).toBe('Prismatic Evolutions');
    expect(setNameFromGroup('SV09: Journey Together')).toBe('Journey Together');
    expect(setNameFromGroup('SV08.5: Prismatic Evolutions')).toBe('Prismatic Evolutions');
    expect(setNameFromGroup('ME01: Mega Evolution')).toBe('Mega Evolution');
  });
  it('keeps sealed products and drops singles and code cards', () => {
    expect(pre.results.filter(isSealed).map((p) => p.productId)).toEqual([593355, 600518]);
  });
  it('extracts UPC and product type', () => {
    const c = toSealedCandidates(groups.results[0]!, pre.results);
    expect(c[1]).toMatchObject({
      productType: 'collection',
      upc: '0820650859805',
      setName: 'Prismatic Evolutions',
    });
    expect(c[0]).toMatchObject({
      productType: 'etb',
      tcgplayerId: '593355',
      releaseDate: '2025-01-17',
    });
  });
});

describe.skipIf(!hasDb)('catalog import against local Supabase', () => {
  let db: ReturnType<typeof testDb>;
  beforeAll(() => {
    db = testDb();
  });

  it('upserts sets idempotently', async () => {
    const fetchJson = fixtureFetch({ '/sets': sets });
    expect(await importSets({ fetchJson, db, baseUrl: 'https://api.test/v2' })).toEqual({
      upserted: 3,
    });
    expect(await importSets({ fetchJson, db, baseUrl: 'https://api.test/v2' })).toEqual({
      upserted: 3,
    });
    const { count } = await db
      .from('card_sets')
      .select('*', { count: 'exact', head: true })
      .in('id', ['sv8pt5', 'sv9', 'sv10']);
    expect(count).toBe(3);
  });

  it('links existing products and creates new sealed ones', async () => {
    const fetchJson = fixtureFetch({
      '/3/groups': groups,
      '/3/23821/products': pre,
      '/3/24073/products': jtg,
    });
    const r = await importSealed({ fetchJson, db, baseUrl: 'https://tcgcsv.test/tcgplayer' });
    expect(r.groups).toBe(2);
    // Prismatic ETB already exists in the seed -> linked; SPC and JTG bundle are new.
    expect(r.linked).toBeGreaterThanOrEqual(1);

    const { data: link } = await db
      .from('retailer_skus')
      .select('product_id')
      .eq('retailer_id', 'tcgplayer')
      .eq('retailer_sku', '593355')
      .single();
    expect(link?.product_id).toBe('11111111-1111-4111-8111-111111111101');

    const { data: spc } = await db
      .from('products')
      .select('name, upc, product_type')
      .eq('upc', '0820650859805')
      .single();
    expect(spc).toMatchObject({ product_type: 'collection' });

    // Running again creates nothing new.
    const again = await importSealed({ fetchJson, db, baseUrl: 'https://tcgcsv.test/tcgplayer' });
    expect(again.created).toBe(0);
  });
});
