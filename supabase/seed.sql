-- Local development and E2E seed data.
-- Retailer SKUs and UPCs below are SAMPLE values (9xxxx ranges), not real retailer IDs.

insert into public.categories (id, name) values ('pokemon_tcg', 'Pokémon TCG');

insert into public.retailers (id, name, policy) values
  ('bestbuy', 'Best Buy', '{"enabled": true, "maxRequestsPerMinute": 120, "allowedEndpoints": ["api.bestbuy.com/v1"], "automationAllowed": true, "backoffSeconds": 120}'),
  ('walmart', 'Walmart', '{"enabled": true, "maxRequestsPerMinute": 60, "allowedEndpoints": ["developer.api.walmart.com"], "automationAllowed": true, "backoffSeconds": 120}'),
  ('target', 'Target', '{"enabled": true, "maxRequestsPerMinute": 30, "allowedEndpoints": ["www.target.com/p/"], "automationAllowed": true, "backoffSeconds": 300}'),
  ('gamestop', 'GameStop', '{"enabled": true, "maxRequestsPerMinute": 20, "allowedEndpoints": ["www.gamestop.com/"], "automationAllowed": true, "backoffSeconds": 300}'),
  ('pokemoncenter', 'Pokémon Center', '{"enabled": true, "maxRequestsPerMinute": 6, "allowedEndpoints": ["www.pokemoncenter.com/product/"], "automationAllowed": true, "backoffSeconds": 600}'),
  ('tcgplayer', 'TCGplayer', '{"enabled": false, "maxRequestsPerMinute": 10, "allowedEndpoints": ["tcgcsv.com"], "automationAllowed": false, "backoffSeconds": 600}'),
  ('amazon', 'Amazon', '{"enabled": false, "maxRequestsPerMinute": 60, "allowedEndpoints": ["webservices.amazon.com"], "automationAllowed": false, "backoffSeconds": 120}');

insert into public.products (id, category_id, name, set_name, product_type, upc, msrp_cents, is_exclusive, exclusive_retailer_id) values
  ('11111111-1111-4111-8111-111111111101', 'pokemon_tcg', 'Prismatic Evolutions Elite Trainer Box', 'Prismatic Evolutions', 'etb', 'SAMPLE-UPC-0001', 5999, false, null),
  ('11111111-1111-4111-8111-111111111102', 'pokemon_tcg', 'Destined Rivals Booster Bundle', 'Destined Rivals', 'booster_bundle', 'SAMPLE-UPC-0002', 2699, false, null),
  ('11111111-1111-4111-8111-111111111103', 'pokemon_tcg', 'Journey Together Elite Trainer Box', 'Journey Together', 'etb', 'SAMPLE-UPC-0003', 4999, false, null),
  ('11111111-1111-4111-8111-111111111104', 'pokemon_tcg', 'Mega Evolution Pokémon Center Elite Trainer Box', 'Mega Evolution', 'etb', 'SAMPLE-UPC-0004', 5999, true, 'pokemoncenter'),
  ('11111111-1111-4111-8111-111111111105', 'pokemon_tcg', 'Phantasmal Flames Booster Box', 'Phantasmal Flames', 'booster_box', 'SAMPLE-UPC-0005', 16199, false, null);

insert into public.retailer_skus (product_id, retailer_id, retailer_sku, url) values
  ('11111111-1111-4111-8111-111111111101', 'target', '90000001', 'https://www.target.com/p/sample/-/A-90000001'),
  ('11111111-1111-4111-8111-111111111101', 'bestbuy', '9000001', 'https://www.bestbuy.com/site/sample/9000001.p?skuId=9000001'),
  ('11111111-1111-4111-8111-111111111101', 'walmart', '900000001', 'https://www.walmart.com/ip/sample/900000001'),
  ('11111111-1111-4111-8111-111111111102', 'bestbuy', '9000002', 'https://www.bestbuy.com/site/sample/9000002.p?skuId=9000002'),
  ('11111111-1111-4111-8111-111111111102', 'target', '90000002', 'https://www.target.com/p/sample/-/A-90000002'),
  ('11111111-1111-4111-8111-111111111103', 'target', '90000003', 'https://www.target.com/p/sample/-/A-90000003'),
  ('11111111-1111-4111-8111-111111111103', 'gamestop', '90000003', 'https://www.gamestop.com/toys-games/trading-cards/products/sample/90000003.html'),
  ('11111111-1111-4111-8111-111111111104', 'pokemoncenter', '99-99999-004', 'https://www.pokemoncenter.com/product/99-99999-004/sample'),
  ('11111111-1111-4111-8111-111111111105', 'walmart', '900000005', 'https://www.walmart.com/ip/sample/900000005'),
  ('11111111-1111-4111-8111-111111111105', 'bestbuy', '9000005', 'https://www.bestbuy.com/site/sample/9000005.p?skuId=9000005');

insert into public.calendar_events (product_id, title, event_type, retailer_id, starts_at, status, confidence, source_refs, published) values
  ('11111111-1111-4111-8111-111111111104', 'Pokémon Center preorder: Mega Evolution ETB', 'preorder_open', 'pokemoncenter',
   now() + interval '2 days', 'confirmed', 0.95, '[{"source": "sample", "url": null}]', true),
  (null, 'Rumored restock window', 'restock_window', 'walmart',
   now() + interval '5 days', 'rumored', 0.4, '[{"source": "sample", "url": null}]', true),
  (null, 'Unpublished draft event', 'set_release', null,
   now() + interval '30 days', 'rumored', 0.2, '[]', false);

-- Health rows for retailers inserted above (the migration seeds rows for retailers that exist at migration time).
insert into public.adapter_health (retailer_id, status)
select id, case when (policy->>'enabled')::boolean then 'unknown' else 'disabled' end from public.retailers
on conflict do nothing;
