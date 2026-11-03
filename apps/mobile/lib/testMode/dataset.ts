/**
 * Test-mode dataset: 20 real Pokémon TCG retail products and the four retailers that stock them.
 *
 * Researched 2026-11-02. Real data: product names, sets, MSRPs, UPCs, release dates, photo URLs,
 * and each retailer's SKU/ASIN/item ID, product page URL and the listed price seen that day.
 * A null field means it couldn't be confirmed (nothing is guessed). Where a retailer showed no
 * price, the listing uses MSRP. Listings priced above MSRP were third-party marketplace sellers
 * and are flagged marketplace_only.
 *
 * Synthetic data (for exercising tracking): each listing's stock state, quantity and check time.
 */
export type StockState = 'UNKNOWN' | 'OUT_OF_STOCK' | 'IN_STOCK' | 'PREORDER' | 'DELISTED';
export type ProductType = 'etb' | 'booster_bundle' | 'booster_box' | 'collection' | 'tin' | 'blister' | 'other';
/** Retailer ids match public.retailers.id in Supabase. */
export type TestRetailerId = 'bestbuy' | 'walmart' | 'amazon' | 'pokemoncenter';

export type Category = { id: string; name: string };
export type Retailer = {
  id: TestRetailerId;
  name: string;
  website_url: string;
  /** Same RetailerPolicy values as supabase/seed.sql. */
  policy: Record<string, unknown>;
  /** Synthetic adapter_health numbers. */
  health: { latency_ms: number; success_rate: number; checks_per_min: number };
};
export type Product = {
  id: string;
  category_id: string;
  name: string;
  set_name: string | null;
  product_type: ProductType;
  upc: string | null;
  msrp_cents: number;
  image_url: string;
  release_date: string | null;
  exclusive_retailer_id: TestRetailerId | null;
};
export type Listing = {
  id: string;
  product_id: string;
  retailer_id: TestRetailerId;
  retailer_sku: string;
  url: string;
  last_state: StockState;
  last_price_cents: number;
  marketplace_only: boolean;
  quantity_available: number;
  last_checked_at: string;
};

export const CATEGORIES: Category[] = [{ id: 'pokemon_tcg', name: 'Pokémon TCG' }];

export const RETAILERS: Retailer[] = [
  {
    id: 'bestbuy',
    name: 'Best Buy',
    website_url: 'https://www.bestbuy.com',
    policy: { enabled: true, maxRequestsPerMinute: 120, allowedEndpoints: ['api.bestbuy.com/v1'], automationAllowed: true, backoffSeconds: 120 },
    health: { latency_ms: 240, success_rate: 0.99, checks_per_min: 96 },
  },
  {
    id: 'walmart',
    name: 'Walmart',
    website_url: 'https://www.walmart.com',
    policy: { enabled: true, maxRequestsPerMinute: 60, allowedEndpoints: ['developer.api.walmart.com'], automationAllowed: true, backoffSeconds: 120 },
    health: { latency_ms: 410, success_rate: 0.97, checks_per_min: 48 },
  },
  {
    id: 'amazon',
    name: 'Amazon',
    website_url: 'https://www.amazon.com',
    policy: { enabled: false, maxRequestsPerMinute: 60, allowedEndpoints: ['webservices.amazon.com'], automationAllowed: false, backoffSeconds: 120 },
    health: { latency_ms: 320, success_rate: 0.98, checks_per_min: 40 },
  },
  {
    id: 'pokemoncenter',
    name: 'Pokémon Center',
    website_url: 'https://www.pokemoncenter.com',
    policy: { enabled: true, maxRequestsPerMinute: 6, allowedEndpoints: ['www.pokemoncenter.com/product/'], automationAllowed: true, backoffSeconds: 600 },
    health: { latency_ms: 780, success_rate: 0.93, checks_per_min: 6 },
  },
];

const PKMN = 'https://www.pokemon.com/static-assets/content-assets/cms2/img/trading-card-game/series/incrementals';
const BBY = 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products';

/** [sku, url, price in cents or null] per retailer. */
type Offer = [sku: string, url: string, priceCents: number | null];
type Raw = Omit<Product, 'id' | 'category_id'> & { offers: Partial<Record<TestRetailerId, Offer>> };

