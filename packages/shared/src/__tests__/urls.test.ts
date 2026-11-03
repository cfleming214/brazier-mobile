import { describe, expect, it } from 'vitest';
import { parseRetailerUrl } from '../urls';

const ok = (url: string, retailer: string, sku: string) => {
  const r = parseRetailerUrl(url);
  expect(r.ok, url).toBe(true);
  if (r.ok) expect(r.ref).toMatchObject({ retailer, sku });
};

describe('parseRetailerUrl', () => {
  it('Best Buy', () => {
    ok(
      'https://www.bestbuy.com/site/pokemon-destined-rivals-booster-bundle/6624827.p?skuId=6624827',
      'bestbuy',
      '6624827',
    );
    ok('https://www.bestbuy.com/site/some-name/6624827.p', 'bestbuy', '6624827');
    ok('bestbuy.com/site/x/6624827.p?skuId=6624827&intl=nosplash', 'bestbuy', '6624827');
  });
  it('Target', () => {
    ok(
      'https://www.target.com/p/pokemon-prismatic-evolutions-etb/-/A-93954435',
      'target',
      '93954435',
    );
    ok('https://www.target.com/p/-/A-93954435#lnk=sametab', 'target', '93954435');
    ok('https://www.target.com/p/x/-/A-93954435?preselect=93954435', 'target', '93954435');
  });
  it('Walmart', () => {
    ok('https://www.walmart.com/ip/Pokemon-Prismatic-ETB/13816151308', 'walmart', '13816151308');
    ok('https://www.walmart.com/ip/13816151308?athbdg=L1600', 'walmart', '13816151308');
  });
  it('GameStop', () => {
    ok(
      'https://www.gamestop.com/toys-games/trading-cards/products/pokemon-etb/20012345.html',
      'gamestop',
      '20012345',
    );
  });
  it('Pokémon Center', () => {
    ok(
      'https://www.pokemoncenter.com/product/10-10037-118/pokemon-tcg-elite-trainer-box',
      'pokemoncenter',
      '10-10037-118',
    );
  });
  it('Amazon', () => {
    ok('https://www.amazon.com/Pokemon-Cards-ETB/dp/B0DLPL7LC5/ref=sr_1_1', 'amazon', 'B0DLPL7LC5');
    ok('https://www.amazon.com/gp/product/b0dlpl7lc5', 'amazon', 'B0DLPL7LC5');
  });
  it('TCGplayer', () => {
    ok(
      'https://www.tcgplayer.com/product/593355/pokemon-sv-prismatic-evolutions-etb',
      'tcgplayer',
      '593355',
    );
  });
  it('finds a link inside shared text', () => {
    ok(
      'Check this out! https://www.target.com/p/x/-/A-93954435 via the Target app',
      'target',
      '93954435',
    );
  });
  it('rejects unsupported and malformed links', () => {
    expect(parseRetailerUrl('https://www.ebay.com/itm/12345')).toEqual({
      ok: false,
      reason: 'unsupported_retailer',
    });
    expect(parseRetailerUrl('not a link')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseRetailerUrl('https://www.target.com/c/pokemon-cards')).toMatchObject({
      ok: false,
      reason: 'no_product_id',
      retailer: 'target',
    });
  });
});
