# Features

**Brazier** — *Track the drop. Win the checkout. Never refresh again.*

Brazier is a mobile command center for collectors and resellers chasing limited-stock inventory: Pokémon TCG Elite Trainer Boxes, Funko convention exclusives, RTX GPU restocks, and sneaker drops. The product is built around three promises: **know first** (sub-second stock detection), **act fastest** (armed checkout automation), and **know why you won or lost** (full attempt forensics).

---

## Core Features

### 1. Universal Watchlist Builder

Users add a tracked item three ways: pasting any retailer product URL, scanning a UPC/EAN barcode with the camera, or searching Brazier's unified catalog where a single canonical product fans out to every retailer SKU that carries it. Adding "Pokémon Scarlet & Violet — Prismatic Evolutions ETB" once automatically arms watchers at Target, Walmart, Best Buy, GameStop, Costco, Pokémon Center, Troll and Toad, TCGplayer, and Card Kingdom without the user hunting down nine separate links.

**User benefit:** One tap replaces the 20 browser tabs and 9 bookmark folders a serious collector currently babysits, and it guarantees the user never misses the one retailer they forgot to check.

**Tech note:** A canonical product graph keyed on UPC/EAN with fuzzy title-and-image matching (SBERT embeddings over normalized titles + perceptual image hashing) resolves retailer SKUs to a single `product_id`. URL paste runs through a per-retailer parser registry that extracts SKU, TCIN, item ID, or SKU-ID from the path or embedded JSON-LD; unmatched items enter a human-in-the-loop review queue and are published to the catalog within 24 hours.

### 2. Sub-Second Stock Detection Engine

A distributed polling fleet checks every tracked SKU on an adaptive interval — from 30 seconds for cold inventory down to 250ms burst mode when a drop window is predicted or a signal of imminent restock is detected. Detection reads structured inventory endpoints (fulfillment APIs, add-to-cart probes, GraphQL stock queries) rather than scraping rendered HTML, so a flip from `OUT_OF_STOCK` to `IN_STOCK` is confirmed and fanned out in under one second.

**User benefit:** The user is in the queue while everyone else is still waiting for a Twitter bot account or a 5-minute email digest, which is the entire difference between a cart and a sold-out page.

**Tech note:** Regional worker pools (residential + datacenter egress, rotated per retailer policy) publish to a Kafka `stock_events` topic; a dedup/debounce layer suppresses ghost restocks (price-only changes, shipping-method toggles, third-party marketplace sellers) using a 2-of-3 confirmation quorum before firing. Per-retailer rate governors and `robots.txt`/ToS policy objects throttle request volume, and circuit breakers back off automatically on 429/403 patterns. Hot SKUs additionally subscribe to webhook and RSS restock feeds where retailers publish them.

### 3. Priority Push Alerts with Store-Level Targeting

Alerts deliver as high-priority, time-critical push notifications that bypass Focus modes and Do Not Disturb, carrying the retailer, price, stock depth, and a one-tap **Go** button that deep-links straight into the retailer app's cart or launches Brazier's in-app checkout. Users filter by price ceiling, condition, retailer, bundle vs. single, and — for in-store pickup — a radius around their location so a Costco Kirkland warehouse alert never wakes up a user in Tampa.

**User benefit:** Signal, not noise — the user gets woken at 3:04am only for drops they actually want and can actually reach, with the purchase path already one thumb-press away.

**Tech note:** APNs with `interruption-level: time-sensitive` / `critical` (entitlement-gated) and FCM high-priority messages, delivered through a pre-warmed connection pool with payloads precomputed at detection time so fan-out is a memory read, not a database query. Alert rules compile to a bitmask evaluated in-memory per event; geo-filtered alerts use an H3 hex index over store inventory. P99 detection-to-device budget: 900ms.

### 4. Armed Checkout Bot

For any watchlist item, the user can "arm" a checkout profile: shipping address, billing method, quantity, max price, and a hard stop-loss. When that SKU goes live, Brazier executes the full purchase flow — add to cart, apply the saved address and payment, submit the order — against the user's own authenticated retailer session, and either completes the order or hands off to the user at the exact step that needs a human.

**User benefit:** The user wins drops that happen while they're asleep, driving, or in a meeting, without ever having stored a credit card in a sketchy Discord bot.

**Tech note:** Checkout runs as a per-retailer state machine (`CART → AUTH → SHIP → PAY → REVIEW → SUBMIT`) in an isolated ephemeral browser container with the user's cookie jar injected from an encrypted vault. Payment credentials are tokenized and stored in a PCI-DSS SAQ-D compliant HSM-backed vault; the raw PAN is never resident in application memory outside the injection step. **The bot never solves CAPTCHAs, bypasses queue systems, or spoofs human verification** — on any anti-bot challenge it pauses, pushes a "Your turn" alert, and streams the live session to the user's device for a one-tap manual completion. Per-retailer compliance policies can disable automation entirely where ToS prohibits it, degrading gracefully to assisted autofill.

### 5. Live Attempt Feed

The moment a bot fires, the user's phone opens a real-time progress feed: each state transition streams in with timestamps, latency deltas, screenshots of the retailer page, and the final outcome — `ORDERED`, `OUT_OF_STOCK_AT_CART`, `PAYMENT_DECLINED`, `QUEUE_TIMEOUT`, or `HANDOFF_REQUIRED`. Every attempt is archived with a full replay timeline so users can see they lost by 400ms at the payment step rather than wondering what happened.

