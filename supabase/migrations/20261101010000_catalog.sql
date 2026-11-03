-- Phase 1: catalog search, set reference data, review queue and lookups.

-- ---------------------------------------------------------------------------
-- Sets (from the Pokémon TCG API)
-- ---------------------------------------------------------------------------
create table public.card_sets (
  id text primary key,               -- pokemontcg.io set id, e.g. "sv8pt5"
  category_id text not null references public.categories (id),
  name text not null,
  series text,
  release_date date,
  logo_url text,
  updated_at timestamptz not null default now()
);

alter table public.card_sets enable row level security;
create policy "Signed-in users read sets" on public.card_sets
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Search text: name + set + product type synonyms, maintained by trigger
-- ---------------------------------------------------------------------------
create or replace function public.product_type_synonyms(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case t
    when 'etb' then 'etb elite trainer box'
    when 'booster_bundle' then 'booster bundle bundle'
    when 'booster_box' then 'booster box display bb'
    when 'collection' then 'collection premium collection box'
    when 'tin' then 'tin'
    when 'blister' then 'blister pack'
    else ''
  end
$$;

alter table public.products add column search_text text not null default '';

create or replace function public.products_set_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text = lower(
    public.unaccent_simple(coalesce(new.name, '') || ' ' || coalesce(new.set_name, '') || ' ' ||
    public.product_type_synonyms(new.product_type) ||
    case when new.is_exclusive then ' exclusive pc pokemon center' else '' end)
  );
  return new;
end;
$$;

-- Minimal accent folding (é -> e) without the unaccent extension.
create or replace function public.unaccent_simple(s text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(s, 'éèêëáàâäíìîïóòôöúùûüñçÉÈÊËÁÀÂÄÍÌÎÏÓÒÔÖÚÙÛÜÑÇ', 'eeeeaaaaiiiioooouuuuncEEEEAAAAIIIIOOOOUUUUNC')
$$;

create trigger products_search_text before insert or update on public.products
  for each row execute function public.products_set_search_text();

update public.products set name = name;  -- backfill

create index products_search_trgm on public.products using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- search_products: every query word must appear; ranked by trigram similarity.
-- ---------------------------------------------------------------------------
create or replace function public.search_products(q text, max_results int default 20)
returns table (
  id uuid,
  name text,
  set_name text,
  product_type text,
  msrp_cents integer,
  image_url text,
  is_exclusive boolean,
  retailer_ids text[],
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with terms as (
    select array_remove(regexp_split_to_array(lower(public.unaccent_simple(trim(q))), '[^a-z0-9]+'), '') as words
  )
  select p.id, p.name, p.set_name, p.product_type, p.msrp_cents, p.image_url, p.is_exclusive,
         coalesce(array_agg(distinct rs.retailer_id) filter (where rs.retailer_id is not null), '{}') as retailer_ids,
         extensions.similarity(p.search_text, lower(public.unaccent_simple(q))) as score
  from public.products p
  cross join terms t
  left join public.retailer_skus rs on rs.product_id = p.id
  where cardinality(t.words) > 0
    and not exists (
      select 1 from unnest(t.words) w where p.search_text not like '%' || w || '%'
    )
  group by p.id
  order by score desc, p.release_date desc nulls last, p.name
  limit least(greatest(max_results, 1), 50)
$$;

-- ---------------------------------------------------------------------------
-- Lookups used by URL paste and barcode scan
-- ---------------------------------------------------------------------------
create or replace function public.find_product_by_retailer_sku(p_retailer text, p_sku text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select product_id from public.retailer_skus
  where retailer_id = p_retailer and retailer_sku = p_sku
  limit 1
$$;

create or replace function public.find_product_by_upc(p_upc text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select id from public.products
  where upc = regexp_replace(p_upc, '[^0-9A-Za-z-]', '', 'g')
     or ltrim(upc, '0') = ltrim(regexp_replace(p_upc, '[^0-9]', '', 'g'), '0')
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Review queue: unmatched listings, URLs and barcodes for editors (Supabase Studio)
-- ---------------------------------------------------------------------------
create table public.catalog_review_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('listing', 'url', 'upc')),
  retailer_id text references public.retailers (id),
  retailer_sku text,
  url text,
  upc text,
  title text,
  suggested_product_id uuid references public.products (id) on delete set null,
  match_score real,
  status text not null default 'pending' check (status in ('pending', 'approved', 'merged', 'rejected')),
  submitted_by uuid references auth.users (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index catalog_review_queue_pending_unique
  on public.catalog_review_queue (kind, coalesce(retailer_id, ''), coalesce(retailer_sku, ''), coalesce(upc, ''))
  where status = 'pending';

alter table public.catalog_review_queue enable row level security;
-- No user policies: users submit through the function below; editors use the service role.

create or replace function public.submit_unknown_item(
  p_kind text, p_retailer text default null, p_sku text default null,
  p_url text default null, p_upc text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if p_kind not in ('url', 'upc') then
    raise exception 'invalid kind';
  end if;
  insert into public.catalog_review_queue (kind, retailer_id, retailer_sku, url, upc, submitted_by)
  values (p_kind, p_retailer, p_sku, left(p_url, 2000), left(p_upc, 64), auth.uid())
  on conflict do nothing;
end;
$$;

revoke execute on function public.submit_unknown_item(text, text, text, text, text) from public, anon;
grant execute on function public.submit_unknown_item(text, text, text, text, text) to authenticated;

-- Editors' view of the queue with the suggested product name (Supabase Studio).
create view public.catalog_review_pending with (security_invoker = true) as
  select q.*, p.name as suggested_product_name
  from public.catalog_review_queue q
  left join public.products p on p.id = q.suggested_product_id
  where q.status = 'pending'
  order by q.created_at;

-- ---------------------------------------------------------------------------
-- Watch view for Radar: one row per watch with per-retailer state
-- ---------------------------------------------------------------------------
create view public.watch_overview with (security_invoker = true) as
  select
    w.id as watch_id,
    w.user_id,
    w.paused,
    w.max_price_cents,
    w.include_marketplace,
    w.pickup_radius_km,
    w.retailer_ids,
    w.created_at,
    p.id as product_id,
    p.name as product_name,
    p.set_name,
    p.product_type,
    p.msrp_cents,
    p.image_url,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'retailer_id', rs.retailer_id,
          'retailer_sku', rs.retailer_sku,
          'url', rs.url,
          'state', rs.last_state,
          'price_cents', rs.last_price_cents,
          'last_checked_at', rs.last_checked_at,
          'poll_tier', rs.poll_tier
        ) order by rs.retailer_id
      ) filter (where rs.id is not null),
      '[]'::jsonb
    ) as retailers,
    case
      when bool_or(rs.last_state = 'IN_STOCK') then 'live'
      when bool_and(rs.last_state in ('OUT_OF_STOCK', 'DELISTED')) then 'sold_out'
      else 'monitoring'
    end as status
  from public.watches w
  join public.products p on p.id = w.product_id
  left join public.retailer_skus rs on rs.product_id = p.id and rs.retailer_id = any (w.retailer_ids)
  group by w.id, p.id;
