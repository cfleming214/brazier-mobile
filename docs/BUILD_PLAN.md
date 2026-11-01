# DropHawk Build Plan: Pokémon TCG First

> Status: proposal, not yet started · Scope: **Pokémon TCG sealed product, US retailers** · Sources: `PLAN.md`, `FEATURES.md`

This plan turns `PLAN.md` (the 4-week Expo + Supabase MVP) and `FEATURES.md` (the full vision) into a build sequence. The first release covers one category, Pokémon TCG, so the catalog, parsers, calendar sources and tests stay small enough to finish. Each section notes how it **generalizes later** so adding sneakers, GPUs or Funko means adding data and adapters, not reworking the system.

---

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Category scope | Pokémon TCG **sealed** (ETBs, booster bundles, booster boxes, collections, tins, Pokémon Center exclusives) | The highest-demand restock category in `FEATURES.md`. Singles are a price-tracking problem, not a restock problem, so they wait for the Comp Tracker. |
| Retailers at launch | Best Buy, Target, Walmart, GameStop, Pokémon Center, then Amazon and TCGplayer | Prefer retailers that have **official APIs** (Best Buy, Walmart, Amazon). The others use low-rate structured-data reads. |
| Mobile | Expo (**latest stable SDK at scaffold time**; `PLAN.md` says SDK 51, which is outdated by now) + Expo Router + TypeScript | Same stack as `PLAN.md`. |
| Backend | Supabase (Postgres, Auth, RLS, Realtime, Edge Functions) **plus one long-running TypeScript worker service** (Fly.io or Railway) | Edge Functions have execution-time limits and are a poor fit for a continuous poller. Use **Postgres queues (`pgmq`)** in place of Kafka until volume justifies Kafka. |
| Detection target | 30 s to 5 min adaptive polling, **burst to ~5 s** inside a confirmed drop window, only on retailers whose policy allows it | The 250 ms burst, rotating residential egress and 2-of-3 quorum in `FEATURES.md` are v2 work, and they need a per-retailer legal/ToS review first. |
| Checkout | **Cart-ready checkout in the MVP**: when an armed watch goes live, the bot adds the item to the user's own retailer cart and fills shipping and billing, then **stops at the review step**. The user gets a "Ready to buy" push and taps Buy to place the order. The bot never submits orders. Payment vault is built behind a production-shaped interface with a **mock** provider. CAPTCHAs, queues and human verification are handed to the user, never solved or bypassed. | Gets the user to the last tap in seconds while the purchase stays the user's own action, and keeps real card data out of scope until a real vault provider and PCI review. |
| Policy | Every retailer adapter ships with a `RetailerPolicy` object: max request rate, allowed endpoints, whether automation is allowed, and an enabled switch. **Retailer terms do not gate the MVP**; a terms review (DROP-54) happens before public launch. | Keeps rate limits and kill switches in code from day one. |

---

## 2. System architecture (v1)

```
┌──────────── Mobile (Expo) ────────────┐
│ Radar · Watch Detail · Add Watch      │
│ Calendar · Profile · Checkout Sheet   │
│ TanStack Query + MMKV · Zustand       │
└───────▲───────────────┬───────────────┘
        │ push (APNs/FCM│ via Expo Push)  │ REST / RPC / Realtime
        │               ▼
┌───────┴──────────── Supabase ─────────────────────────────┐
│ Postgres: products, retailer_skus, watches, stock_events, │
│           calendar_events, sightings, push_tokens, ...    │
│ Edge Functions: parse-url, search-catalog, register-push, │
│                 calendar-ics, admin-review                │
│ pg_cron: schedule tick, calendar ingestion, digest        │
│ pgmq: poll_jobs, stock_events_out, notify_jobs            │
└───────▲──────────────────────┬────────────────────────────┘
        │                      │
┌───────┴────────── Worker service (Node/TS) ───────────────┐
│ Scheduler → Poller (per-retailer adapters + rate governor)│
│ → Detector (state diff, debounce, ghost-restock filter)   │
│ → Notifier (rule match → Expo Push batch)                 │
│ Calendar ingesters (per source) → normalizer → review     │
└───────────────────────────────────────────────────────────┘
```

**Generalizes later:** adapters, calendar sources and catalog seeders are plugin registries keyed by `category` and `retailer`. If volume demands it, `pgmq` can be swapped for Kafka behind a `Queue` interface.

---

## 3. Data model (initial migration)

