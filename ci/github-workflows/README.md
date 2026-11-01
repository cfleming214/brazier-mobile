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
- `e2e-mobile.yml`: Maestro suite on an Android emulator against an EAS `e2e` build. Needs the
  `EXPO_TOKEN` secret. Runs nightly, on `main` and on demand.
