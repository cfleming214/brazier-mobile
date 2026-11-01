begin;
select plan(13);

insert into auth.users (id, email, aud, role, instance_id) values
  ('dddddddd-0000-4000-8000-000000000004', 'd@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'e@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.notifications (user_id, category, title, body) values
  ('dddddddd-0000-4000-8000-000000000004', 'restock', 'In stock', 'Target'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'restock', 'In stock', 'Target');
insert into public.activity_events (user_id, kind, message) values
  ('dddddddd-0000-4000-8000-000000000004', 'poll', 'POLL'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'poll', 'POLL');

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('dddddddd-0000-4000-8000-000000000004');

select is((select count(*)::int from public.notifications), 1, 'Users see only their own notifications');
select is((select count(*)::int from public.activity_events), 1, 'Users see only their own activity');
select lives_ok($$ update public.notifications set read_at = now() $$, 'Users can mark notifications read');
select throws_ok($$ update public.notifications set title = 'x' $$, '42501', null, 'Users cannot edit notification content');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'Mark-all-read works');
select throws_ok($$ insert into public.notifications (user_id, category, title, body) values (auth.uid(), 'restock', 'x', 'y') $$, '42501', null, 'Users cannot create notifications');

select lives_ok($$ insert into public.notification_prefs (quiet_hours_enabled) values (true) $$, 'Users can save their notification settings');
select is((select user_id from public.notification_prefs), 'dddddddd-0000-4000-8000-000000000004'::uuid, 'Settings belong to the signed-in user');

select ok((select count(*) from public.adapter_health) >= 6, 'Users can read adapter health');
update public.adapter_health set status = 'down';
select is((select count(*)::int from public.adapter_health where status = 'down'), 0, 'Users cannot write adapter health');
select throws_ok($$ select public.watched_skus() $$, '42501', null, 'Users cannot call worker functions');
select throws_ok($$ select public.queue_send('poll_jobs', '{}'::jsonb) $$, '42501', null, 'Users cannot use the job queues');

reset role;
select is((select push_status from public.notifications where user_id = 'eeeeeeee-0000-4000-8000-000000000005'), 'pending', 'Other users'' notifications are untouched');

select * from finish();
rollback;