- `categories` (seeded with `pokemon_tcg`)
- `products`: canonical product. `id, category_id, name, set_name, product_type (etb|booster_bundle|booster_box|collection|tin|blister|other), upc, msrp_cents, image_url, release_date, is_exclusive, exclusive_retailer_id`
- `retailers`: `id, slug, name, policy jsonb, adapter_version`
- `retailer_skus`: `id, product_id, retailer_id, retailer_sku, url, last_state, last_price_cents, last_checked_at, poll_tier`
- `stock_events`: append-only. `id, retailer_sku_id, prev_state, new_state, price_cents, qty_hint, source (poll|api|feed|sighting), confidence, observed_at`
- `watches`: `id, user_id, product_id, retailer_ids[], max_price_cents, include_marketplace bool, pickup_radius_km, location (h3), paused`
- `alerts`: `id, watch_id, stock_event_id, sent_at, delivered_at, opened_at` (feeds Hit Rate Analytics)
- `push_tokens`: `user_id, expo_token, platform, last_seen_at`
- `calendar_events`: `id, product_id null, title, event_type (set_release|preorder_open|retailer_street_date|prerelease|restock_window|pc_drop), retailer_id null, starts_at, timezone, status (rumored|confirmed|cancelled), confidence, source_refs jsonb, published bool`
- `calendar_source_items`: raw ingested rows. `source, external_id, payload jsonb, fetched_at, hash`
- `sightings`: `user_id, retailer_id, store_number, product_id, photo_url, reported_at, upvotes, verified`
- `checkout_profiles`: **device-only** in expo-secure-store for v1, never sent to the server

RLS: users can read and write only their own `watches`, `alerts`, `push_tokens` and `sightings`. Catalog, calendar and stock tables are read-only for clients and written by the service role only.

---

## 4. Pokémon catalog seeding

1. **Set list:** import expansions and release dates from the Pokémon TCG API (`pokemontcg.io`, `/v2/sets`). This gives canonical set names and dates.
2. **Sealed products:** that API covers cards only, so sealed SKUs come from:
   - TCGplayer catalog data (sealed-product groups per set), pulled from the daily **TCGCSV** mirror (`tcgcsv.com`) because TCGplayer no longer issues new API keys;
   - retailer listings (Best Buy Products API search, Walmart affiliate API search) to capture **UPCs** and retailer SKU IDs;
   - an admin form for curated items such as Pokémon Center exclusives and Costco bundles.
3. **Matching:** match on UPC first, then normalized title (strip "Pokémon TCG:", unify "Elite Trainer Box"/"ETB", etc.) plus set name and product type. Anything below the confidence threshold goes to the **admin review queue** (FEATURES §1 human-in-the-loop). Embedding and image-hash matching wait until a second category arrives.
4. **Done when:** the last ~4 sets and the next announced set each have their core sealed SKUs mapped to every launch retailer that carries them.

---

## 5. Getting the latest restocks

Restock detection draws on four kinds of source, from most to least trusted.

### 5.1 First-party polling (primary source)

One adapter per retailer implements:

```ts
interface RetailerAdapter {
  slug: string;
  policy: RetailerPolicy;                 // rate limits, allowed endpoints, automation flag
  parseUrl(url: string): RetailerSkuRef | null;
  fetchAvailability(refs: RetailerSkuRef[]): Promise<AvailabilityResult[]>; // batch where API allows
  searchCatalog?(q: string): Promise<RetailerListing[]>;
}
```

| Retailer | Preferred source | Notes |
|---|---|---|
| Best Buy | **Official Products API** (`onlineAvailability`, `inStoreAvailability`, store availability endpoint) | Free API key, batch lookups by SKU. Best first adapter. |
| Walmart | **Walmart affiliate / Walmart.io product APIs** (`stock` field) | Filter out third-party marketplace sellers so they don't trigger ghost restocks. |
| Amazon | **Product Advertising API** (offers/availability), or its successor | Requires an Associates account with qualifying sales, so it may arrive late. Doubles as an affiliate revenue source. |
| Target | Product-page structured data (JSON-LD / embedded fulfillment JSON), low rate | No public API. Policy object sets conservative rates; per-store pickup checks only for active watches. |
| GameStop | Product-page structured data, low rate | Same approach as Target. |
| Pokémon Center | Product-page structured data at very low rate, **plus calendar and community signals** | Heavy bot protection and a queue system. **Never** attempt to bypass the queue or challenges. Treat it as "alert only, user checks out manually". |
| TCGplayer | TCGCSV daily mirror for listings and prices | Marketplace, so useful for comps more than restocks. |

