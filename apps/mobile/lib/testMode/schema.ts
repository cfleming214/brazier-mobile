/**
 * On-device SQLite schema for test mode.
 *
 * Mirrors the Supabase catalog tables (supabase/migrations): categories, retailers, products,
 * retailer_skus, stock_events, adapter_health, calendar_events and calendar_follows, with the same
 * column names, defaults and checks.
 * Postgres types map to SQLite as:
 *   uuid, text, date, timestamptz  -> TEXT (timestamps are ISO-8601 strings)
 *   jsonb, text[]                  -> TEXT holding JSON
 *   boolean                        -> INTEGER 0/1
 *   integer, bigint identity       -> INTEGER
 *   real                           -> REAL
 * When a migration changes one of these tables, update this file and bump SCHEMA_VERSION.
 */
export const SCHEMA_VERSION = 3;

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
  is_upcoming integer not null default 0 check (is_upcoming in (0, 1)),
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

create table adapter_health (
  retailer_id text primary key references retailers (id),
  status text not null default 'unknown'
    check (status in ('ok', 'degraded', 'backoff', 'down', 'disabled', 'unknown')),
  latency_ms integer,
  success_rate real,
  checks_per_min integer not null default 0,
  last_error text,
  backoff_until text,
  active_protections text not null default '[]' check (json_valid(active_protections)),
  updated_at text not null default ${now}
);

create table calendar_events (
  id text primary key,
  product_id text references products (id) on delete set null,
  set_name text,
  title text not null,
  event_type text not null
    check (event_type in ('set_release', 'preorder_open', 'retailer_street_date', 'prerelease', 'restock_window', 'pc_drop')),
  retailer_id text references retailers (id),
  starts_at text not null,
  timezone text not null default 'America/New_York',
  status text not null default 'rumored' check (status in ('rumored', 'confirmed', 'cancelled')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  source_refs text not null default '[]' check (json_valid(source_refs)),
  sponsored integer not null default 0 check (sponsored in (0, 1)),
  published integer not null default 0 check (published in (0, 1)),
  is_estimate integer not null default 0 check (is_estimate in (0, 1)),
  review_status text not null default 'auto' check (review_status in ('auto', 'pending', 'approved', 'rejected')),
  cancelled_at text,
  created_at text not null default ${now},
  updated_at text not null default ${now}
);

-- user_id has no auth.users to reference on device; test data uses one local user.
create table calendar_follows (
  user_id text not null,
  event_id text not null references calendar_events (id) on delete cascade,
  remind_minutes_before integer not null default 15 check (remind_minutes_before between 0 and 10080),
  created_at text not null default ${now},
  primary key (user_id, event_id)
);

create index retailer_skus_product_idx on retailer_skus (product_id);
create index stock_events_sku_idx on stock_events (retailer_sku_id, observed_at);
create index calendar_events_starts_idx on calendar_events (starts_at);
`;
