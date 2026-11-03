-- Phase 3: calendar pipeline, reminders, ICS feed, community submissions, restock leads and stats.

-- ---------------------------------------------------------------------------
-- Calendar events: estimates and review state
-- ---------------------------------------------------------------------------
alter table public.calendar_events add column is_estimate boolean not null default false;
alter table public.calendar_events add column review_status text not null default 'auto'
  check (review_status in ('auto', 'pending', 'approved', 'rejected'));
alter table public.calendar_events add column cancelled_at timestamptz;

-- Raw items carry a trust level so the pipeline can decide confirmed vs rumored.
alter table public.calendar_source_items add column trust text not null default 'news'
  check (trust in ('official', 'retailer', 'news', 'community', 'history'));
alter table public.calendar_source_items add column event_id uuid references public.calendar_events (id) on delete set null;

-- Editors' queue: unpublished, rumored or conflicting events.
create view public.calendar_review_pending with (security_invoker = true) as
  select e.*, p.name as product_name
  from public.calendar_events e
  left join public.products p on p.id = e.product_id
  where e.review_status = 'pending'
  order by e.starts_at;

-- ---------------------------------------------------------------------------
-- Follows (reminders) and per-user ICS feed tokens
-- ---------------------------------------------------------------------------
create table public.calendar_follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  remind_minutes_before int not null default 15 check (remind_minutes_before between 0 and 10080),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table public.calendar_feeds (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Community submissions (rumored until an official source matches)
-- ---------------------------------------------------------------------------
create table public.calendar_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 3 and 140),
  event_type text not null check (event_type in ('set_release', 'preorder_open', 'retailer_street_date', 'prerelease', 'restock_window', 'pc_drop')),
  retailer_id text references public.retailers (id),
  product_id uuid references public.products (id) on delete set null,
  starts_at timestamptz not null,
  source_url text check (length(source_url) <= 2000),
  note text check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'ingested', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Restock leads (newsletters, RSS, sightings): trigger a verifying poll, never alert alone
-- ---------------------------------------------------------------------------
create table public.restock_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('email', 'rss', 'sighting', 'community')),
  retailer_id text references public.retailers (id),
  product_id uuid references public.products (id) on delete set null,
  retailer_sku_id uuid references public.retailer_skus (id) on delete set null,
  url text,
  excerpt text,
  kind text not null default 'restock' check (kind in ('restock', 'preorder', 'unknown')),
  created_at timestamptz not null default now(),
  verified_state text
);

-- ---------------------------------------------------------------------------
-- Restock stats per retailer SKU (nightly)
-- ---------------------------------------------------------------------------
create table public.restock_stats (
  retailer_sku_id uuid primary key references public.retailer_skus (id) on delete cascade,
  restocks_30d int not null default 0,
  restocks_90d int not null default 0,
  median_in_stock_min int,
  typical_dow int check (typical_dow between 0 and 6),   -- 0 = Sunday, America/New_York
  typical_hour int check (typical_hour between 0 and 23),
  pattern_share real,                                      -- share of restocks in the typical slot
  last_restock_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.calendar_follows enable row level security;
alter table public.calendar_feeds enable row level security;
alter table public.calendar_submissions enable row level security;
alter table public.restock_leads enable row level security;
alter table public.restock_stats enable row level security;

create policy "Users manage own follows" on public.calendar_follows for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users read own feed" on public.calendar_feeds for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create own feed" on public.calendar_feeds for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users read own submissions" on public.calendar_submissions for select to authenticated using (user_id = (select auth.uid()));
create policy "Users submit calendar items" on public.calendar_submissions for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
create policy "Signed-in users read restock stats" on public.restock_stats for select to authenticated using (true);
-- restock_leads: service role only.

-- ---------------------------------------------------------------------------
-- ICS feed served straight from PostgREST as text/calendar:
--   GET /rest/v1/rpc/ics_feed?token=...&apikey=<anon key>
-- ---------------------------------------------------------------------------
-- PostgREST serves functions returning the "*/*" domain raw for any Accept header.
create domain "*/*" as bytea;

create or replace function public.ics_escape(s text)
returns text language sql immutable set search_path = ''
as $$ select replace(replace(replace(replace(coalesce(s, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n') $$;

-- `apikey` is accepted and ignored: calendar apps can only pass the anon key in the URL.
create or replace function public.ics_feed(token text, apikey text default null)
returns "*/*"
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid;
  body text;
begin
  select f.user_id into uid from public.calendar_feeds f where f.token = ics_feed.token;
  if uid is null then
    raise exception 'unknown feed' using errcode = 'PT404';
  end if;
  select string_agg(
    concat_ws(E'\r\n',
      'BEGIN:VEVENT',
      'UID:' || e.id || '@drophawk.app',
      'DTSTAMP:' || to_char(e.updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTSTART:' || to_char(e.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTEND:' || to_char((e.starts_at + interval '30 minutes') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'SUMMARY:' || public.ics_escape(case when e.status = 'rumored' then '[Rumored] ' else '' end || e.title),
      'DESCRIPTION:' || public.ics_escape(
        case when e.is_estimate then 'Estimate based on past restocks. ' else '' end ||
        'Status: ' || e.status || coalesce('. Retailer: ' || r.name, '') || '. drophawk://calendar?event=' || e.id),
      'STATUS:' || case e.status when 'confirmed' then 'CONFIRMED' when 'cancelled' then 'CANCELLED' else 'TENTATIVE' end,
      'BEGIN:VALARM', 'TRIGGER:-PT' || coalesce(cf.remind_minutes_before, 15) || 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' || public.ics_escape(e.title), 'END:VALARM',
      'END:VEVENT'),
    E'\r\n' order by e.starts_at)
  into body
  from public.calendar_events e
  left join public.retailers r on r.id = e.retailer_id
  left join public.calendar_follows cf on cf.event_id = e.id and cf.user_id = uid
  where e.published
    and e.starts_at > now() - interval '7 days'
    and (
      cf.user_id is not null
      or e.product_id in (select w.product_id from public.watches w where w.user_id = uid)
    );
  perform set_config('response.headers',
    '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Content-Disposition": "inline; filename=drophawk.ics"}, {"Cache-Control": "max-age=900"}]', true);
  return convert_to(concat_ws(E'\r\n', 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DropHawk//Drop Calendar//EN', 'CALSCALE:GREGORIAN',
                   'X-WR-CALNAME:DropHawk drops', body, 'END:VCALENDAR') || E'\r\n', 'UTF8');
end;
$$;

grant execute on function public.ics_feed(text, text) to anon, authenticated;

-- Calendar app view: published events with product name and the caller's follow.
create view public.calendar_agenda with (security_invoker = true) as
  select e.id, e.title, e.event_type, e.retailer_id, e.starts_at, e.timezone, e.status, e.confidence,
         e.is_estimate, e.sponsored, e.source_refs, e.product_id, e.set_name,
         p.name as product_name,
         (select cf.remind_minutes_before from public.calendar_follows cf where cf.event_id = e.id and cf.user_id = auth.uid()) as my_reminder
  from public.calendar_events e
  left join public.products p on p.id = e.product_id
  where e.published and e.starts_at > now() - interval '1 day';
