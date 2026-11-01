# GitHub Actions workflows

These are the CI workflows for the repo. They live here because the tool that pushed them
couldn't write to `.github/workflows/`. To turn them on:

```bash
mkdir -p .github/workflows
git mv ci/github-workflows/*.yml .github/workflows/
git commit -m "Enable CI workflows" && git push
```

- `ci.yml`: lint, format, typecheck, unit tests, migrations, schema lint, RLS tests, sign-in email
  round trip, test-double containers, secret scan. Runs on every PR and on `main`.
- `e2e-mobile.yml`: Maestro suite on an Android emulator and an iOS simulator against EAS `e2e`
  builds, plus the 50-flip pipeline latency test (p95 ≤ 3 s, published as an artifact). Needs the
  `EXPO_TOKEN` secret. Runs nightly, on `main` and on demand.
- `canary.yml`: nightly live canaries — one polite request per adapter and calendar feed; a broken
  parser flips the adapter to degraded and opens an `adapter-broken` issue. Needs the production
  Supabase and retailer API secrets plus the `CANARY_SKUS` variable.
