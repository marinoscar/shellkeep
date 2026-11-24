# Platform drift report

Generated 2026-11-24T07:59:15.517Z by `scripts/platform-drift.mjs` (schema 1).

| | Root | Commit |
|---|---|---|
| Base | `EnterpriseAppBase` | `ad57217a3c5fb9c1d87e600e1ea6cca05d49db6a` |
| App | `shellkeep` | `a0acaae2645769a899feed6c22431ffb4b64d5f7` |

## Identity replacements

Every value in this table, base or app, is replaced by its token on both sides before comparing, so these differences are ignored. A row marked "no" is unknown on one side and was not applied (pass the `--base-*`/`--app-*` flags).

| Placeholder | Base | App | Applied as |
|---|---|---|---|
| `__PRODUCT__` | `My App` | `ShellKeep` | `__PRODUCT__` |
| `__SLUG__` | `my-app` | `shellkeep` | `__SLUG__` |
| `__SLUG_SNAKE__` | `my_app` | `shellkeep` | `__SLUG__` |
| `__SERVICE__` | `my-app-api` | `shellkeep-api` | `__SERVICE__` |
| `__REPO_SLUG__` | `marinoscar/EnterpriseAppBase` | `marinoscar/shellkeep` | `__REPO_SLUG__` |
| `__REPO_NAME__` | `EnterpriseAppBase` | `shellkeep` | `__SLUG__` |
| `__CLI__` | `appctl` | `shellkeep` | `__SLUG__` |
| `__CLI_UPPER__` | `APPCTL` | `SHELLKEEP` | `__CLI_UPPER__` |
| `__CLI_TITLE__` | `Appctl` | `Shellkeep` | `__CLI_TITLE__` |

## Areas

"Identical" counts identical plus normalised-identical files over every base file in the area (present on both sides, or base-only).

| Area | Root | Base files | Identical | Normalised-identical | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|---|---|
| api | `apps/api/src` | 269 | 2 | 12 | 76 | 179 | 264 | +1100 / -648 | 5.2% |
| api-test | `apps/api/test` | 389 | 3 | 1 | 40 | 345 | 61 | +1536 / -2508 | 1% |
| web | `apps/web/src` | 277 | 7 | 3 | 36 | 231 | 229 | +1539 / -3857 | 3.6% |
| cli | `apps/cli/src` | 354 | 0 | 0 | 1 | 353 | 55 | +25 / -127 | 0% |
| prisma | `apps/api/prisma` | 68 | 15 | 0 | 8 | 45 | 64 | +347 / -133 | 22.1% |
| infra | `infra` | 34 | 9 | 20 | 4 | 1 | 4 | +16 / -8 | 85.3% |
| stack-agent | `apps/stack-agent/src` (not in app) | 7 | 0 | 0 | 0 | 7 | 0 | +0 / -0 | 0% |
| android | `apps/android` | 26 | 18 | 0 | 4 | 4 | 6 | +4 / -4 | 69.2% |
| packages | `packages` | 4013 | 0 | 0 | 4 | 4009 | 0 | +12 / -20 | 0% |
| scripts | `scripts` | 16 | 0 | 0 | 1 | 15 | 4 | +2 / -12 | 0% |
| github | `.github` | 16 | 1 | 0 | 7 | 8 | 0 | +299 / -381 | 6.3% |

## Modules by changed lines

| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|
| web | `__tests__` | 252 | 17 | 155 | 75 | +747 / -3112 | 2.8% |
| api-test | `fixtures` | 5 | 4 | 0 | 0 | +92 / -734 | 20% |
| api-test | `user-data` | 6 | 5 | 1 | 0 | +416 / -381 | 0% |
| api | `platform` | 101 | 50 | 26 | 12 | +415 / -373 | 14.6% |
| api-test | `settings` | 20 | 2 | 15 | 3 | +135 / -594 | 0% |
| web | `(root)` | 4 | 4 | 0 | 0 | +307 / -398 | 0% |
| api | `app-registrations` | 28 | 14 | 7 | 7 | +563 / -94 | 0% |
| github | `workflows` | 9 | 2 | 7 | 0 | +258 / -364 | 0% |
| api-test | `exports` | 4 | 3 | 0 | 1 | +299 / -234 | 0% |
| web | `config` | 6 | 5 | 0 | 1 | +190 / -111 | 0% |
| api-test | `(root)` | 17 | 6 | 8 | 1 | +146 / -139 | 12.5% |
| api-test | `onboarding` | 5 | 2 | 2 | 1 | +136 / -108 | 0% |
| prisma | `catalog` | 3 | 2 | 1 | 0 | +166 / -73 | 0% |
| prisma | `(root)` | 3 | 2 | 0 | 0 | +130 / -47 | 33.3% |
| cli | `(root)` | 51 | 1 | 38 | 12 | +25 / -127 | 0% |
| api-test | `sharing` | 16 | 2 | 11 | 3 | +61 / -89 | 0% |
| web | `pages` | 8 | 3 | 1 | 4 | +110 / -28 | 0% |
| api | `(root)` | 6 | 3 | 2 | 1 | +71 / -63 | 0% |
| api-test | `tenancy` | 8 | 1 | 7 | 0 | +101 / -28 | 0% |
| api-test | `helpers` | 17 | 6 | 7 | 4 | +48 / -68 | 0% |
| web | `services` | 10 | 2 | 1 | 7 | +64 / -48 | 0% |
| web | `types` | 3 | 1 | 0 | 2 | +1 / -87 | 0% |
| api-test | `jobs` | 18 | 1 | 17 | 0 | +57 / -29 | 0% |
| web | `platform` | 15 | 1 | 9 | 3 | +30 / -51 | 16.7% |
| web | `components/common` | 4 | 2 | 0 | 1 | +64 / -14 | 33.3% |
| api | `prisma` | 11 | 3 | 8 | 0 | +14 / -60 | 0% |
| api-test | `mocks` | 5 | 2 | 3 | 0 | +6 / -39 | 0% |
| prisma | `seed` | 3 | 2 | 1 | 0 | +31 / -13 | 0% |
| api | `config` | 2 | 1 | 1 | 0 | +5 / -39 | 0% |
| api | `common` | 27 | 3 | 21 | 3 | +30 / -13 | 0% |
| github | `(root)` | 3 | 1 | 1 | 0 | +23 / -12 | 33.3% |
| web | `identity` | 5 | 1 | 2 | 2 | +26 / -8 | 0% |
| api-test | `errors` | 1 | 1 | 0 | 0 | +2 / -31 | 0% |
| packages | `shared` | 5 | 4 | 1 | 0 | +12 / -20 | 0% |
| api-test | `db-backup` | 10 | 1 | 9 | 0 | +7 / -25 | 0% |
| api-test | `conformance` | 2 | 2 | 0 | 0 | +20 / -5 | 0% |
| github | `ISSUE_TEMPLATE` | 4 | 4 | 0 | 0 | +18 / -5 | 0% |
| prisma | `schema.prisma` | 17 | 2 | 0 | 3 | +20 / -0 | 85.7% |
| infra | `(root)` | 1 | 1 | 0 | 0 | +7 / -7 | 0% |
| scripts | `(root)` | 17 | 1 | 15 | 1 | +2 / -12 | 0% |
| infra | `compose` | 15 | 3 | 0 | 0 | +9 / -1 | 80% |
| api-test | `ai` | 21 | 1 | 20 | 0 | +8 / -1 | 0% |
| android | `app` | 21 | 3 | 4 | 6 | +3 / -3 | 53.3% |
| api | `openapi` | 5 | 1 | 3 | 0 | +2 / -3 | 20% |
| api-test | `health` | 1 | 1 | 0 | 0 | +2 / -3 | 0% |
| api | `onboarding` | 3 | 1 | 0 | 2 | +0 / -3 | 0% |
| android | `(root)` | 7 | 1 | 0 | 0 | +1 / -1 | 85.7% |
| api | `command-safety` | 7 | 0 | 0 | 7 | +0 / -0 | n/a |
| api | `dashboard` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| api | `doctor` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `email-templates` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| api | `examples` | 30 | 0 | 30 | 0 | +0 / -0 | 0% |
| api | `identity-extensions` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api | `jobs` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api | `notifications-registry` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api | `platform-extensions` | 64 | 0 | 64 | 0 | +0 / -0 | 0% |
| api | `runbooks` | 105 | 0 | 0 | 105 | +0 / -0 | n/a |
| api | `server-profiles` | 21 | 0 | 0 | 21 | +0 / -0 | n/a |
| api | `settings` | 8 | 0 | 8 | 0 | +0 / -0 | 0% |
| api | `ssh` | 18 | 0 | 0 | 18 | +0 / -0 | n/a |
| api | `terminal` | 48 | 0 | 0 | 48 | +0 / -0 | n/a |
| api | `terminal-ai` | 25 | 0 | 0 | 25 | +0 / -0 | n/a |
| api-test | `about` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `alerts` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `android-app` | 5 | 0 | 4 | 1 | +0 / -0 | 0% |
| api-test | `architecture` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api-test | `auth` | 10 | 0 | 10 | 0 | +0 / -0 | 0% |
| api-test | `broadcasts` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `credentials` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `dashboard` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| api-test | `device-auth` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `doctor` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `email` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `event-bus` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `examples` | 68 | 0 | 68 | 0 | +0 / -0 | 0% |
| api-test | `host` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api-test | `identity` | 15 | 0 | 13 | 2 | +0 / -0 | 0% |
| api-test | `integration` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api-test | `maintenance` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `nodes` | 15 | 0 | 15 | 0 | +0 / -0 | 0% |
| api-test | `notifications` | 47 | 0 | 46 | 1 | +0 / -0 | 0% |
| api-test | `openapi` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `organizations` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `platform` | 8 | 0 | 7 | 1 | +0 / -0 | 0% |
| api-test | `prisma` | 16 | 0 | 13 | 2 | +0 / -0 | 7.1% |
| api-test | `rbac` | 5 | 0 | 4 | 1 | +0 / -0 | 0% |
| api-test | `retention` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `runbooks` | 11 | 0 | 0 | 11 | +0 / -0 | n/a |
| api-test | `server-profiles` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api-test | `ssh` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api-test | `storage` | 9 | 0 | 8 | 1 | +0 / -0 | 0% |
| api-test | `telemetry` | 11 | 0 | 11 | 0 | +0 / -0 | 0% |
| api-test | `terminal` | 11 | 0 | 0 | 11 | +0 / -0 | n/a |
| api-test | `terminal-ai` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| api-test | `test-auth` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `users` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `validation` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api-test | `webhooks` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| cli | `__snapshots__` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| cli | `__support__` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| cli | `commands` | 33 | 0 | 10 | 23 | +0 / -0 | 0% |
| cli | `deploy` | 137 | 0 | 137 | 0 | +0 / -0 | 0% |
| cli | `extensions` | 9 | 0 | 0 | 9 | +0 / -0 | n/a |
| cli | `init` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| cli | `node` | 74 | 0 | 74 | 0 | +0 / -0 | 0% |
| cli | `terminal` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| cli | `tui` | 98 | 0 | 91 | 7 | +0 / -0 | 0% |
| infra | `nginx` | 20 | 0 | 1 | 4 | +0 / -0 | 93.8% |
| packages | `(root)` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| packages | `platform-ai-providers` | 101 | 0 | 101 | 0 | +0 / -0 | 0% |
| packages | `platform-api` | 1968 | 0 | 1968 | 0 | +0 / -0 | 0% |
| packages | `platform-cli` | 456 | 0 | 456 | 0 | +0 / -0 | 0% |
| packages | `platform-contract` | 168 | 0 | 168 | 0 | +0 / -0 | 0% |
| packages | `platform-db` | 161 | 0 | 161 | 0 | +0 / -0 | 0% |
| packages | `platform-infra` | 114 | 0 | 114 | 0 | +0 / -0 | 0% |
| packages | `platform-web` | 1036 | 0 | 1036 | 0 | +0 / -0 | 0% |
| prisma | `fragments` | 4 | 0 | 1 | 3 | +0 / -0 | 0% |
| prisma | `migrations` | 100 | 0 | 42 | 56 | +0 / -0 | 4.5% |
| prisma | `settings-migrations` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| prisma | `sql` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| scripts | `__tests__` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| scripts | `platform-adoption` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| stack-agent | `(root)` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| web | `components/home` | 6 | 0 | 1 | 5 | +0 / -0 | 0% |
| web | `components/navigation` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| web | `components/onboarding` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| web | `components/server-profiles` | 12 | 0 | 0 | 12 | +0 / -0 | n/a |
| web | `components/terminal` | 39 | 0 | 0 | 39 | +0 / -0 | n/a |
| web | `components/user` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `contexts` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `features` | 41 | 0 | 0 | 41 | +0 / -0 | n/a |
| web | `hooks` | 19 | 0 | 8 | 10 | +0 / -0 | 11.1% |
| web | `jobs` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `lib` | 16 | 0 | 0 | 16 | +0 / -0 | n/a |
| web | `nodes` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `pages/Admin` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| web | `pages/runbooks` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| web | `platform-extensions` | 38 | 0 | 38 | 0 | +0 / -0 | 0% |
| web | `theme` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| web | `utils` | 3 | 0 | 1 | 1 | +0 / -0 | 50% |