**Adaptive scheduling:** `poll_tier` is set by watcher count, the calendar (a confirmed window starting within 10 minutes means burst tier) and restock history. Each retailer has a token-bucket rate governor and a circuit breaker that backs off on 429/403.

**Detection:** a state transition is `OUT_OF_STOCK|UNKNOWN → IN_STOCK`. Before firing, the detector:
- confirms with a second read 1 to 3 s later (a lightweight quorum);
- suppresses price-only changes, marketplace or third-party sellers, shipping-method toggles and pickup-only flips that fall outside the user's radius;
- debounces flapping by requiring the SKU to have been out of stock for at least N minutes before a new alert.

### 5.2 Retailer feeds and official notifications
- Subscribe to retailer and brand **newsletters** in a dedicated inbox. Parse them with an email-ingestion Edge Function (Postmark/SES inbound) to pick up "available now" and preorder announcements.
- Use RSS or Atom feeds wherever a retailer or news site publishes them.

### 5.3 Community signals (Cop Feed / sightings)
- In-app **sightings** (store number, photo, timestamp) are a separate low-confidence source. They never fire tier-1 alerts on their own. A sighting is promoted once a reputation-weighted threshold is met or a poll confirms it (FEATURES §10).
- Optional and later: monitor public channels such as Reddit (r/PKMNTCGDeals via the official Reddit API) for keyword matches. These are **leads for the poller to verify**, never alerts by themselves.

### 5.4 Restock history and intelligence
- Every confirmed transition is written to `stock_events`. That table powers each SKU's history chart, its typical day and hour, its average time to sell out, and later the prediction model in FEATURES §6.
- v1 shows **descriptive stats only** (for example "last 5 restocks: Thu 3–4am ET, median 6 min in stock"). The gradient-boosted predictor ships only once a SKU has enough events, and only above the 70% confidence floor from `FEATURES.md`.

**Generalizes later:** a new category reuses the same adapters (Best Buy and Walmart also sell GPUs and Funko) and only needs catalog seeding plus category-specific ghost filters.

---

## 6. Getting release calendars

The calendar has an ingestion pipeline (source → raw → normalize → dedupe → review → publish) and an editorial override.

### 6.1 Sources for Pokémon TCG

| Source | What it gives | Method | Default status |
|---|---|---|---|
| Official Pokémon TCG site and press releases (pokemon.com news / product pages) | Set names, street dates, product lineups | Scheduled fetch and parse of news and product pages, plus manual entry | **Confirmed** |
| Pokémon TCG API (`/v2/sets`) | Release dates for sets that are already out | API | Confirmed (backfill and verification) |
| Pokémon Center | Preorder and exclusive product pages, "coming soon" listings | Low-rate page fetch on new-product listings | Confirmed once the listing is live |
| Retailer listings (Best Buy, Walmart, Target, GameStop, Amazon) | Preorder availability and retailer street dates | The adapters' `searchCatalog` run daily against upcoming set names | Confirmed per retailer |
| Distributor and hobby-shop preorder announcements | Early product lists and dates | Manual or editorial entry with source link | Rumored → confirmed |
| TCG news and community sites (e.g. PokeBeach, PokeGuardian, Serebii) | Early reveals, international dates, leaks | RSS where available, otherwise editor-curated with a citation, respecting each site's terms | **Rumored** until an official source confirms |
| Community submissions in the app | Local restock windows and store reset days | In-app form with reputation-weighted verification | Rumored |
| Own `stock_events` history | Recurring restock windows ("Walmart.com restocks tend to hit Thu ~3am ET") | Derived nightly | "Estimate", always labeled |

### 6.2 Pipeline
1. Ingesters (one per source, run by `pg_cron` or the worker) write to `calendar_source_items` with a content hash, so a re-run with no changes is a no-op.
2. The normalizer maps each item to `calendar_events` (product match through the catalog matcher, timezone resolution, event type).
3. Dedupe and merge on (product or set, event type, retailer, date ±1 day). Merged events keep **every source ref**, and confidence is computed from the sources: any official source means confirmed.
4. Low-confidence or conflicting items go to the **admin review queue**. Editors can publish, edit or reject. Sponsored entries carry an explicit `sponsored` flag and badge, per the Monetisation section of `PLAN.md`.
5. Publishing a confirmed window: schedule burst polling at T-10 min, send reminders to users who set them, and allow one-tap conversion of the event into a watch.

