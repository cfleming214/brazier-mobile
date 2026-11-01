-- DropHawk initial schema (BUILD_PLAN.md section 3).
-- Catalog, stock and calendar tables are written by the service role only.
-- User-owned tables are protected by row level security.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'pro_squad')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.categories (
  id text primary key,
  name text not null
);

create table public.retailers (
  id text primary key,
  name text not null,
  -- RetailerPolicy (packages/shared/src/adapter.ts)
  policy jsonb not null default '{}'::jsonb,
  adapter_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id text not null references public.categories (id),
  name text not null check (length(name) > 0),
  set_name text,
  product_type text not null
    check (product_type in ('etb', 'booster_bundle', 'booster_box', 'collection', 'tin', 'blister', 'other')),
  upc text unique,
  msrp_cents integer check (msrp_cents >= 0),
  image_url text,
  release_date date,
  is_exclusive boolean not null default false,
  exclusive_retailer_id text references public.retailers (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_category on public.products (category_id);

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.retailer_skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  retailer_id text not null references public.retailers (id),
  retailer_sku text not null,
  url text,
  last_state text not null default 'UNKNOWN'
    check (last_state in ('UNKNOWN', 'OUT_OF_STOCK', 'IN_STOCK', 'PREORDER', 'DELISTED')),
  last_price_cents integer check (last_price_cents >= 0),
  last_checked_at timestamptz,
  poll_tier text not null default 'normal' check (poll_tier in ('cold', 'normal', 'hot', 'burst')),
  created_at timestamptz not null default now(),
  unique (retailer_id, retailer_sku)
);

create index retailer_skus_product on public.retailer_skus (product_id);

-- ---------------------------------------------------------------------------
-- Stock events (append-only)
-- ---------------------------------------------------------------------------
create table public.stock_events (
  id bigint generated always as identity primary key,
  retailer_sku_id uuid not null references public.retailer_skus (id) on delete cascade,
  prev_state text not null,
  new_state text not null,
  price_cents integer,
  qty_hint integer,
  source text not null check (source in ('poll', 'api', 'feed', 'sighting')),
  confidence real not null default 1.0 check (confidence between 0 and 1),
  -- Set when the detector recorded the change but chose not to alert (ghost restock, marketplace, ...).
  suppressed_reason text,
  observed_at timestamptz not null default now()
);

create index stock_events_sku_time on public.stock_events (retailer_sku_id, observed_at desc);

create or replace function public.reject_stock_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stock_events is append-only';
end;
$$;

create trigger stock_events_append_only before update or delete on public.stock_events
  for each row execute function public.reject_stock_event_mutation();

-- ---------------------------------------------------------------------------
-- Watches, alerts, push tokens
-- ---------------------------------------------------------------------------
create table public.watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  retailer_ids text[] not null check (cardinality(retailer_ids) > 0),
  max_price_cents integer check (max_price_cents > 0),
  include_marketplace boolean not null default false,
  pickup_radius_km numeric check (pickup_radius_km > 0),
  location_h3 text,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index watches_user on public.watches (user_id);
create index watches_product on public.watches (product_id) where not paused;

create trigger watches_updated_at before update on public.watches
  for each row execute function public.set_updated_at();

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.watches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stock_event_id bigint references public.stock_events (id),
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz
);

create index alerts_user_time on public.alerts (user_id, sent_at desc);

create table public.push_tokens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expo_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, expo_token)
);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete set null,
  set_name text,
  title text not null,
  event_type text not null
    check (event_type in ('set_release', 'preorder_open', 'retailer_street_date', 'prerelease', 'restock_window', 'pc_drop')),
  retailer_id text references public.retailers (id),
  starts_at timestamptz not null,
  timezone text not null default 'America/New_York',
  status text not null default 'rumored' check (status in ('rumored', 'confirmed', 'cancelled')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  source_refs jsonb not null default '[]'::jsonb,
  sponsored boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_starts on public.calendar_events (starts_at) where published;

create trigger calendar_events_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();

create table public.calendar_source_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  payload jsonb not null,
  content_hash text not null,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

-- ---------------------------------------------------------------------------
-- Sightings (community)
-- ---------------------------------------------------------------------------
create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  retailer_id text not null references public.retailers (id),
  store_number text,
  product_id uuid references public.products (id) on delete set null,
  photo_path text,
  note text check (length(note) <= 500),
  upvotes integer not null default 0,
  verified boolean not null default false,
  reported_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.retailers enable row level security;
alter table public.products enable row level security;
alter table public.retailer_skus enable row level security;
alter table public.stock_events enable row level security;
alter table public.watches enable row level security;
alter table public.alerts enable row level security;
alter table public.push_tokens enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_source_items enable row level security;
alter table public.sightings enable row level security;

-- Profiles: users read their own; plan changes come from the billing webhook (service role).
create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- Catalog and stock: read-only for signed-in users.
create policy "Signed-in users read categories" on public.categories
  for select to authenticated using (true);
create policy "Signed-in users read retailers" on public.retailers
  for select to authenticated using (true);
create policy "Signed-in users read products" on public.products
  for select to authenticated using (true);
create policy "Signed-in users read retailer SKUs" on public.retailer_skus
  for select to authenticated using (true);
create policy "Signed-in users read stock events" on public.stock_events
  for select to authenticated using (true);

-- Calendar: only published events are visible.
create policy "Signed-in users read published calendar events" on public.calendar_events
  for select to authenticated using (published);

-- calendar_source_items: no policies, service role only.

-- Watches: full control of your own rows only.
create policy "Users read own watches" on public.watches
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create own watches" on public.watches
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update own watches" on public.watches
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users delete own watches" on public.watches
  for delete to authenticated using (user_id = (select auth.uid()));

-- Alerts: users read their own; the app may mark them opened.
create policy "Users read own alerts" on public.alerts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark own alerts opened" on public.alerts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Push tokens: users manage their own.
create policy "Users read own push tokens" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users register own push tokens" on public.push_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update own push tokens" on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users delete own push tokens" on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- Sightings: everyone signed in can read; users manage their own.
create policy "Signed-in users read sightings" on public.sightings
  for select to authenticated using (true);
create policy "Users report own sightings" on public.sightings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users delete own sightings" on public.sightings
  for delete to authenticated using (user_id = (select auth.uid()));

-- Columns users must never change from the client.
revoke update on public.alerts from authenticated;
grant update (opened_at) on public.alerts to authenticated;
revoke update (upvotes, verified) on public.sightings from authenticated;
