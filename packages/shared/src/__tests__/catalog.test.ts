import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  detectProductType,
  normalizeTitle,
  scoreMatch,
  type MatchCandidate,
} from '../catalog';

const catalog: MatchCandidate[] = [
  {
    id: 'pre-etb',
    name: 'Prismatic Evolutions Elite Trainer Box',
    setName: 'Prismatic Evolutions',
    productType: 'etb',
    upc: '0820650859250',
  },
  {
    id: 'pre-bndl',
    name: 'Prismatic Evolutions Booster Bundle',
    setName: 'Prismatic Evolutions',
    productType: 'booster_bundle',
    upc: null,
  },
  {
    id: 'jtg-etb',
    name: 'Journey Together Elite Trainer Box',
    setName: 'Journey Together',
    productType: 'etb',
    upc: null,
  },
  {
    id: 'meg-pc-etb',
    name: 'Mega Evolution Pokémon Center Elite Trainer Box',
    setName: 'Mega Evolution',
    productType: 'etb',
    upc: null,
  },
];

describe('normalizeTitle', () => {
  it('strips brand noise and unifies ETB', () => {
    expect(
      normalizeTitle(
        'Pokémon Trading Card Game: Scarlet & Violet—Prismatic Evolutions Elite Trainer Box',
      ),
    ).toBe('prismatic evolutions etb');
    expect(normalizeTitle('Pokemon TCG: SV8.5 Prismatic Evolutions ETB')).toBe(
      'prismatic evolutions etb',
    );
  });
  it('maps Pokémon Center to pc', () => {
    expect(normalizeTitle('Mega Evolution Pokémon Center Elite Trainer Box')).toBe(
      'mega evolution pc etb',
    );
  });
});

describe('detectProductType', () => {
  it.each([
    ['Prismatic Evolutions Elite Trainer Box', 'etb'],
    ['Destined Rivals Booster Bundle', 'booster_bundle'],
    ['Phantasmal Flames Booster Display Box (36 Packs)', 'booster_box'],
    ['Pokémon TCG: Paldean Friends Tin', 'tin'],
    ['Pokemon Prismatic Evolutions Super-Premium Collection', 'collection'],
    ['Pokemon 3-Pack Blister', 'blister'],
  ])('%s -> %s', (title, type) => {
    expect(detectProductType(title)).toBe(type);
  });
});

describe('bestMatch', () => {
  it('matches on UPC regardless of title', () => {
    expect(bestMatch({ title: 'whatever', upc: '820650859250' }, catalog)).toEqual({
      productId: 'pre-etb',
      score: 1,
      reason: 'upc',
    });
  });
  it('matches retailer titles to the right ETB', () => {
    const r = bestMatch(
      {
        title: 'Pokémon Trading Card Game: Scarlet & Violet Prismatic Evolutions Elite Trainer Box',
      },
      catalog,
    );
    expect(r.productId).toBe('pre-etb');
    expect(r.score).toBeGreaterThanOrEqual(0.8);
  });
  it('does not confuse an ETB with a booster bundle from the same set', () => {
    expect(
      bestMatch({ title: 'Pokemon Prismatic Evolutions Booster Bundle' }, catalog).productId,
    ).toBe('pre-bndl');
  });
  it('sends weak matches to review', () => {
    const r = bestMatch({ title: 'Pokemon Surging Sparks Elite Trainer Box' }, catalog);
    expect(r.productId).toBeNull();
    expect(r.reason).toBe('none');
  });
  it('penalizes a type mismatch', () => {
    const etb = catalog[0]!;
    expect(scoreMatch({ title: 'Prismatic Evolutions Booster Bundle' }, etb)).toBeLessThan(0.5);
  });
});
