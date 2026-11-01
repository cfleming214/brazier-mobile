begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- Every public table has row level security on
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t join pg_class c on c.relname = t.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
   where t.schemaname = 'public' and not c.relrowsecurity),
  0,
  'RLS is enabled on every public table'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two users (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

select is(
  (select count(*)::int from public.profiles where id in
     ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')),
  2,
  'A profile is created for each new auth user'
);

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- User A creates a watch
-- ---------------------------------------------------------------------------
select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');

select lives_ok(
  $$ insert into public.watches (product_id, retailer_ids, max_price_cents)
     values ('11111111-1111-4111-8111-111111111101', array['target', 'bestbuy'], 6500) $$,
  'User A can create a watch'
);

select is(
  (select user_id from public.watches limit 1),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'user_id defaults to the signed-in user'
);

select throws_ok(
  $$ insert into public.watches (user_id, product_id, retailer_ids)
     values ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111102', array['target']) $$,
  '42501', null,
  'User A cannot create a watch for user B'
);

select throws_ok(
  $$ insert into public.watches (product_id, retailer_ids) values ('11111111-1111-4111-8111-111111111103', '{}') $$,
  '23514', null,
  'A watch needs at least one retailer'
);

select lives_ok(
  $$ insert into public.push_tokens (expo_token, platform) values ('ExponentPushToken[aaa]', 'ios') $$,
  'User A can register a push token'
);

-- ---------------------------------------------------------------------------
-- User B cannot see or change user A's rows
-- ---------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');

select is((select count(*)::int from public.watches), 0, 'User B sees none of user A''s watches');
select is((select count(*)::int from public.push_tokens), 0, 'User B sees none of user A''s push tokens');

update public.watches set paused = true;
delete from public.watches;
delete from public.push_tokens;

-- Back to postgres to check nothing changed.
reset role;
select is((select count(*)::int from public.watches where not paused), 1, 'User B could not update or delete user A''s watch');
select is((select count(*)::int from public.push_tokens), 1, 'User B could not delete user A''s push token');

-- ---------------------------------------------------------------------------
-- Catalog, stock and calendar are read-only for users
-- ---------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');

select ok((select count(*) from public.products) >= 5, 'Users can read products');
select ok((select count(*) from public.retailer_skus) >= 10, 'Users can read retailer SKUs');
select ok((select count(*) from public.retailers) = 6, 'Users can read retailers');

select throws_ok(
  $$ insert into public.products (category_id, name, product_type) values ('pokemon_tcg', 'Hacked', 'etb') $$,
  '42501', null, 'Users cannot insert products'
);

select throws_ok(
  $$ insert into public.stock_events (retailer_sku_id, prev_state, new_state, source)
     select id, 'OUT_OF_STOCK', 'IN_STOCK', 'poll' from public.retailer_skus limit 1 $$,
  '42501', null, 'Users cannot insert stock events'
);

select throws_ok(
  $$ insert into public.calendar_events (title, event_type, starts_at) values ('Fake', 'set_release', now()) $$,
  '42501', null, 'Users cannot insert calendar events'
);

select is((select count(*)::int from public.calendar_events), 2, 'Users only see published calendar events');
select is((select count(*)::int from public.calendar_source_items), 0, 'Users cannot read raw calendar source items');

-- ---------------------------------------------------------------------------
-- Profiles: own row only, plan not user-editable
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles), 1, 'Users see only their own profile');
update public.profiles set plan = 'pro';
reset role;
select is(
  (select plan from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'free',
  'Users cannot upgrade their own plan'
);

-- ---------------------------------------------------------------------------
-- stock_events is append-only, even for the service role
-- ---------------------------------------------------------------------------
insert into public.stock_events (retailer_sku_id, prev_state, new_state, source)
select id, 'OUT_OF_STOCK', 'IN_STOCK', 'poll' from public.retailer_skus limit 1;

select throws_ok(
  $$ update public.stock_events set new_state = 'OUT_OF_STOCK' $$,
  'P0001', 'stock_events is append-only', 'stock_events rejects updates'
);
select throws_ok(
  $$ delete from public.stock_events $$,
  'P0001', 'stock_events is append-only', 'stock_events rejects deletes'
);

-- ---------------------------------------------------------------------------
-- Alerts: users may only set opened_at
-- ---------------------------------------------------------------------------
insert into public.alerts (watch_id, user_id)
select id, user_id from public.watches limit 1;

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.alerts set sent_at = now() - interval '1 day' $$,
  '42501', null, 'Users cannot rewrite alert send times'
);

select * from finish();
rollback;
