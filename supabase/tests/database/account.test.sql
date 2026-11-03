-- Phase 4: free-tier limit, plan expiry, hit rate, analytics, export and account deletion.
begin;
select plan(17);

insert into auth.users (id, email, aud, role, instance_id) values
  ('f0000000-0000-4000-8000-000000000001', 'free@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('f0000000-0000-4000-8000-000000000002', 'pro@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('f0000000-0000-4000-8000-000000000003', 'lapsed@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set plan = 'pro', plan_expires_at = now() + interval '30 days' where id = 'f0000000-0000-4000-8000-000000000002';
update public.profiles set plan = 'pro', plan_expires_at = now() - interval '3 days' where id = 'f0000000-0000-4000-8000-000000000003';

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

-- Free plan: 3 active watches -----------------------------------------------
select pg_temp.login('f0000000-0000-4000-8000-000000000001');
insert into public.watches (product_id, retailer_ids) values
  ('11111111-1111-4111-8111-111111111101', '{target}'),
  ('11111111-1111-4111-8111-111111111102', '{target}'),
  ('11111111-1111-4111-8111-111111111103', '{target}');
select throws_like(
  $$ insert into public.watches (product_id, retailer_ids) values ('11111111-1111-4111-8111-111111111104', '{target}') $$,
  'FREE_LIMIT%', 'A free user cannot add a 4th active watch');
select lives_ok(
  $$ insert into public.watches (product_id, retailer_ids, paused) values ('11111111-1111-4111-8111-111111111104', '{target}', true) $$,
  'A paused 4th watch is allowed');
select throws_like(
  $$ update public.watches set paused = false where product_id = '11111111-1111-4111-8111-111111111104' $$,
  'FREE_LIMIT%', 'Resuming a 4th watch is blocked');
update public.watches set paused = true where product_id = '11111111-1111-4111-8111-111111111101';
select lives_ok(
  $$ update public.watches set paused = false where product_id = '11111111-1111-4111-8111-111111111104' $$,
  'Pausing one frees a slot');
select throws_ok($$ update public.profiles set plan = 'pro' $$, '42501', null, 'Users cannot upgrade themselves');

-- Pro and lapsed plans --------------------------------------------------------
select pg_temp.login('f0000000-0000-4000-8000-000000000002');
select lives_ok($$
  insert into public.watches (product_id, retailer_ids)
  select id, '{target}' from public.products limit 5
$$, 'Pro users have no watch limit');

select pg_temp.login('f0000000-0000-4000-8000-000000000003');
select throws_like($$
  insert into public.watches (product_id, retailer_ids)
  select id, '{target}' from public.products limit 4
$$, 'FREE_LIMIT%', 'A lapsed subscription is treated as free');

-- Hit rate --------------------------------------------------------------------
reset role;
insert into public.alerts (watch_id, user_id, sent_at)
select id, user_id, now() - interval '40 seconds' from public.watches
where user_id = 'f0000000-0000-4000-8000-000000000001' and not paused;

select pg_temp.login('f0000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.mark_cart_opened((select id from public.watches where product_id = '11111111-1111-4111-8111-111111111102')) $$,
  'mark_cart_opened records the open');
select is((select alerts_received from public.hit_rate_stats), 3, 'Hit rate counts alerts');
select is((select carts_opened from public.hit_rate_stats), 1, 'Hit rate counts opens');
select ok((select avg_response_seconds between 35 and 60 from public.hit_rate_stats), 'Average response time is measured');

-- Analytics -------------------------------------------------------------------
select lives_ok($$ insert into public.analytics_events (event, props, platform) values ('watch_created', '{"retailers":1}', 'ios') $$,
  'Users can record analytics events');
select throws_ok($$ insert into public.analytics_events (user_id, event) values ('f0000000-0000-4000-8000-000000000002', 'watch_created') $$,
  '42501', null, 'Users cannot record events for someone else');
select throws_ok($$ select * from public.analytics_events $$, '42501', null, 'Users cannot read analytics');

-- Export & delete ---------------------------------------------------------------
select is(jsonb_array_length(public.export_my_data() -> 'watches'), 4, 'Export includes the user''s watches');
select lives_ok($$ select public.delete_my_account() $$, 'Users can delete their account');

reset role;
select is((select count(*)::int from public.watches where user_id = 'f0000000-0000-4000-8000-000000000001'), 0,
  'Deleting the account removes the user''s data');

select * from finish();
rollback;