## Most changed files (top 50)

| File | Lines +/- |
|---|---|
| `apps/web/src/App.tsx` | +304 / -385 |
| `apps/web/src/__tests__/App.test.tsx` | +18 / -650 |
| `.github/workflows/ci.yml` | +188 / -360 |
| `apps/api/test/fixtures/test-data.factory.ts` | +66 / -462 |
| `apps/web/src/__tests__/pwa/service-worker.test.ts` | +25 / -498 |
| `apps/api/test/settings/system-settings.integration.spec.ts` | +121 / -383 |
| `apps/web/src/__tests__/pages/HomePage.test.tsx` | +87 / -347 |
| `apps/web/src/__tests__/mocks/handlers.ts` | +32 / -398 |
| `apps/api/test/exports/exports.db.spec.ts` | +223 / -167 |
| `apps/web/src/__tests__/config/destinations.test.ts` | +114 / -253 |
| `apps/web/src/__tests__/components/common/Layout.test.tsx` | +165 / -161 |
| `apps/api/test/fixtures/mock-setup.helper.ts` | +14 / -252 |
| `apps/api/test/user-data/user-data-db.helper.ts` | +173 / -86 |
| `apps/api/test/onboarding/onboarding.db.spec.ts` | +128 / -102 |
| `apps/api/test/settings/user-settings.integration.spec.ts` | +14 / -211 |
| `apps/web/src/__tests__/platform/platformHost.test.tsx` | +14 / -207 |
| `apps/api/test/conformance.spec.ts` | +102 / -105 |
| `apps/api/test/user-data/user-data-purge.db.spec.ts` | +101 / -106 |
| `apps/web/src/__tests__/services/api.test.ts` | +65 / -140 |
| `apps/api/test/user-data/user-data.integration.spec.ts` | +76 / -101 |
| `apps/api/prisma/platform.lock` | +128 / -44 |
| `apps/api/prisma/catalog/system-settings-defaults.json` | +91 / -69 |
| `apps/web/src/config/adminSections.tsx` | +84 / -73 |
| `apps/cli/src/conformance.test.ts` | +25 / -127 |
| `apps/web/src/__tests__/utils/test-utils.tsx` | +17 / -134 |
| `apps/api/test/sharing/group-ownership.db.spec.ts` | +55 / -84 |
| `apps/api/test/user-data/factory-reset.db.spec.ts` | +57 / -82 |
| `apps/api/test/exports/exports.integration.spec.ts` | +70 / -62 |
| `apps/api/test/tenancy/system-injection-boundary.spec.ts` | +101 / -28 |
| `apps/web/src/__tests__/setup.ts` | +7 / -118 |
| `apps/api/src/app-registrations/user-data.ts` | +116 / -5 |
| `apps/web/src/__tests__/services/storage.test.ts` | +69 / -48 |
| `apps/api/src/platform/telemetry/telemetry-settings-store.adapter.ts` | +66 / -50 |
| `apps/web/src/__tests__/config/userSettingsSections.test.ts` | +53 / -62 |
| `apps/web/src/pages/HomePage.tsx` | +96 / -16 |
| `apps/web/src/__tests__/mocks/data.ts` | +22 / -74 |
| `apps/api/src/app.module.ts` | +46 / -46 |
| `apps/api/src/app-registrations/permissions.ts` | +75 / -13 |
| `apps/web/src/types/index.ts` | +1 / -87 |
| `apps/api/test/jobs/job-type-snapshot.spec.ts` | +57 / -29 |
| `apps/web/src/platform/platformHost.tsx` | +30 / -51 |
| `apps/api/prisma/catalog/permissions.json` | +75 / -4 |
| `apps/api/src/app-registrations/model-ownership.ts` | +76 / -2 |
| `apps/web/src/config/destinations.ts` | +55 / -21 |
| `.github/workflows/deploy.yml` | +70 / -4 |
| `apps/web/src/components/common/Layout.tsx` | +61 / -13 |
| `apps/web/src/services/api.ts` | +46 / -21 |
| `apps/api/src/app-registrations/notifications.ts` | +54 / -11 |
| `apps/api/src/app-registrations/user-owned-models.ts` | +61 / -2 |
| `apps/api/src/platform/telemetry/telemetry-jobs.adapter.ts` | +41 / -18 |

