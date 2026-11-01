begin;
select plan(12);

insert into auth.users (id, email, aud, role, instance_id)
values ('cccccccc-0000-4000-8000-000000000003', 'c@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('cccccccc-0000-4000-8000-000000000003');

select is(
  (select name from public.search_products('prismatic etb') limit 1),
  'Prismatic Evolutions Elite Trainer Box',
  '"prismatic etb" finds the Prismatic Evolutions ETB first'
);
select is(
  (select name from public.search_products('Prismatic Evolutions Elite Trainer Box') limit 1),
  'Prismatic Evolutions Elite Trainer Box',
  'Full product name matches'
);
select ok(
  (select retailer_ids @> array['target', 'bestbuy', 'walmart'] from public.search_products('prismatic etb') limit 1),
  'Search results list the retailers that carry the product'
);
select is((select count(*)::int from public.search_products('pokemon center etb')), 1, 'Exclusive products match "pokemon center"');
select is((select count(*)::int from public.search_products('pokémon center etb')), 1, 'Accents are folded');
select is((select count(*)::int from public.search_products('zzzz nothing')), 0, 'Nonsense finds nothing');
select is((select count(*)::int from public.search_products('   ')), 0, 'Blank query finds nothing');

select is(
  public.find_product_by_retailer_sku('target', '90000001'),
  '11111111-1111-4111-8111-111111111101'::uuid,
  'Retailer SKU lookup resolves the canonical product'
);
select is(public.find_product_by_upc('SAMPLE-UPC-0002'), '11111111-1111-4111-8111-111111111102'::uuid, 'UPC lookup works');

select lives_ok(
  $$ select public.submit_unknown_item('url', 'target', 'NEW-1', 'https://www.target.com/p/x/-/A-NEW-1', null) $$,
  'Users can submit an unknown URL for review'
);
select is((select count(*)::int from public.catalog_review_queue), 0, 'Users cannot read the review queue');

reset role;
select is((select count(*)::int from public.catalog_review_queue where retailer_sku = 'NEW-1'), 1, 'Submission landed in the queue');

select * from finish();
rollback;
