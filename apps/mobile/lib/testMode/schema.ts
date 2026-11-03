/**
 * On-device SQLite schema for test mode.
 *
 * Mirrors the Supabase catalog tables (supabase/migrations): categories, retailers, products,
 * retailer_skus and stock_events, with the same column names, defaults and checks.
 * Postgres types map to SQLite as:
 *   uuid, text, date, timestamptz  -> TEXT (timestamps are ISO-8601 strings)
 *   jsonb                          -> TEXT holding JSON
 *   boolean                        -> INTEGER 0/1
 *   integer, bigint identity       -> INTEGER
 *   real                           -> REAL
 * When a migration changes one of these tables, update this file and bump SCHEMA_VERSION.
 */
export const SCHEMA_VERSION = 1;

const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const SCHEMA_SQL = `
create table categories (
  id text primary key,
  name text not null
);

create table retailers (
  id text primary key,
  name text not null,
  policy text not null default '{}' check (json_valid(policy)),
  adapter_version integer not null default 1,
  website_url text,
  created_at text not null default ${now}
);

create table products (
  id text primary key,
  category_id text not null references categories (id),
  name text not null check (length(name) > 0),
  set_name text,
  product_type text not null
    check (product_type in ('etb', 'booster_bundle', 'booster_box', 'collection', 'tin', 'blister', 'other')),
  upc text unique,
  msrp_cents integer check (msrp_cents >= 0),
  image_url text,
  release_date text,
  is_exclusive integer not null default 0 check (is_exclusive in (0, 1)),
  exclusive_retailer_id text references retailers (id),
  search_text text not null default '',
  created_at text not null default ${now},
  updated_at text not null default ${now}
);

create table retailer_skus (
  id text primary key,
  product_id text not null references products (id) on delete cascade,
  retailer_id text not null references retailers (id),
  retailer_sku text not null,
  url text,
  last_state text not null default 'UNKNOWN'
    check (last_state in ('UNKNOWN', 'OUT_OF_STOCK', 'IN_STOCK', 'PREORDER', 'DELISTED')),
  last_price_cents integer check (last_price_cents >= 0),
  last_checked_at text,
  poll_tier text not null default 'normal' check (poll_tier in ('cold', 'normal', 'hot', 'burst')),
  pickup_only integer not null default 0 check (pickup_only in (0, 1)),
  marketplace_only integer not null default 0 check (marketplace_only in (0, 1)),
  confirmations integer not null default 0,
  last_in_stock_at text,
  last_out_of_stock_at text,
  quantity_available integer check (quantity_available >= 0),
  created_at text not null default ${now},
  unique (retailer_id, retailer_sku)
);

create table stock_events (
  id integer primary key autoincrement,
  retailer_sku_id text not null references retailer_skus (id) on delete cascade,
  prev_state text not null,
  new_state text not null,
  price_cents integer,
  qty_hint integer,
  source text not null check (source in ('poll', 'api', 'feed', 'sighting')),
  confidence real not null default 1.0 check (confidence between 0 and 1),
  suppressed_reason text,
  observed_at text not null default ${now}
);

create index retailer_skus_product_idx on retailer_skus (product_id);
create index stock_events_sku_idx on stock_events (retailer_sku_id, observed_at);
`;
