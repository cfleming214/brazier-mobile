# Maestro E2E suite

Flows run in order against an EAS `e2e` build with local Supabase, the fake retailer and fake push
(`pnpm e2e:up`). The worker runs with `FAKE_RETAILER_URL`, so every retailer read hits the fake.

```bash
maestro test e2e/maestro/flows \
  -e EMAIL=e2e-$(date +%s)@test.local \
  -e SERVICE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2- | tr -d '"')
```

| Flow | Ticket | Scenario (BUILD_PLAN §10.3) |
| --- | --- | --- |
| 00-smoke-sign-in | DROP-15 | Launch, sign in with emailed code, sign out |
| 01-onboarding-catalog-watch | DROP-59 | 1 onboarding + permission gate, 2 watch via catalog |
| 02-watch-from-url | DROP-59 | 3 Best Buy + Target URLs resolve to one product |
| 03-restock-alert-checkout | DROP-60 | 4 restock → push → Live Now → Checkout Sheet, 11 cold-start deep link |
| 04-calendar-reminder | DROP-61 | 7 reminder + convert to watch |
| 05-offline-radar | DROP-61 | 9 offline Radar from cache, reconnect reconciles (Android only; iOS covered by the manual checklist) |
| 06-free-limit-paywall | DROP-61 | 10 4th watch → paywall |
| 07-account-isolation | DROP-61 | 12 user B can't see user A's watches |
| 08-protection-notifications | DROP-90 | Queue on/off and purchase-limit notifications, QUEUE on Radar |

Scenarios that need a controllable clock or assert database rows are covered below the UI, where
they're deterministic:

| Scenario | Where |
| --- | --- |
| 5 filter suppression (price, marketplace, radius) | `services/worker/src/__tests__/pipeline.test.ts`, `rules.test.ts` |
| 6 ghost restock / flapping | `detector.test.ts`, `pipeline.test.ts` |
| 8 rumored + official merge | `calendar-db.test.ts` |
| T-10 burst tier | `rules.test.ts` (drop windows burst) |
| Drop updates: date moved, confirmed, digest, category off, quiet hours | `calendar-db.test.ts`, `rules.test.ts` |
| Restock → push p95 ≤ 3 s over 50 flips | `e2e/scripts/latency.ts` (DROP-62) |

Real push delivery to devices (APNs/FCM) and sandbox purchases are in the manual
`docs/SMOKE_CHECKLIST.md`, since emulators can't receive production pushes.
