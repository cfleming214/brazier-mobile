import { z } from 'zod';

/** Stock state of a single retailer SKU. */
export const StockState = z.enum(['UNKNOWN', 'OUT_OF_STOCK', 'IN_STOCK', 'PREORDER', 'DELISTED']);
export type StockState = z.infer<typeof StockState>;

export const ProductType = z.enum([
  'etb',
  'booster_bundle',
  'booster_box',
  'collection',
  'tin',
  'blister',
  'other',
]);
export type ProductType = z.infer<typeof ProductType>;

export const RetailerSlug = z.enum([
  'bestbuy',
  'target',
  'walmart',
  'gamestop',
  'pokemoncenter',
  'amazon',
  'tcgplayer',
]);
export type RetailerSlug = z.infer<typeof RetailerSlug>;

export const StockEventSource = z.enum(['poll', 'api', 'feed', 'sighting']);
export type StockEventSource = z.infer<typeof StockEventSource>;

export const CalendarEventType = z.enum([
  'set_release',
  'preorder_open',
  'retailer_street_date',
  'prerelease',
  'restock_window',
  'pc_drop',
]);
export type CalendarEventType = z.infer<typeof CalendarEventType>;

export const CalendarStatus = z.enum(['rumored', 'confirmed', 'cancelled']);
export type CalendarStatus = z.infer<typeof CalendarStatus>;

export const Product = z.object({
  id: z.string().uuid(),
  categoryId: z.string(),
  name: z.string().min(1),
  setName: z.string().nullable(),
  productType: ProductType,
  upc: z.string().nullable(),
  msrpCents: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url().nullable(),
  releaseDate: z.string().nullable(),
  isExclusive: z.boolean(),
});
export type Product = z.infer<typeof Product>;

export const Watch = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  retailerIds: z.array(z.string()),
  maxPriceCents: z.number().int().positive().nullable(),
  includeMarketplace: z.boolean(),
  pickupRadiusKm: z.number().positive().nullable(),
  paused: z.boolean(),
});
export type Watch = z.infer<typeof Watch>;

/** Input when a user creates a watch from the app. */
export const CreateWatchInput = Watch.pick({
  productId: true,
  retailerIds: true,
  maxPriceCents: true,
  includeMarketplace: true,
  pickupRadiusKm: true,
}).extend({
  retailerIds: z.array(z.string()).min(1, 'Pick at least one retailer'),
});
export type CreateWatchInput = z.infer<typeof CreateWatchInput>;