### 6.3 Delivery to users
- Calendar screen: agenda view, filter pills (set release / preorder / retailer / restock window), countdown chips, rumored/confirmed badges.
- Local reminders through Expo Notifications (scheduled on device) plus server push for changes ("date moved", "preorder live now").
- An **ICS feed** per user (Edge Function `calendar-ics`) so drops can show up in Google or Apple Calendar.

---

## 7. Mobile app scope (v1)

Screens (from `PLAN.md`), adjusted for Pokémon:
- **Radar (Home):** watches grouped Live Now / Monitoring / Sold Out, `<WatchCard />` with live badge, price vs. MSRP, last-checked ticker.
- **Add Watch:** three entry points: **catalog search** (primary, "Prismatic Evolutions ETB" arms every retailer), **URL paste** (`parse-url` Edge Function) and **barcode scan** (expo-camera, matched by UPC). Then retailer toggles, max price, "include marketplace sellers" (off by default) and pickup radius.
- **Watch Detail:** per-retailer state, restock history chart, typical restock times, alert toggles.
- **Calendar:** see §6.3.
- **Checkout Sheet:** deep link to the retailer app if installed, otherwise expo-web-browser. Profile chips copy to the clipboard, with an elapsed-time header.
- **Profile:** notification permission diagnostic (`<AlertPermissionGate />`), checkout profiles (device-only), hit-rate stats, subscription.

**Design direction (chosen):** the command-center Radar in `mockups/home-radar.html`. Dark console, amber for controls, green/blue/red for in stock / monitoring / sold out, mono type for telemetry. Order on the home screen: system strip, KPI tiles, retailer adapter health, next drop window, Live Now cards, Monitoring rows, event stream. The add-watch button sits in the centre of the tab bar. `home-styles.html` and `home-status.html` are alternatives we passed on, kept for reference.

**Notifications (beyond restock alerts):**
- *Drop updates* (DROP-86): new drop for a followed set, rumored → confirmed, date moved or cancelled, preorder open, T-10 window, new retailer listing, price change, restock pattern change.
- *Bot status* (DROP-87): armed/disarmed, readiness lost (session expired, payment missing; repeated at T-30), retailer queue or adapter degraded, attempt started, Your turn, Ready to buy, stopped, expired, order confirmed. Attempt updates collapse into one notification that updates in place.
- *Settings* (DROP-88): per-category toggles (restock, bot status, drop updates, reminders, community), per-watch overrides, quiet hours that never silence Ready to buy / Your turn / restock unless opted in, and a daily digest option for drop updates.
- *Inbox* (DROP-89): the Radar bell opens a history of every notification, kept even when push is off.

Push: Expo Push with `priority: high` and an iOS `interruptionLevel` of `time-sensitive`. **Critical alerts** need an Apple entitlement request, so v1 runs without them. A notification category with a "Go to Checkout" action deep-links via Expo Router (`drophawk://watch/:id?go=1`).

---

## 8. Phased roadmap

Each phase ends with a demo and its E2E suite green in CI.

### Phase 0: Foundations (week 1)
- Monorepo (pnpm workspaces): `apps/mobile`, `services/worker`, `supabase/` (migrations, functions, seed), `packages/shared` (types, Zod schemas, adapter interface), `e2e/`.
- Expo app scaffold, NativeWind, tab + modal shell, EAS projects (dev, preview, prod).
- Supabase project and local `supabase start`; initial migration and RLS; magic-link auth.
- CI: lint, typecheck, unit tests, `supabase db lint`, migration check.
- **Test harness skeleton** (see §10): fake-retailer server, Maestro set up, seeded test DB.

### Phase 1: Catalog + watches (week 2)
- Pokémon set import and sealed-product seeding; admin review queue (a simple web page or Supabase Studio views to start).
- Catalog search, URL parser (Best Buy, Target, Walmart, GameStop, Pokémon Center), barcode scan.
- Add Watch flow, Radar on real data, offline cache with MMKV.

### Phase 2: Detection + alerts (weeks 3–4)
- Worker service: scheduler, Best Buy and Walmart API adapters, then Target, GameStop and Pokémon Center structured-data adapters, each with a policy object and rate governor.
- Detector with confirmation read, ghost filters and debounce; writes `stock_events`.
- Notifier: rule matching, Expo Push batching, receipt polling, `alerts` rows.
- Push token registration, notification categories, deep link to Watch Detail and Checkout Sheet.
- **Latency budget for v1:** stock change observed → push accepted by Expo in **≤ 3 s p95**, measured in E2E (§10.4).

