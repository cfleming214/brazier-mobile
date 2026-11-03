begin;
select plan(10);

insert into auth.users (id, email, aud, role, instance_id) values
  ('ffffffff-0000-4000-8000-000000000006', 'f@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('99999999-0000-4000-8000-000000000009', 'g@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
insert into public.calendar_follows (user_id, event_id)
select '99999999-0000-4000-8000-000000000009', id from public.calendar_events where published limit 1;

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('ffffffff-0000-4000-8000-000000000006');

select is(
  (select count(*)::int from public.calendar_agenda a join public.calendar_events e on e.id = a.id where not e.published),
  0, 'The agenda shows only published events');
select lives_ok($$ insert into public.calendar_follows (event_id) select id from public.calendar_events where published limit 1 $$, 'Users can follow an event');
select is((select count(*)::int from public.calendar_follows), 1, 'Users see only their own follows');
select ok((select my_reminder from public.calendar_agenda where my_reminder is not null limit 1) = 15, 'The agenda shows my reminder');
select lives_ok($$ insert into public.calendar_feeds default values $$, 'Users can create their calendar feed');
select lives_ok($$ insert into public.calendar_submissions (title, event_type, starts_at) values ('Mega Evolution ETB preorder', 'preorder_open', now() + interval '3 days') $$, 'Users can suggest a drop');
select throws_ok($$ insert into public.calendar_submissions (title, event_type, starts_at, status) values ('Sneaky', 'preorder_open', now(), 'ingested') $$, '42501', null, 'Users cannot mark their own submission ingested');
select is((select count(*)::int from public.restock_leads), 0, 'Users cannot read restock leads');

reset role;
set local role anon;
select throws_ok($$ select public.ics_feed('nope') $$, 'PT404', 'unknown feed', 'An unknown feed token is rejected');
reset role;
select ok(
  convert_from(public.ics_feed((select token from public.calendar_feeds where user_id = 'ffffffff-0000-4000-8000-000000000006')), 'UTF8') like 'BEGIN:VCALENDAR%END:VCALENDAR%',
  'The ICS feed returns a calendar'
);

select * from finish();
rollback;
