-- Local development and E2E seed data. Product SKUs below are SAMPLE values, not real retailer IDs.

insert into public.categories (id, name) values ('pokemon_tcg', 'Pokémon TCG');

insert into public.retailers (id, name, policy) values
  ('bestbuy', 'Best Buy', '{"enabled": true, "maxRequestsPerMinute": 120, "allowedEndpoints": ["api.bestbuy.com/v1"], "automationAllowed": true, "backoffSeconds": 120}'),
  ('walmart', 'Walmart', '{"enabled": true, "maxRequestsPerMinute": 60, "allowedEndpoints": ["developer.api.walmart.com"], "automationAllowed": true, "backoffSeconds": 120}'),
  ('target', 'Target', '{"enabled": true, "maxRequestsPerMinute": 30, "allowedEndpoints": ["www.target.com/p/"], "automationAllowed": true, "backoffSeconds": 300}'),
  ('gamestop', 'GameStop', '{"enabled": true, "maxRequestsPerMinute": 20, "allowedEndpoints": ["www.gamestop.com/"], "automationAllowed": true, "backoffSeconds": 300}'),
  ('pokemoncenter', 'Pokémon Center', '{"enabled": true, "maxRequestsPerMinute": 6, "allowedEndpoints": ["www.pokemoncenter.com/product/"], "automationAllowed": true, "backoffSeconds": 600}'),
  ('amazon', 'Amazon', '{"enabled": false, "maxRequestsPerMinute": 60, "allowedEndpoints": ["webservices.amazon.com"], "automationAllowed": false, "backoffSeconds": 120}');

insert into public.products (id, category_id, name, set_name, product_type, upc, msrp_cents, is_exclusive, exclusive_retailer_id) values
  ('11111111-1111-4111-8111-111111111101', 'pokemon_tcg', 'Prismatic Evolutions Elite Trainer Box', 'Prismatic Evolutions', 'etb', 'SAMPLE-UPC-0001', 5999, false, null),
  ('11111111-1111-4111-8111-111111111102', 'pokemon_tcg', 'Destined Rivals Booster Bundle', 'Destined Rivals', 'booster_bundle', 'SAMPLE-UPC-0002', 2699, false, null),
  ('11111111-1111-4111-8111-111111111103', 'pokemon_tcg', 'Journey Together Elite Trainer Box', 'Journey Together', 'etb', 'SAMPLE-UPC-0003', 4999, false, null),
  ('11111111-1111-4111-8111-111111111104', 'pokemon_tcg', 'Mega Evolution Pokémon Center Elite Trainer Box', 'Mega Evolution', 'etb', 'SAMPLE-UPC-0004', 5999, true, 'pokemoncenter'),
  ('11111111-1111-4111-8111-111111111105', 'pokemon_tcg', 'Phantasmal Flames Booster Box', 'Phantasmal Flames', 'booster_box', 'SAMPLE-UPC-0005', 16199, false, null);

insert into public.retailer_skus (product_id, retailer_id, retailer_sku, url) values
  ('11111111-1111-4111-8111-111111111101', 'target', 'SAMPLE-TGT-0001', 'http://fake-retailer.local/target/p/SAMPLE-TGT-0001'),
  ('11111111-1111-4111-8111-111111111101', 'bestbuy', 'SAMPLE-BBY-0001', 'http://fake-retailer.local/bestbuy/site/SAMPLE-BBY-0001'),
  ('11111111-1111-4111-8111-111111111101', 'walmart', 'SAMPLE-WMT-0001', 'http://fake-retailer.local/walmart/ip/SAMPLE-WMT-0001'),
  ('11111111-1111-4111-8111-111111111102', 'bestbuy', 'SAMPLE-BBY-0002', 'http://fake-retailer.local/bestbuy/site/SAMPLE-BBY-0002'),
  ('11111111-1111-4111-8111-111111111102', 'target', 'SAMPLE-TGT-0002', 'http://fake-retailer.local/target/p/SAMPLE-TGT-0002'),
  ('11111111-1111-4111-8111-111111111103', 'target', 'SAMPLE-TGT-0003', 'http://fake-retailer.local/target/p/SAMPLE-TGT-0003'),
  ('11111111-1111-4111-8111-111111111103', 'gamestop', 'SAMPLE-GME-0003', 'http://fake-retailer.local/gamestop/products/SAMPLE-GME-0003'),
  ('11111111-1111-4111-8111-111111111104', 'pokemoncenter', 'SAMPLE-PKC-0004', 'http://fake-retailer.local/pokemoncenter/product/SAMPLE-PKC-0004'),
  ('11111111-1111-4111-8111-111111111105', 'walmart', 'SAMPLE-WMT-0005', 'http://fake-retailer.local/walmart/ip/SAMPLE-WMT-0005'),
  ('11111111-1111-4111-8111-111111111105', 'bestbuy', 'SAMPLE-BBY-0005', 'http://fake-retailer.local/bestbuy/site/SAMPLE-BBY-0005');

insert into public.calendar_events (product_id, title, event_type, retailer_id, starts_at, status, confidence, source_refs, published) values
  ('11111111-1111-4111-8111-111111111104', 'Pokémon Center preorder: Mega Evolution ETB', 'preorder_open', 'pokemoncenter',
   now() + interval '2 days', 'confirmed', 0.95, '[{"source": "sample", "url": null}]', true),
  (null, 'Rumored restock window', 'restock_window', 'walmart',
   now() + interval '5 days', 'rumored', 0.4, '[{"source": "sample", "url": null}]', true),
  (null, 'Unpublished draft event', 'set_release', null,
   now() + interval '30 days', 'rumored', 0.2, '[]', false);
