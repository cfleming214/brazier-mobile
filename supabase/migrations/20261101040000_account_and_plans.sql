-- Phase 4 (non-checkout parts): free-tier watch limit, hit-rate tracking, account export and deletion.

-- ---------------------------------------------------------------------------
-- Hit rate: when the user opened the retailer from an alert
-- ---------------------------------------------------------------------------
alter table public.alerts add column cart_opened_at timestamptz;
grant update (opened_at, cart_opened_at) on public.alerts to authenticated;

create or replace function public.mark_cart_opened(p_watch_id uuid)
returns void language sql security invoker set search_path = ''
as $$
  update public.alerts set cart_opened_at = coalesce(cart_opened_at, now()), opened_at = coalesce(opened_at, now())
  where id = (select id from public.alerts where watch_id = p_watch_id and user_id = auth.uid() order by sent_at desc limit 1)
$$;

create or replace view public.hit_rate_stats with (security_invoker = true) as
  select
    a.user_id,
    count(*)::int as alerts_received,
    count(a.cart_opened_at)::int as carts_opened,
    round(avg(extract(epoch from (a.cart_opened_at - a.sent_at))) filter (where a.cart_opened_at is not null))::int as avg_response_seconds
  from public.alerts a
  group by a.user_id;

-- ---------------------------------------------------------------------------
-- Plans: free tier allows 3 active watches (PLAN.md Monetisation)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_watch_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  user_plan text;
  active int;
begin
  if new.paused then return new; end if;
  select plan into user_plan from public.profiles where id = new.user_id;
  if coalesce(user_plan, 'free') <> 'free' then return new; end if;
  select count(*) into active from public.watches where user_id = new.user_id and not paused and id <> new.id;
  if active >= 3 then
    raise exception 'FREE_LIMIT: free plan allows 3 active watches' using errcode = 'P0001', hint = 'upgrade';
  end if;
  return new;
end;
$$;

create trigger watches_free_limit before insert or update of paused on public.watches
  for each row execute function public.enforce_watch_limit();

alter table public.profiles add column revenuecat_app_user_id text;
alter table public.profiles add column plan_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- Account tools (Profile & Settings)
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'watches', coalesce((select jsonb_agg(to_jsonb(w)) from public.watches w where w.user_id = auth.uid()), '[]'),
    'alerts', coalesce((select jsonb_agg(to_jsonb(a)) from public.alerts a where a.user_id = auth.uid()), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.user_id = auth.uid()), '[]'),
    'calendar_follows', coalesce((select jsonb_agg(to_jsonb(f)) from public.calendar_follows f where f.user_id = auth.uid()), '[]')
  )
$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