**User benefit:** Total transparency over a process that is otherwise a terrifying black box, plus the diagnostic detail to fix a bad address, a declining card, or a too-slow profile before the next drop.

**Tech note:** WebSocket channel per attempt (SSE fallback) fed by the checkout state machine's event emitter; screenshots are captured at each transition, PII-redacted server-side (payment fields, full address masked), and written to object storage with 30-day TTL. Attempt records are immutable and append-only for dispute and audit purposes.

### 6. Drop Calendar & Restock Intelligence

A curated, timezone-aware calendar of confirmed and rumored drops — Pokémon Center preorder windows, Target Tuesday TCG resets, Best Buy GPU waves, SNKRS launches — with countdown timers and one-tap pre-arming. Alongside it, per-SKU restock intelligence shows historical restock frequency, typical day/hour, average time-to-sellout, and a confidence-scored prediction for the next window.

**User benefit:** Users stop guessing and start planning — they know a Walmart Pokémon restock historically hits Thursdays at 3:00am ET and lasts 90 seconds, so they arm the bot Wednesday night and go to bed.

**Tech note:** Calendar entries are editorially curated plus community-submitted with a reputation-weighted verification threshold. Prediction is a gradient-boosted model over per-SKU historical `stock_events` (features: weekday, hour, days-since-last-restock, retailer, category seasonality) surfaced only above a 70% confidence floor and always labeled as an estimate. Confirmed calendar windows auto-trigger burst-mode polling at T-10 minutes.

---

## Secondary Features

### 7. Multi-Profile & Proxy Manager

Power users configure multiple checkout profiles — different addresses, cards, and retailer accounts — and assign them per drop or rotate across them for multi-quantity attempts. Each profile can be paired with its own egress identity, with a built-in warm-up checker that validates sessions and flags expired logins before a drop rather than during one.

**User benefit:** Resellers running household-member profiles stop losing drops to a silently expired Target session or a mismatched billing ZIP.

**Tech note:** Profiles are versioned, encrypted-at-rest records (AES-256-GCM, per-user envelope keys via KMS); a nightly health job performs a lightweight authenticated ping per retailer and surfaces a red/amber/green readiness badge. Quantity limits and per-account purchase caps are enforced client-side to keep users inside retailer purchase policies.

### 8. Price & Comp Tracker with Profit Math

Every tracked product shows live retail price alongside recent sold comps from eBay, TCGplayer, and StockX, with an auto-computed margin after platform fees, shipping, and sales tax. Price-drop alerts and a "below comp" filter let users flag items that are profitable right now, not just available.

**User benefit:** The user instantly knows whether a $179.99 restock is a $60 flip or a $4 loss before committing to the checkout.

**Tech note:** Nightly comp ingestion from marketplace APIs into a time-series store with outlier trimming (IQR filter on 30-day sold listings); fee schedules are a configurable per-marketplace rule set so margin math updates when eBay or StockX changes rates.

### 9. Inventory & Order Vault

Successful Brazier orders flow automatically into a personal inventory ledger with cost basis, order number, retailer, arrival status, and tracking. Users mark items as kept, listed, or sold, and the app rolls up spend, realized profit, and a year-end CSV/Schedule-C-friendly export.

**User benefit:** Replaces the spreadsheet every reseller swears they'll keep updated, and turns tax season from an archaeology project into a one-tap export.

**Tech note:** Order records are created from the checkout state machine's confirmation payload and enriched by optional read-only email parsing (Gmail/Outlook OAuth, scoped to shipping-confirmation senders) for orders placed outside the app. Tracking numbers resolve through a carrier aggregation API for delivery status webhooks.

### 10. Squad Mode (Shared Watchlists & Signal Sharing)

Users create or join squads — a local collecting group, a store team, a paid community — that share watchlists, in-store sighting reports with store numbers and shelf photos, and a live drop channel. A leaderboard tracks verified wins and sighting accuracy so reliable members' signals get weighted higher.

**User benefit:** Adds the human layer that no API can see — a shelf-stocked Costco pallet or a GameStop employee's "it's in the back" — delivered to the people most likely to act on it.

**Tech note:** Squad channels run on the same WebSocket infrastructure as the attempt feed with per-squad topic ACLs; sighting reports attach EXIF-stripped photos and are geo-verified against the claimed store's H3 cell. Reputation score is a decayed accuracy average that feeds directly into alert priority weighting.

---

## v2 Roadmap

- **Desktop Companion & Browser Extension** — A macOS/Windows client and Chrome/Safari extension that shares the mobile session, offers native multi-tab cart racing, and lets the checkout state machine run locally on the user's own connection for lower latency and tighter retailer-session fidelity.
- **Brazier Pulse (Predictive Drop API + Public Signal Marketplace)** — Open the restock prediction model and event stream as a rate-limited API for Discord communities and third-party tools, plus a vetted marketplace where trusted sighting providers can monetize verified early signals with revenue share.
- **International & Marketplace Expansion** — Add Amazon, Pop Mart, Argos, Smyths, EB Games AU, Toys"R"Us Canada, and JP retailers (Pokémon Center JP, Amiami, Surugaya) with multi-currency comps, proxy-shipping integration, and region-aware tax/duty math in the profit calculator.