### Phase 3: Release calendar + restock history (week 5)
- Ingesters (official site, pokemontcg.io, retailer preorder search, Pokémon Center new listings), normalizer, dedupe, review queue.
- Calendar screen, reminders, ICS feed, convert event to watch, burst polling at T-10.
- Restock history chart and descriptive stats on Watch Detail.

### Phase 4: Checkout assist + monetization + beta (week 6)
- Checkout Sheet and autofill profiles in expo-secure-store.
- RevenueCat: free tier (3 watches, slower tier) and Pro (unlimited, faster tier), per `PLAN.md`.
- Sentry, PostHog (or similar) analytics, EAS Update channels, TestFlight / Play Internal beta.

### Phase 5: Community + intel (post-beta)
- Sightings / Cop Feed (Realtime, upvotes, reports, moderation), reputation scores.
- Comp and profit tracker from the TCGCSV and eBay APIs (FEATURES §8).
- Hit Rate Analytics weekly digest.

### Cart-ready checkout (MVP, Jira epic DROP-70)
- Payment vault interface with a mock provider (test tokens only; production refuses to boot with the mock)
- Retailer account linking with an encrypted session vault and session health checks
- Checkout state machine (`CART → AUTH → SHIP → PAY → REVIEW`, ending in `READY_TO_BUY`; no bot submit step), ephemeral browser runner, cart-and-fill flows for Best Buy, Walmart, Target and GameStop
- "Ready to buy" push with a countdown; the user opens the filled checkout (or the retailer app cart) and taps Place order
- Challenge detection with a "Your turn" handoff to the user (no CAPTCHA solving or queue bypass), Arm UI, Live Attempt Feed, and fake-retailer E2E scenarios asserting no order is ever placed without the user's tap

### Squad Mode (Jira epic DROP-71, after Phase 5 sightings and reputation)
- Squads with shared watchlists, squad drop channel and sighting sharing, leaderboard and Discord/webhook relay

### Later (gated)
- Real payment vault provider and PCI scope review (replaces the mock)
- Retailer terms review before public launch (DROP-54)
- Multi-profile manager, Inventory Vault, Kafka migration, prediction model.
- **New categories:** add a `categories` row, a catalog seeder, category-specific ghost filters, calendar sources, and retailer adapters if any are new. Expected order: Funko and other collectibles (same retailers), then GPUs/consoles (Best Buy and Walmart adapters reused), then sneakers (new retailers and raffles).

---

## 9. Non-functional requirements

- **Compliance:** a policy object per retailer, a request budget enforced in code, a user-agent that identifies DropHawk, no evasion of bot protection, and an off switch per retailer (`retailers.policy.enabled`).
- **Reliability:** idempotent jobs (keyed by `retailer_sku_id + observed_at bucket`), dead-letter queues, and an adapter health dashboard with alerts when an adapter's success rate drops.
- **Security:** checkout profiles stay on the device, the service-role key lives only in the worker and Edge Functions, RLS tests run in CI, and a secrets scan runs in CI.
- **Observability:** structured logs plus OpenTelemetry traces that carry one `trace_id` from poll → detect → notify; Sentry on mobile and worker.

---

## 10. Testing strategy (including end-to-end)

