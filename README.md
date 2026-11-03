# Brazier

Restock alerts, release calendars and cart-ready checkout for limited drops. Pokémon TCG first.

- Product spec: [`PLAN.md`](PLAN.md), [`FEATURES.md`](FEATURES.md)
- Build plan: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)
- Design: [`mockups/home-radar.html`](mockups/home-radar.html)

## Repo layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo (SDK 58) + Expo Router app |
| `packages/shared` | Domain types, Zod schemas, retailer adapter interface, shared helpers |
| `services/worker` | Stock poller, detector and notifier (Phase 2) |
| `supabase` | Migrations, seed data, pgTAP tests, email templates |
| `e2e/fake-retailer` | Test double for retailer endpoints with a control API to flip stock |
| `e2e/fake-push` | Expo-Push-compatible test double that records notifications |
| `e2e/maestro` | Maestro end-to-end flows |

## Getting started

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm install
pnpm db:start                # local Supabase: applies migrations and seed
npx supabase status          # copy the API URL and anon key
cp apps/mobile/.env.example apps/mobile/.env.local   # paste the anon key
cd apps/mobile && npx expo start
```

Sign-in emails go to the local Mailpit inbox at http://127.0.0.1:54324. Each email has a magic link and a 6-digit code.

## Checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test              # unit tests (shared package, test doubles)
pnpm db:test           # pgTAP row level security tests (needs pnpm db:start)
bash e2e/scripts/check-auth-email.sh   # sign-in email round trip against local Supabase
```

### End-to-end

```bash
pnpm e2e:up            # fake retailer on :4010, fake push on :4020
maestro test e2e/maestro/flows -e EMAIL=e2e-$(date +%s)@test.local
pnpm e2e:down
```

The Maestro flows run against an EAS `e2e` build of the app (see `apps/mobile/eas.json`) on a simulator or emulator.

## Setup that needs your accounts

- **Supabase project**: create it, then `npx supabase link --project-ref <ref>` and `npx supabase db push`. In the dashboard, add `brazier://auth-callback` to the redirect URLs and paste `supabase/templates/magic_link.html` into the Magic Link email template so emails include the code.
- **EAS**: `cd apps/mobile && npx eas init` replaces `REPLACE_WITH_EAS_PROJECT_ID` in `app.json`. Add an `EXPO_TOKEN` repository secret for the Mobile E2E workflow.
- **Bundle IDs**: `com.brazier.app` is a placeholder in `app.json`; change it before registering with Apple and Google.
- **CI workflows**: move `ci/github-workflows/*.yml` into `.github/workflows/` (see `ci/github-workflows/README.md`), then mark the CI jobs as required checks on `main` in GitHub settings.
