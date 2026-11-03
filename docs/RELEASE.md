# Release & beta guide (DROP-55)

## Channels

| EAS build profile | Update channel | Audience | `EXPO_PUBLIC_APP_ENV` |
| --- | --- | --- | --- |
| `development` | `development` | Engineers (dev client) | development |
| `e2e` | `e2e` | CI emulators/simulators (Maestro) | e2e |
| `preview` | `preview` | Internal ad-hoc / APK | preview |
| `beta` | `beta` | TestFlight + Play internal testing | beta |
| `production` | `production` | App Store + Play | production |

`runtimeVersion` uses the **fingerprint** policy, so an OTA update only reaches binaries with the same
native code. Any change to native dependencies (e.g. RevenueCat, Sentry) needs a new build.

## Ship a beta

```bash
cd apps/mobile
eas build --profile beta --platform all
eas submit --profile beta --platform ios       # → TestFlight
eas submit --profile beta --platform android   # → Play internal track (draft)
```

JS-only fixes to an existing beta: `eas update --channel beta --message "<what changed>"`.

Promote a tested update to production without rebuilding:
`eas update:republish --source-channel beta --destination-channel production`.

## One-time setup

1. `eas init` to link the project, then `eas update:configure` (adds `updates.url` to app.json).
2. App Store Connect: create the app, put its id in `eas.json → submit.*.ios.ascAppId`.
3. Play Console: create the app, upload the first AAB by hand, save a service account key to
   `apps/mobile/secrets/play-service-account.json` (git-ignored).
4. EAS environment variables (`eas env:create`, see `docs/SETUP_GUIDE.md`): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
   `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`,
   plus `SENTRY_AUTH_TOKEN` for source-map upload.
5. RevenueCat: products `pro_monthly` / `pro_annual` attached to entitlement `pro`; webhook to
   `supabase/functions/revenuecat-webhook` with `Authorization: Bearer $REVENUECAT_WEBHOOK_SECRET`
   (`supabase secrets set REVENUECAT_WEBHOOK_SECRET=...`, `supabase functions deploy revenuecat-webhook --no-verify-jwt`).

## Release checklist

- [ ] CI green (lint, typecheck, unit, pgTAP, worker integration, Maestro E2E)
- [ ] Manual smoke checklist passed on one iOS and one Android device (`docs/SMOKE_CHECKLIST.md`)
- [ ] Sentry release created and source maps uploaded
- [ ] Store listing: privacy labels say checkout profiles stay on device; no payment data collected
- [ ] Beta testers notified with what to test