## Migrations

Matched by normalised SQL first, then by the name after the 14-digit timestamp.

| Base | App | Shared | Renamed | Same name, different SQL | Base-only | App-only |
|---|---|---|---|---|---|---|
| 43 | 57 | 1 | 42 | 0 | 0 | 14 |

Renamed (same SQL, different id):

- `20260329151231_add_personal_access_tokens` is `20261123192527_add_personal_access_tokens` in the app
- `20260830211041_add_credentials` is `20261123192528_add_credentials` in the app
- `20260831010356_add_notification_deliveries` is `20261123192529_add_notification_deliveries` in the app
- `20260831014110_drop_stale_uuid_defaults` is `20261123192530_drop_stale_uuid_defaults` in the app
- `20260831030721_add_notifications` is `20261123192531_add_notifications` in the app
- `20260905182958_add_push_subscriptions` is `20261123192532_add_push_subscriptions` in the app
- `20260906120000_add_jobs` is `20261123192533_add_jobs` in the app
- `20260906190000_add_worker_nodes` is `20261123192534_add_worker_nodes` in the app
- `20260907120000_add_database_backup_runs` is `20261123192535_add_database_backup_runs` in the app
- `20260907130000_add_notification_broadcasts` is `20261123192536_add_notification_broadcasts` in the app
- `20260907140000_add_backup_run_job_link` is `20261123192537_add_backup_run_job_link` in the app
- `20260907150000_add_job_node_secrets` is `20261123192538_add_job_node_secrets` in the app
- `20260907160000_add_backup_run_pg_dump_version` is `20261123192539_add_backup_run_pg_dump_version` in the app
- `20260908120000_add_job_claim_token` is `20261123192540_add_job_claim_token` in the app
- `20260926034919_add_ai_platform` is `20261123192541_add_ai_platform` in the app
- `20260927000000_revoke_viewer_ai_use` is `20261123192542_revoke_viewer_ai_use` in the app
- `20260927120000_add_user_credentials` is `20261123192543_add_user_credentials` in the app
- `20260927130000_add_device_session_credential_link` is `20261123192544_add_device_session_credential_link` in the app
- `20260928100000_add_worker_node_vitals` is `20261123192545_add_worker_node_vitals` in the app
- `20260930120000_add_job_trace_context` is `20261123192546_add_job_trace_context` in the app
- `20261006120000_add_retention_created_at_indexes` is `20261123192547_add_retention_created_at_indexes` in the app
- `20261007141244_add_organizations` is `20261123192548_add_organizations` in the app
- `20261007161956_split_system_org_roles` is `20261123192549_split_system_org_roles` in the app
- `20261007202337_org_scoped_rls` is `20261123192550_org_scoped_rls` in the app
- `20261007222406_add_groups` is `20261123192551_add_groups` in the app
- `20261008000859_add_grants` is `20261123192552_add_grants` in the app
- `20261008012052_add_org_settings` is `20261123192553_add_org_settings` in the app
- `20261008041856_add_org_credentials` is `20261123192554_add_org_credentials` in the app
- `20261008052119_add_jobs_org_id` is `20261123192555_add_jobs_org_id` in the app
- `20261008052120_add_jobs_org_id_status_index` is `20261123192556_add_jobs_org_id_status_index` in the app
- `20261008080749_add_broadcast_target_org` is `20261123192557_add_broadcast_target_org` in the app
- `20261008120000_add_android_app` is `20261123192558_add_android_app` in the app
- `20261013115831_open_job_reason` is `20261123192559_open_job_reason` in the app
- `20261013154013_ai_usage_feature` is `20261123192600_ai_usage_feature` in the app
- `20261013195500_add_app_metadata` is `20261123192601_add_app_metadata` in the app
- `20261013214001_open_sharing_vocabularies` is `20261123192602_open_sharing_vocabularies` in the app
- `20261101003924_add_worker_node_events` is `20261123192603_add_worker_node_events` in the app
- `20261101044654_add_webhooks` is `20261123192604_add_webhooks` in the app
- `20261101050011_add_alerts` is `20261123192605_add_alerts` in the app
- `20261108011158_notifications_state_counted` is `20261123192606_notifications_state_counted` in the app
- `20261108112214_add_storage_migrations` is `20261123192607_add_storage_migrations` in the app
- `20261117220229_add_oauth_server` is `20261123192608_add_oauth_server` in the app

