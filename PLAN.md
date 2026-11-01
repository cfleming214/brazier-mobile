# DropHawk

> Track the drop. Win the checkout. Never refresh again.

## Overview

DropHawk is a cross-platform Expo + React Native app that monitors limited-release product drops — sneakers, GPUs, concert tickets, trading cards, console restocks — and fires a sub-second push notification the instant stock flips to available. Instead of hammering refresh on a product page, users add a watch, pick their size or variant, and let DropHawk's backend poller do the waiting.

The core promise is speed-to-checkout. Every alert deep-links straight into the merchant's cart or product URL via an in-app browser with autofill-ready checkout profiles, so the gap between "restocked" and "order confirmed" is measured in seconds, not minutes. A community feed layers in crowd-sourced drop intel, confirmed cop receipts, and release calendars so users know what is coming before it lands.

This plan covers a four-week path from scaffold to TestFlight: Expo Router navigation, an Expo Notifications pipeline backed by a Supabase + Edge Function poller, offline-first watch lists via TanStack Query persistence, and a RevenueCat-gated Pro tier for unlimited watches and priority alert queues.

## Tech Stack

- **Expo SDK 51 + React Native (TypeScript)** with Expo Router for file-based navigation, EAS Build/Update for OTA releases, and expo-dev-client for native module testing.
- **Supabase** (Postgres, Row Level Security, Realtime, Edge Functions) as the backend for watch records, drop events, user profiles, and the scheduled stock-check worker.
- **Expo Notifications + expo-task-manager** for high-priority push alerts, notification categories with quick actions, and background sync fallback on Android.
- **TanStack Query v5 + MMKV persister** for cached watch lists, optimistic mutations, and instant cold-start rendering; Zustand for lightweight UI/session state.
- **NativeWind + Reanimated 3 + Expo Haptics** for a dark, high-contrast tactical UI with gesture-driven sheets and countdown animations.

## Features

1. **Drop Radar** — A live dashboard of every tracked item showing current stock state, last-checked timestamp, price delta, and a pulsing indicator when a poll is in flight.
2. **One-Tap Watch Creation** — Paste any supported product URL and DropHawk auto-parses merchant, title, image, variants, and sizes into a configurable watch in under three seconds.
3. **Instant Drop Alerts** — Critical-priority push notifications with sound, haptics, and a "Go to Checkout" action button that bypasses the app shell and opens the cart URL directly.
4. **Checkout Autofill Profiles** — Encrypted local storage (expo-secure-store) of shipping and contact details, injected into the in-app browser to shave seconds off manual form entry.
5. **Release Calendar** — A scrollable timeline of confirmed and rumoured drops with countdown timers, timezone-aware reminders, and one-tap conversion into an active watch.
6. **Variant & Size Targeting** — Per-watch filters so a user is only alerted for their size, colourway, or price ceiling, eliminating the noise of irrelevant restocks.
7. **Cop Feed** — A community stream where users post confirmed stock sightings, share receipt proof, and upvote reliable sources; verified sightings trigger a secondary alert tier.
8. **Hit Rate Analytics** — Personal stats tracking alerts received, carts opened, average response time, and successful checkouts, with a weekly digest to tune watch settings.

## Key Screens

- **Radar (Home)** — Sectioned list of active watches grouped by status (Live Now / Monitoring / Sold Out), pull-to-refresh, and a floating add-watch button.
- **Watch Detail** — Full stock history chart, poll interval control, variant selector, alert channel toggles, and merchant quick-links.
- **Add Watch Flow** — Multi-step modal: URL paste → parsed preview → variant/size picker → alert settings → confirm.
- **Calendar** — Agenda-style upcoming drops with countdown chips, filter pills by category, and reminder scheduling.
- **Profile & Settings** — Subscription status, checkout profiles, notification permissions diagnostic, hit-rate stats, and data export.

## Core Components

- **`<WatchCard />`** — Animated status card with live-state badge, price delta, last-poll ticker, and swipe actions for pause, edit, and delete.
- **`<CountdownRing />`** — Reanimated SVG progress ring rendering time-to-drop or time-since-last-check with colour transitions at threshold breakpoints.
- **`<CheckoutSheet />`** — Bottom sheet wrapping expo-web-browser with a profile picker, copy-to-clipboard field chips, and a persistent elapsed-time header.
- **`<AlertPermissionGate />`** — Guard component that detects disabled or downgraded notification permissions and renders inline remediation steps before a watch can go live.

## Roadmap

### Week 1

- Scaffold the Expo Router project with TypeScript, NativeWind, and the tab + modal navigation shell.
- Provision Supabase schema (users, watches, drop_events, sightings) with RLS policies and magic-link auth.
- Build the Radar screen against mocked data with `<WatchCard />` and skeleton loading states.

### Week 2-3

- Ship the URL parser Edge Function and the full Add Watch flow with variant/size targeting.
- Wire Expo Notifications end-to-end: token registration, scheduled poller, notification categories, and deep-link routing to Watch Detail.
- Implement Checkout Profiles with expo-secure-store, the `<CheckoutSheet />`, and the Release Calendar screen.

### Week 4+

- Launch the Cop Feed with Supabase Realtime, upvoting, and moderation reporting.
- Integrate RevenueCat paywall, free-tier watch limits, and Hit Rate Analytics dashboard.
- Harden with Sentry, EAS Update channels, and a TestFlight/Play Internal beta cohort.

## Monetisation

DropHawk runs a freemium subscription model. The free tier allows three active watches on a 5-minute poll interval with standard-priority alerts — enough to prove value on a single grail item. **DropHawk Pro** ($6.99/month or $49.99/year via RevenueCat) unlocks unlimited watches, 15-second polling, priority alert queue placement, unlimited checkout profiles, multi-size targeting, and the full analytics dashboard.

A **Pro+ Squad** tier ($14.99/month) adds shared watch lists for reseller groups, webhook/Discord relay for alerts, and early access to newly supported merchants. Secondary revenue comes from affiliate commissions on merchant checkout links where programs exist, and from sponsored placements in the Release Calendar — clearly labelled and never permitted in the alert stream, which stays strictly user-intent driven.