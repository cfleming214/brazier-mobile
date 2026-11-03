-- Retailer profile details and per-retailer inventory counts.
-- The mobile app's on-device test-mode database (apps/mobile/lib/testMode/schema.ts)
-- mirrors these tables, so keep the two in step.

-- Public storefront for the retailer, shown on its profile.
alter table public.retailers add column website_url text;

-- Units the retailer reports as available, when it exposes a count.
-- Null means unknown; most retailers only report a stock state.
alter table public.retailer_skus add column quantity_available integer
  check (quantity_available >= 0);

update public.retailers set website_url = case id
  when 'bestbuy' then 'https://www.bestbuy.com'
  when 'walmart' then 'https://www.walmart.com'
  when 'target' then 'https://www.target.com'
  when 'gamestop' then 'https://www.gamestop.com'
  when 'pokemoncenter' then 'https://www.pokemoncenter.com'
  when 'tcgplayer' then 'https://www.tcgplayer.com'
  when 'amazon' then 'https://www.amazon.com'
end;
