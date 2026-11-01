-- Product analytics (DROP-53). Clients insert their own events; nobody reads them through the API.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event text not null check (event ~ '^[a-z_]{3,40}$'),
  props jsonb not null default '{}' check (pg_column_size(props) < 2048),
  platform text check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);
create index analytics_events_event_time on public.analytics_events (event, created_at desc);

alter table public.analytics_events enable row level security;
create policy analytics_insert_own on public.analytics_events
  for insert to authenticated with check (user_id = auth.uid());
revoke all on public.analytics_events from anon, authenticated;
grant insert (event, props, platform) on public.analytics_events to authenticated;

-- Defense in depth: plans are only ever written by the billing webhook (service role).
revoke insert, update, delete on public.profiles from anon, authenticated;

-- Daily funnel for the ops dashboard (service role only).
create view public.analytics_daily as
  select date_trunc('day', created_at) as day, event, count(*)::int as events, count(distinct user_id)::int as users
  from public.analytics_events group by 1, 2;
revoke all on public.analytics_daily from anon, authenticated;

-- A lapsed subscription counts as free even if the EXPIRATION webhook was missed (1-day grace).
create or replace function public.enforce_watch_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  user_plan text;
  expires timestamptz;
  active int;
begin
  if new.paused then return new; end if;
  select plan, plan_expires_at into user_plan, expires from public.profiles where id = new.user_id;
  if coalesce(user_plan, 'free') <> 'free' and (expires is null or expires > now() - interval '1 day') then
    return new;
  end if;
  select count(*) into active from public.watches where user_id = new.user_id and not paused and id <> new.id;
  if active >= 3 then
    raise exception 'FREE_LIMIT: free plan allows 3 active watches' using errcode = 'P0001', hint = 'upgrade';
  end if;
  return new;
end;
$$;