App-only:

- `20260124223147_add_terminal_domain`
- `20260322203853_add_server_profile_color`
- `20261123192649_shellkeep_domain_org_id`
- `20261123200125_shellkeep_permissions_org_scope`
- `20261123234212_add_host_key_trust_and_facts`
- `20261124005023_add_runbooks`
- `20261124023435_add_ai_output_sharing`
- `20261124030000_add_sharing_owner_group`
- `20261124031910_add_runbook_runs`
- `20261124042504_add_terminal_session_summaries`
- `20261124050157_add_runbook_safety`
- `20261124052426_add_server_profile_last_test`
- `20261124054855_add_runbook_ai`
- `20261124055015_add_runbook_artifacts`

## Prisma models

Base models present in the app: 53 of 53. Total models in the app: 65.

- Missing from the app: none
- App-only: `Runbook`, `RunbookApproval`, `RunbookArtifact`, `RunbookCommandExecution`, `RunbookRun`, `RunbookRunLogChunk`, `RunbookRunStep`, `RunbookRunTarget`, `RunbookVersion`, `ServerProfile`, `TerminalSession`, `TerminalSessionSummary`

Shared models whose fields differ:

| Model | Fields added in the app | Fields removed in the app |
|---|---|---|
| `Group` | `ownedRunbooks`, `ownedServerProfiles` | none |
| `Organization` | `runbookApprovals`, `runbookArtifacts`, `runbookCommandExecutions`, `runbookRunLogChunks`, `runbookRunSteps`, `runbookRunTargets`, `runbookRuns`, `runbookVersions`, `runbooks`, `serverProfiles`, `terminalSessions` | none |
| `User` | `decidedRunbookApprovals`, `initiatedRunbookRuns`, `ownedRunbooks`, `runbookVersions`, `serverProfiles`, `terminalSessionSummaries`, `terminalSessions` | none |

## Zero-drift modules

Modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

- infra: `otel` (2 files)
- android: `gradle` (3 files)
- android: `scripts` (1 files)
