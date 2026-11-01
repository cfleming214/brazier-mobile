-- Phase 2: detection, alerts, telemetry, notification settings and inbox, protection changes.

create extension if not exists pgmq;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Queues (pgmq) behind service-role-only wrapper functions
-- ---------------------------------------------------------------------------
select pgmq.create('poll_jobs');
select pgmq.create('stock_events_out');
select pgmq.create('notify_jobs');
select pgmq.create('dead_letter');

create or replace function public.queue_send(queue_name text, message jsonb, delay_seconds int default 0)
returns bigint language sql security definer set search_path = ''
as $$ select * from pgmq.send(queue_name, message, delay_seconds) $$;

create or replace function public.queue_read(queue_name text, visibility_seconds int, max_messages int)
returns table (msg_id bigint, read_ct int, message jsonb)
language sql security definer set search_path = ''
as $$ select msg_id, read_ct, message from pgmq.read(queue_name, visibility_seconds, max_messages) $$;

create or replace function public.queue_delete(queue_name text, message_id bigint)
returns boolean language sql security definer set search_path = ''
as $$ select pgmq.delete(queue_name, message_id) $$;

revoke execute on function public.queue_send(text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.queue_read(text, int, int) from public, anon, authenticated;
revoke execute on function public.queue_delete(text, bigint) from public, anon, authenticated;
grant execute on function public.queue_send(text, jsonb, int) to service_role;
grant execute on function public.queue_read(text, int, int) to service_role;
grant execute on function public.queue_delete(text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Watches: per-watch alert switch (notification settings override)
-- ---------------------------------------------------------------------------
alter table public.watches add column alerts_enabled boolean not null default true;

-- Nearest-store distance reported by adapters for pickup-only stock (km).
alter table public.retailer_skus add column pickup_only boolean not null default false;
alter table public.retailer_skus add column marketplace_only boolean not null default false;
alter table public.retailer_skus add column confirmations int not null default 0;
alter table public.retailer_skus add column last_in_stock_at timestamptz;
alter table public.retailer_skus add column last_out_of_stock_at timestamptz;

drop view public.watch_overview;
create view public.watch_overview with (security_invoker = true) as
  select
    w.id as watch_id, w.user_id, w.paused, w.alerts_enabled, w.max_price_cents, w.include_marketplace,
    w.pickup_radius_km, w.retailer_ids, w.created_at,
    p.id as product_id, p.name as product_name, p.set_name, p.product_type, p.msrp_cents, p.image_url,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'retailer_id', rs.retailer_id, 'retailer_sku', rs.retailer_sku, 'url', rs.url,
          'state', rs.last_state, 'price_cents', rs.last_price_cents, 'last_checked_at', rs.last_checked_at,
          'poll_tier', rs.poll_tier, 'last_in_stock_at', rs.last_in_stock_at
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

-- ---------------------------------------------------------------------------
-- Telemetry
-- ---------------------------------------------------------------------------
create table public.adapter_health (
  retailer_id text primary key references public.retailers (id),
  status text not null default 'unknown' check (status in ('ok', 'degraded', 'backoff', 'down', 'disabled', 'unknown')),
  latency_ms integer,
  success_rate real,
  checks_per_min integer not null default 0,
  last_error text,
  backoff_until timestamptz,
  active_protections text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.system_metrics (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  retailer_id text references public.retailers (id),
  product_id uuid references public.products (id) on delete cascade,
  kind text not null check (kind in ('poll', 'in_stock', 'out_of_stock', 'suppressed', 'push', 'flap', 'protection', 'error')),
  message text not null,
  created_at timestamptz not null default now()
);
create index activity_events_user_time on public.activity_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notification settings (DROP-88) and inbox (DROP-89)
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  restock boolean not null default true,
  bot_status boolean not null default true,
  drop_updates boolean not null default true,
  reminders boolean not null default true,
  community boolean not null default true,
  drop_updates_digest boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '23:00',
  quiet_end time not null default '07:00',
  quiet_allows_urgent boolean not null default true,
  timezone text not null default 'America/New_York',
  updated_at timestamptz not null default now()
);

create trigger notification_prefs_updated_at before update on public.notification_prefs
  for each row execute function public.set_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('restock', 'bot_status', 'drop_updates', 'reminders', 'community')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  time_sensitive boolean not null default false,
  collapse_key text,
  dedupe_key text,
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sent', 'suppressed_pref', 'suppressed_quiet', 'held_digest', 'no_token', 'failed')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_time on public.notifications (user_id, created_at desc);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- Retailer protection changes (DROP-91)
-- ---------------------------------------------------------------------------
create table public.protection_events (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null references public.retailers (id),
  retailer_sku_id uuid references public.retailer_skus (id) on delete cascade,
  protection text not null,   -- queue | captcha | signin_required | limit:N | raffle | app_only | in_store_only | ratelimit
  active boolean not null,
  seen_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  notified_at timestamptz
);
create index protection_events_lookup on public.protection_events (retailer_id, retailer_sku_id, protection, last_seen desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.adapter_health enable row level security;
alter table public.system_metrics enable row level security;
alter table public.activity_events enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
alter table public.protection_events enable row level security;

create policy "Signed-in users read adapter health" on public.adapter_health for select to authenticated using (true);
create policy "Signed-in users read system metrics" on public.system_metrics for select to authenticated using (true);
create policy "Signed-in users read protection events" on public.protection_events for select to authenticated using (true);
create policy "Users read own activity" on public.activity_events for select to authenticated using (user_id = (select auth.uid()));

create policy "Users read own prefs" on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create own prefs" on public.notification_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update own prefs" on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Users read own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Seed health rows for every retailer.
insert into public.adapter_health (retailer_id, status)
select id, case when (policy->>'enabled')::boolean then 'unknown' else 'disabled' end from public.retailers
on conflict do nothing;

-- Realtime for Radar's live sections and the inbox.
alter publication supabase_realtime add table public.activity_events, public.notifications, public.adapter_health, public.retailer_skus;

-- Mark all of a user's notifications read.
create or replace function public.mark_all_notifications_read()
returns void language sql security invoker set search_path = ''
as $$ update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null $$;

-- ---------------------------------------------------------------------------
-- Worker helpers (service role only)
-- ---------------------------------------------------------------------------

-- Retailer SKUs with at least one active watch, with watcher counts and the nearest confirmed window.
create or replace function public.watched_skus()
returns table (
  id uuid, product_id uuid, retailer_id text, retailer_sku text, url text,
  last_state text, last_price_cents integer, confirmations int,
  last_in_stock_at timestamptz, last_out_of_stock_at timestamptz, last_checked_at timestamptz,
  poll_tier text, watchers int, pro_watchers int, next_window_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select rs.id, rs.product_id, rs.retailer_id, rs.retailer_sku, rs.url,
         rs.last_state, rs.last_price_cents, rs.confirmations,
         rs.last_in_stock_at, rs.last_out_of_stock_at, rs.last_checked_at, rs.poll_tier,
         count(w.id)::int as watchers,
         count(w.id) filter (where p.plan in ('pro', 'pro_squad'))::int as pro_watchers,
         (select min(ce.starts_at) from public.calendar_events ce
           where ce.status = 'confirmed' and ce.published
             and ce.starts_at > now() - interval '30 minutes'
             and (ce.product_id = rs.product_id or (ce.product_id is null and ce.retailer_id = rs.retailer_id))
             and (ce.retailer_id is null or ce.retailer_id = rs.retailer_id)) as next_window_at
  from public.retailer_skus rs
  join public.watches w on w.product_id = rs.product_id and rs.retailer_id = any (w.retailer_ids) and not w.paused
  left join public.profiles p on p.id = w.user_id
  group by rs.id
$$;

revoke execute on function public.watched_skus() from public, anon, authenticated;
grant execute on function public.watched_skus() to service_role;