### 10.1 Test pyramid
| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Vitest (worker, shared), Jest + React Native Testing Library (mobile) | URL parsers, title normalizer, matcher, detector state machine, ghost filters, rule bitmask, calendar dedupe/merge, timezone math |
| DB | pgTAP via `supabase test db` | RLS policies (user A cannot read user B's watches), constraints, triggers, `stock_events` append-only |
| Edge Functions | Deno test + local Supabase | `parse-url`, `search-catalog`, `register-push`, `calendar-ics` |
| Adapter contract | Vitest + **recorded fixtures** (stored response snapshots per retailer) | Each adapter parses in-stock / OOS / marketplace-only / preorder / delisted fixtures correctly |
| Integration | Worker + local Supabase + **fake retailer server** + **fake push server** | Full poll → detect → notify loop without touching real retailers or APNs |
| **E2E (mobile)** | **Maestro** flows against a dev-client build on iOS Simulator and Android Emulator | User journeys through the real UI and real (local) backend |
| Live canaries | Scheduled GitHub Action, low-rate | Real retailer and calendar sources still parse: catches site changes early |

### 10.2 E2E test environment
- **`e2e/fake-retailer`**: a small HTTP server that mimics each adapter's endpoints (Best Buy API shape, Target page JSON, etc.) and serves the recorded fixtures. It exposes a control API (`POST /control/sku/:id/state {IN_STOCK, price}`) so tests can **flip stock on demand**.
- **`e2e/fake-push`**: an Expo-Push-compatible endpoint that records payloads and also forwards to the simulator (`xcrun simctl push` / `adb` for Android) so the notification really appears on the device.
- **Seeded backend**: `supabase start` plus `supabase/seed.sql` with a test user, the Pokémon catalog subset and calendar fixtures. The worker runs with `RETAILER_BASE_URL_OVERRIDES` pointing at the fake retailer and a fast tick.
- **Deterministic time**: injectable clock in the worker; calendar fixtures expressed relative to "now".
- Auth in E2E: a test-only magic-link bypass (an OTP code fixed by env var, in local/CI only).

### 10.3 E2E scenarios (Maestro flows)
1. **Onboarding:** sign in → grant notifications → `<AlertPermissionGate />` passes.
2. **Watch via catalog:** search "Prismatic Evolutions ETB" → select → all launch retailers armed → appears in Radar under Monitoring.
3. **Watch via URL paste:** paste a Best Buy URL and a Target URL → parsed preview matches the canonical product → saved.
4. **Restock alert happy path:** flip the SKU to IN_STOCK on the fake retailer → assert the push arrives on the simulator within budget → tap "Go to Checkout" → app opens the Checkout Sheet with the right retailer URL → Radar shows Live Now.
5. **Filter suppression:** flip to IN_STOCK above the max price, as marketplace-only, or as pickup outside the radius → assert **no** push and that a `stock_events` row exists with no matching `alerts` row.
6. **Ghost restock / flapping:** IN_STOCK → OOS within the confirmation window → no alert. Fast repeated flips → one alert.
7. **Calendar:** confirmed event visible with countdown → set reminder → local notification fires (clock advanced) → convert to watch → T-10 burst tier applied (asserted via worker metrics endpoint).
8. **Calendar ingestion:** load a rumored item and an official item for the same product → a single merged, confirmed event with both source refs.
9. **Offline:** kill the network → Radar renders from the MMKV cache → reconnect → state reconciles.
10. **Free-tier limit:** add a 4th watch → paywall (RevenueCat sandbox / test store).
11. **Deep link cold start:** app killed → push tapped → lands on Watch Detail.
12. **Account isolation:** user B cannot see user A's watches (UI plus API).

### 10.4 Pipeline latency test
An integration test measures `fake-retailer flip → push recorded by fake-push`, asserts p95 ≤ 3 s over 50 flips, and publishes the number as a CI artifact so regressions are visible.

### 10.5 CI/CD
- **On every PR:** lint, typecheck, unit, pgTAP, Edge Function tests, adapter contract tests, worker integration tests (Docker Compose: Supabase + fake retailer + fake push + worker).
- **On main and nightly:** EAS build (dev-client, simulator/emulator profile), then the Maestro E2E suite on an Android emulator (GitHub Actions, KVM) and an iOS simulator (macOS runner or Maestro Cloud).
- **Nightly live canaries:** one real request per adapter and calendar source at polite rates. A failure opens a GitHub issue tagged `adapter-broken` and flips that adapter to degraded mode.
- **Pre-release:** a manual real-device smoke test on TestFlight / Play Internal with real APNs/FCM delivery (critical-path checklist).

---

## 11. Risks and open questions

1. **Retailer ToS and bot protection.** Target, Pokémon Center and GameStop may restrict automated access. Mitigations: low rates, policy objects, official APIs first, and dropping or degrading any source that objects. Needs a legal review before launch.
2. **API access gating.** Amazon PA-API needs qualifying affiliate sales, and TCGplayer is closed to new API keys. Plan without them and add them when access exists.
3. **Push latency with Expo Push.** Probably fine for v1. If the p95 target can't be met, move to direct APNs/FCM with pre-warmed connections (FEATURES §3).
4. **Calendar accuracy.** Rumored dates can damage trust, so every event shows a clear rumored/confirmed badge and its sources, and confirmed status requires an official source.
5. **Open question:** US-only at launch? (Assumed yes. International sits in the v2 roadmap in `FEATURES.md`.)
6. **Open question:** do we want the admin/editorial tool as a separate web app (Next.js) or Supabase Studio plus SQL views to start? (Assumed Studio for v1.)