const RAW: Raw[] = [
  {
    name: 'Pokémon TCG: Scarlet & Violet—Prismatic Evolutions Elite Trainer Box',
    set_name: 'Prismatic Evolutions', product_type: 'etb', msrp_cents: 4999, upc: '196214105133', release_date: '2025-01-17',
    image_url: `${PKMN}/2025/sv8pt5-elite-trainer-box/sv8pt5-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['6606082', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-prismatic-evolutions-elite-trainer-box/JJG2TLCW3L', 4999],
      walmart: ['13816151308', 'https://www.walmart.com/ip/13816151308', 12649],
    },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—Prismatic Evolutions Booster Bundle',
    set_name: 'Prismatic Evolutions', product_type: 'booster_bundle', msrp_cents: 2694, upc: '196214112544', release_date: '2025-03-07',
    image_url: `${PKMN}/2025/sv8pt5-booster-bundle/sv8pt5-booster-bundle-169-en.png`, exclusive_retailer_id: null,
    offers: { amazon: ['B0DN98RVZM', 'https://www.amazon.com/dp/B0DN98RVZM', 8999] },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—Prismatic Evolutions Super-Premium Collection',
    set_name: 'Prismatic Evolutions', product_type: 'collection', msrp_cents: 8999, upc: null, release_date: '2025-05-16',
    image_url: `${PKMN}/2025/sv8pt5-super-premium-collection/sv8pt5-super-premium-collection-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['12238574', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-prismatic-evolutions-super-premium-collection/JJG2TL23CW/sku/12238574', null],
      pokemoncenter: ['10-10027-101', 'https://www.pokemoncenter.com/product/10-10027-101/pokemon-tcg-scarlet-and-violet-prismatic-evolutions-super-premium-collection', 8999],
    },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—Journey Together Elite Trainer Box',
    set_name: 'Journey Together', product_type: 'etb', msrp_cents: 4999, upc: '196214108554', release_date: '2025-03-28',
    image_url: `${PKMN}/2025/sv09-elite-trainer-box/sv09-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['6614267', 'https://www.bestbuy.com/site/pokemon-trading-card-game-scarlet-violet-journey-together-elite-trainer-box/6614267.p?skuId=6614267', null],
      walmart: ['15156564532', 'https://www.walmart.com/ip/15156564532', 14999],
      amazon: ['B0DSLY7DZZ', 'https://www.amazon.com/dp/B0DSLY7DZZ', null],
    },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—Destined Rivals Elite Trainer Box',
    set_name: 'Destined Rivals', product_type: 'etb', msrp_cents: 4999, upc: '196214111523', release_date: '2025-05-30',
    image_url: `${PKMN}/2025/sv10-elite-trainer-box/sv10-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['12937189', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-destined-rivals-elite-trainer-box/JJG2TL22PF', 14999],
      walmart: ['15718673510', 'https://www.walmart.com/ip/15718673510', 10924],
    },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—Black Bolt Elite Trainer Box',
    set_name: 'Black Bolt', product_type: 'etb', msrp_cents: 5999, upc: null, release_date: '2025-07-18',
    image_url: `${BBY}/30b88e0d-e2dd-4a03-a04f-58e518d87c5b.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['13239825', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-black-bolt-elite-trainer-box/JJG2TL284R', 13999],
      walmart: ['16498668973', 'https://www.walmart.com/ip/16498668973', 17999],
    },
  },
  {
    name: 'Pokémon TCG: Scarlet & Violet—White Flare Elite Trainer Box',
    set_name: 'White Flare', product_type: 'etb', msrp_cents: 5999, upc: null, release_date: '2025-07-18',
    image_url: `${BBY}/7b13a88b-750a-4a77-a42f-0882982f36ca.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['10202245', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-white-flare-elite-trainer-box/JJG2TL28KK', 21000],
      walmart: ['16446322202', 'https://www.walmart.com/ip/16446322202', 16499],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution Elite Trainer Box',
    set_name: 'Mega Evolution', product_type: 'etb', msrp_cents: 4999, upc: null, release_date: '2025-09-26',
    image_url: `${PKMN}/2025/me01-elite-trainer-box/me01-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['6639103', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-elite-trainer-box-styles-may-vary/JJG2TL2LWZ', 4999],
      walmart: ['17328862239', 'https://www.walmart.com/ip/17328862239', 13798],
      amazon: ['B0FH6KRSX8', 'https://www.amazon.com/dp/B0FH6KRSX8', null],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Phantasmal Flames Elite Trainer Box',
    set_name: 'Phantasmal Flames', product_type: 'etb', msrp_cents: 4999, upc: '196214124813', release_date: '2025-11-14',
    image_url: `${PKMN}/2025/me02-elite-trainer-box/me02-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['6645345', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-phantasmal-flames-elite-trainer-box/JJG2TL2VT6', 4999],
      walmart: ['17780209250', 'https://www.walmart.com/ip/17780209250', 15977],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Phantasmal Flames Booster Bundle (6 Packs)',
    set_name: 'Phantasmal Flames', product_type: 'booster_bundle', msrp_cents: 2694, upc: '196214143371', release_date: '2025-11-14',
    image_url: `${BBY}/f81c6345-500b-4b7c-9875-173ec0f848f5.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['6645343', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-phantasmal-flames-6pk-booster-bundle/JJG2TL3XY4', 2694],
      walmart: ['17785924366', 'https://www.walmart.com/ip/17785924366', null],
      amazon: ['B0FPLLR939', 'https://www.amazon.com/dp/B0FPLLR939', null],
      pokemoncenter: ['10-10191-109', 'https://www.pokemoncenter.com/product/10-10191-109/pokemon-tcg-mega-evolution-phantasmal-flames-booster-bundle-6-packs', 2694],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Phantasmal Flames Booster Display Box (36 Packs)',
    set_name: 'Phantasmal Flames', product_type: 'booster_box', msrp_cents: 16164, upc: '196214143357', release_date: '2025-11-14',
    image_url: `${BBY}/b00aa00c-a94d-405a-a425-d02494bb3616.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['11563087', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-phantasmal-flames-booster-box-36-packs/JJG2TL3XYR/sku/11563087', null],
      pokemoncenter: ['10-10190-119', 'https://www.pokemoncenter.com/product/10-10190-119/pokemon-tcg-mega-evolution-phantasmal-flames-booster-display-box-36-packs', 16164],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Phantasmal Flames 3 Booster Packs & Sneasel Promo Card',
    set_name: 'Phantasmal Flames', product_type: 'blister', msrp_cents: 1399, upc: null, release_date: null,
    image_url: `${BBY}/08d9c07b-6589-440e-8882-ff08c24c15cc.jpg`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['11563078', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-phantasmal-flames-3pk-booster-styles-may-vary/JJG2TL3XLQ', null],
      pokemoncenter: ['10-10187-108', 'https://www.pokemoncenter.com/product/10-10187-108', 1399],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Ascended Heroes Elite Trainer Box',
    set_name: 'Ascended Heroes', product_type: 'etb', msrp_cents: 4999, upc: null, release_date: '2026-02-20',
    image_url: `${PKMN}/2026/me2pt5-elite-trainer-box/me2pt5-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['12708764', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-ascended-heroes-elite-trainer-box/JJG2TLXSFV', null],
      walmart: ['18710966734', 'https://www.walmart.com/ip/18710966734', 13499],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Ascended Heroes Booster Bundle',
    set_name: 'Ascended Heroes', product_type: 'booster_bundle', msrp_cents: 2694, upc: '196214141506', release_date: '2026-04-24',
    image_url: `${PKMN}/2026/me2pt5-booster-bundle/me2pt5-booster-bundle-169-en.png`, exclusive_retailer_id: null,
    offers: { amazon: ['B0G3CV6Z9D', 'https://www.amazon.com/dp/B0G3CV6Z9D', 9228] },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Perfect Order Elite Trainer Box',
    set_name: 'Perfect Order', product_type: 'etb', msrp_cents: 4999, upc: '196214152038', release_date: '2026-03-27',
    image_url: `${PKMN}/2026/me03-elite-trainer-box/me03-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['12590382', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-perfect-order-elite-trainer-box/JJG2TL3W86', 8999],
      walmart: ['19402160990', 'https://www.walmart.com/ip/19402160990', 7699],
      amazon: ['B0GFZV1ZVV', 'https://www.amazon.com/dp/B0GFZV1ZVV', 8499],
    },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Perfect Order Booster Bundle',
    set_name: 'Perfect Order', product_type: 'booster_bundle', msrp_cents: 2694, upc: '196214150478', release_date: '2026-03-27',
    image_url: `${PKMN}/2026/me03-booster-bundle/me03-booster-bundle-169-en.png`, exclusive_retailer_id: null,
    offers: { amazon: ['B0GG11K25W', 'https://www.amazon.com/dp/B0GG11K25W', 4748] },
  },
  {
    name: 'Pokémon TCG: Mega Evolution—Chaos Rising Pokémon Center Elite Trainer Box',
    set_name: 'Chaos Rising', product_type: 'etb', msrp_cents: 5999, upc: null, release_date: '2026-05-22',
    image_url: `${PKMN}/2026/me04-pokemon-center-elite-trainer-box/me04-pokemon-center-elite-trainer-box-169-en.png`,
    exclusive_retailer_id: 'pokemoncenter',
    offers: {
      pokemoncenter: ['10-10399-112', 'https://www.pokemoncenter.com/product/10-10399-112/pokemon-tcg-mega-evolution-chaos-rising-pokemon-center-elite-trainer-box', 5999],
    },
  },
  {
    name: 'Pokémon TCG: 30th Celebration Elite Trainer Box',
    set_name: '30th Celebration', product_type: 'etb', msrp_cents: 4999, upc: null, release_date: '2026-09-16',
    image_url: `${PKMN}/2026/30th-celebration-elite-trainer-box/30th-celebration-elite-trainer-box-169-en.png`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['13138238', 'https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-elite-trainer-box/JJG2TL8XCJ', null],
      walmart: ['20640569221', 'https://www.walmart.com/ip/20640569221', 12995],
    },
  },
  {
    name: 'Pokémon TCG: Mega Charizard Tin (Mega Charizard Y)',
    set_name: 'Mega Evolution', product_type: 'tin', msrp_cents: 2199, upc: '196214147553', release_date: '2026-02-20',
    image_url: `${PKMN}/2026/mega-charizard-tin/mega-charizard-tin-169-en.png`, exclusive_retailer_id: null,
    offers: {
      amazon: ['B0G5S8VQHV', 'https://www.amazon.com/dp/B0G5S8VQHV', null],
      pokemoncenter: ['10-10300-122', 'https://www.pokemoncenter.com/product/10-10300-122/pokemon-tcg-mega-charizard-tin-mega-charizard-y', 2199],
    },
  },
  {
    name: 'Pokémon Trading Card Game Battle Academy (Armarouge ex, Pikachu ex & Darkrai ex)',
    set_name: 'Battle Academy', product_type: 'other', msrp_cents: 2499, upc: null, release_date: null,
    image_url: `${BBY}/6580/6580253_sd.jpg`, exclusive_retailer_id: null,
    offers: {
      bestbuy: ['12069503', 'https://www.bestbuy.com/product/pokemon-trading-card-game-battle-academy-2024/J3YSYH8227/sku/12069503', null],
      pokemoncenter: ['290-85695', 'https://www.pokemoncenter.com/product/290-85695/pokemon-trading-card-game-battle-academy-armarouge-ex-pikachu-ex-and-darkrai-ex', 2499],
    },
  },
];

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const productId = (i: number) => `22222222-2222-4222-8222-${pad(i + 1, 12)}`;
const listingId = (n: number) => `33333333-3333-4333-8333-${pad(n, 12)}`;

export const PRODUCTS: Product[] = RAW.map(({ offers: _offers, ...p }, i) => ({
  ...p,
  id: productId(i),
  category_id: 'pokemon_tcg',
}));

/** Fixed clock so the dataset (and tests) are deterministic. */
const CHECKED_AT = Date.parse('2026-11-02T12:00:00Z');
const RETAILER_ORDER: TestRetailerId[] = ['bestbuy', 'walmart', 'amazon', 'pokemoncenter'];

/** Synthetic stock: a stable mix of in-stock and sold-out listings with varied quantities. */
function syntheticStock(productIndex: number, retailerIndex: number) {
  const roll = (productIndex * 7 + retailerIndex * 3) % 10;
  // Pokémon Center sells out fastest.
  const inStock = retailerIndex === 3 ? roll < 3 : roll < 6;
  return {
    last_state: (inStock ? 'IN_STOCK' : 'OUT_OF_STOCK') as StockState,
    quantity_available: inStock ? 2 + ((productIndex * 13 + retailerIndex * 5) % 47) : 0,
    last_checked_at: new Date(CHECKED_AT - ((productIndex * 11 + retailerIndex * 17) % 90) * 60_000).toISOString(),
  };
}

export const LISTINGS: Listing[] = RAW.flatMap((raw, p) =>
  RETAILER_ORDER.flatMap((retailer, r) => {
    const offer = raw.offers[retailer];
    if (!offer) return [];
    const [sku, url, price] = offer;
    const last_price_cents = price ?? raw.msrp_cents;
    return [
      {
        id: '',
        product_id: productId(p),
        retailer_id: retailer,
        retailer_sku: sku,
        url,
        last_price_cents,
        marketplace_only: last_price_cents > raw.msrp_cents,
        ...syntheticStock(p, r),
      },
    ];
  }),
).map((l, n) => ({ ...l, id: listingId(n + 1) }));
