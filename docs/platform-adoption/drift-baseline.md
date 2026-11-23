# Platform drift report

Generated 2026-11-23T18:05:44.125Z by `scripts/platform-drift.mjs` (schema 1).

| | Root | Commit |
|---|---|---|
| Base | `EnterpriseAppBase` | `6ea11edbecd6794e3da09680834713f562423cdd` |
| App | `shellkeep` | `95145d0d850a4a53757b65d289158d58e34fc33d` |

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
| `__CLI__` | `appctl` | (unknown) | no |
| `__CLI_UPPER__` | `APPCTL` | (unknown) | no |
| `__CLI_TITLE__` | `Appctl` | (unknown) | no |

## Areas

"Identical" counts identical plus normalised-identical files over every base file in the area (present on both sides, or base-only).

| Area | Root | Base files | Identical | Normalised-identical | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|---|---|
| api | `apps/api/src` | 269 | 0 | 0 | 10 | 259 | 168 | +333 / -349 | 0% |
| api-test | `apps/api/test` | 389 | 11 | 0 | 21 | 357 | 1 | +150 / -1778 | 2.8% |
| web | `apps/web/src` | 277 | 11 | 0 | 37 | 229 | 99 | +2578 / -3760 | 4% |
| cli | `apps/cli/src` (not in app) | 354 | 0 | 0 | 0 | 354 | 0 | +0 / -0 | 0% |
| prisma | `apps/api/prisma` | 68 | 2 | 0 | 2 | 64 | 2 | +172 / -30 | 2.9% |
| infra | `infra` | 34 | 0 | 1 | 6 | 27 | 6 | +73 / -352 | 2.9% |
| stack-agent | `apps/stack-agent/src` (not in app) | 7 | 0 | 0 | 0 | 7 | 0 | +0 / -0 | 0% |
| android | `apps/android` (not in app) | 26 | 0 | 0 | 0 | 26 | 0 | +0 / -0 | 0% |
| packages | `packages` (not in app) | 4011 | 0 | 0 | 0 | 4011 | 0 | +0 / -0 | 0% |
| scripts | `scripts` | 16 | 0 | 0 | 0 | 16 | 1 | +0 / -0 | 0% |
| github | `.github` | 16 | 3 | 0 | 3 | 10 | 0 | +124 / -411 | 18.8% |

## Modules by changed lines

| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|
| web | `__tests__` | 218 | 20 | 150 | 41 | +1484 / -2889 | 4% |
| web | `(root)` | 4 | 3 | 1 | 0 | +23 / -655 | 0% |
| api-test | `settings` | 17 | 2 | 15 | 0 | +49 / -613 | 0% |
| github | `workflows` | 9 | 2 | 7 | 0 | +100 / -392 | 0% |
| api-test | `fixtures` | 5 | 4 | 0 | 0 | +16 / -465 | 20% |
| web | `services` | 4 | 1 | 2 | 1 | +353 / -23 | 0% |
| api | `common` | 43 | 4 | 20 | 19 | +165 / -163 | 0% |
| api-test | `integration` | 6 | 1 | 5 | 0 | +0 / -266 | 0% |
| api | `(root)` | 5 | 3 | 2 | 0 | +136 / -107 | 0% |
| api-test | `storage` | 8 | 1 | 7 | 0 | +30 / -209 | 0% |
| web | `types` | 1 | 1 | 0 | 0 | +162 / -71 | 0% |
| web | `components/navigation` | 5 | 2 | 2 | 1 | +175 / -26 | 0% |
| infra | `otel` | 3 | 1 | 1 | 1 | +16 / -182 | 0% |
| web | `hooks` | 17 | 2 | 6 | 8 | +173 / -20 | 11.1% |
| prisma | `seed` | 3 | 1 | 2 | 0 | +167 / -15 | 0% |
| infra | `compose` | 16 | 4 | 10 | 1 | +45 / -100 | 6.7% |
| web | `theme` | 4 | 3 | 0 | 1 | +76 / -17 | 0% |
| infra | `nginx` | 17 | 1 | 15 | 1 | +12 / -70 | 0% |
| api-test | `auth` | 11 | 3 | 7 | 1 | +29 / -52 | 0% |
| api | `config` | 2 | 1 | 1 | 0 | +29 / -42 | 0% |
| web | `components/common` | 6 | 1 | 0 | 3 | +36 / -34 | 66.7% |
| web | `contexts` | 2 | 1 | 0 | 1 | +56 / -8 | 0% |
| api-test | `rbac` | 4 | 1 | 2 | 0 | +7 / -52 | 25% |
| web | `pages` | 14 | 2 | 2 | 10 | +35 / -12 | 0% |
| api-test | `mocks` | 5 | 2 | 1 | 0 | +4 / -42 | 40% |
| api-test | `helpers` | 13 | 3 | 9 | 0 | +7 / -36 | 7.7% |
| github | `(root)` | 3 | 1 | 1 | 0 | +24 / -19 | 33.3% |
| api | `prisma` | 11 | 2 | 9 | 0 | +3 / -37 | 0% |
| api-test | `errors` | 1 | 1 | 0 | 0 | +2 / -31 | 0% |
| prisma | `(root)` | 3 | 1 | 1 | 0 | +5 / -15 | 33.3% |
| web | `components/user` | 1 | 1 | 0 | 0 | +5 / -5 | 0% |
| api-test | `test-auth` | 1 | 1 | 0 | 0 | +0 / -8 | 0% |
| api-test | `(root)` | 16 | 1 | 10 | 0 | +4 / -1 | 31.3% |
| api-test | `health` | 1 | 1 | 0 | 0 | +2 / -3 | 0% |
| android | `(root)` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| android | `app` | 15 | 0 | 15 | 0 | +0 / -0 | 0% |
| android | `gradle` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| android | `scripts` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `allowlist` | 9 | 0 | 0 | 9 | +0 / -0 | n/a |
| api | `app-registrations` | 21 | 0 | 21 | 0 | +0 / -0 | 0% |
| api | `auth` | 29 | 0 | 0 | 29 | +0 / -0 | n/a |
| api | `device-auth` | 18 | 0 | 0 | 18 | +0 / -0 | n/a |
| api | `doctor` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `examples` | 30 | 0 | 30 | 0 | +0 / -0 | 0% |
| api | `health` | 5 | 0 | 0 | 5 | +0 / -0 | n/a |
| api | `identity-extensions` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api | `jobs` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api | `onboarding` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `openapi` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api | `platform` | 89 | 0 | 89 | 0 | +0 / -0 | 0% |
| api | `platform-extensions` | 64 | 0 | 64 | 0 | +0 / -0 | 0% |
| api | `server-profiles` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| api | `settings` | 23 | 0 | 8 | 15 | +0 / -0 | 0% |
| api | `storage` | 29 | 0 | 0 | 29 | +0 / -0 | n/a |
| api | `terminal` | 17 | 0 | 0 | 17 | +0 / -0 | n/a |
| api | `test-auth` | 7 | 0 | 0 | 7 | +0 / -0 | n/a |
| api | `users` | 12 | 0 | 0 | 12 | +0 / -0 | n/a |
| api-test | `about` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `ai` | 21 | 0 | 21 | 0 | +0 / -0 | 0% |
| api-test | `alerts` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `android-app` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| api-test | `broadcasts` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `conformance` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `credentials` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `db-backup` | 10 | 0 | 10 | 0 | +0 / -0 | 0% |
| api-test | `device-auth` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `doctor` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `email` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `event-bus` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `examples` | 68 | 0 | 68 | 0 | +0 / -0 | 0% |
| api-test | `exports` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `identity` | 13 | 0 | 13 | 0 | +0 / -0 | 0% |
| api-test | `jobs` | 18 | 0 | 18 | 0 | +0 / -0 | 0% |
| api-test | `maintenance` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `nodes` | 15 | 0 | 15 | 0 | +0 / -0 | 0% |
| api-test | `notifications` | 46 | 0 | 46 | 0 | +0 / -0 | 0% |
| api-test | `onboarding` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| api-test | `openapi` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `organizations` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `platform` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| api-test | `prisma` | 14 | 0 | 14 | 0 | +0 / -0 | 0% |
| api-test | `retention` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `sharing` | 13 | 0 | 13 | 0 | +0 / -0 | 0% |
| api-test | `telemetry` | 11 | 0 | 11 | 0 | +0 / -0 | 0% |
| api-test | `tenancy` | 8 | 0 | 8 | 0 | +0 / -0 | 0% |
| api-test | `user-data` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api-test | `webhooks` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| cli | `(root)` | 39 | 0 | 39 | 0 | +0 / -0 | 0% |
| cli | `commands` | 10 | 0 | 10 | 0 | +0 / -0 | 0% |
| cli | `deploy` | 137 | 0 | 137 | 0 | +0 / -0 | 0% |
| cli | `init` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| cli | `node` | 74 | 0 | 74 | 0 | +0 / -0 | 0% |
| cli | `tui` | 91 | 0 | 91 | 0 | +0 / -0 | 0% |
| github | `ISSUE_TEMPLATE` | 4 | 0 | 2 | 0 | +0 / -0 | 50% |
| infra | `(root)` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| infra | `deploy` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| packages | `(root)` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| packages | `platform-ai-providers` | 101 | 0 | 101 | 0 | +0 / -0 | 0% |
| packages | `platform-api` | 1966 | 0 | 1966 | 0 | +0 / -0 | 0% |
| packages | `platform-cli` | 456 | 0 | 456 | 0 | +0 / -0 | 0% |
| packages | `platform-contract` | 168 | 0 | 168 | 0 | +0 / -0 | 0% |
| packages | `platform-db` | 161 | 0 | 161 | 0 | +0 / -0 | 0% |
| packages | `platform-infra` | 114 | 0 | 114 | 0 | +0 / -0 | 0% |
| packages | `platform-web` | 1036 | 0 | 1036 | 0 | +0 / -0 | 0% |
| packages | `shared` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| prisma | `catalog` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| prisma | `fragments` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| prisma | `migrations` | 45 | 0 | 43 | 1 | +0 / -0 | 2.3% |
| prisma | `schema.prisma` | 15 | 0 | 14 | 1 | +0 / -0 | 0% |
| scripts | `(root)` | 16 | 0 | 16 | 0 | +0 / -0 | 0% |
| scripts | `platform-adoption` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| stack-agent | `(root)` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| web | `components` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| web | `components/admin` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| web | `components/auth` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| web | `components/device-activation` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| web | `components/home` | 5 | 0 | 1 | 4 | +0 / -0 | 0% |
| web | `components/server-profiles` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| web | `components/settings` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| web | `components/terminal` | 7 | 0 | 0 | 7 | +0 / -0 | n/a |
| web | `config` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| web | `identity` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| web | `jobs` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `lib` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| web | `nodes` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `pages/Admin` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| web | `platform` | 12 | 0 | 12 | 0 | +0 / -0 | 0% |
| web | `platform-extensions` | 38 | 0 | 38 | 0 | +0 / -0 | 0% |
| web | `utils` | 3 | 0 | 1 | 1 | +0 / -0 | 50% |

## Most changed files (top 50)

| File | Lines +/- |
|---|---|
| `apps/web/src/__tests__/components/admin/UserList.test.tsx` | +482 / -325 |
| `apps/web/src/App.tsx` | +23 / -644 |
| `apps/web/src/__tests__/App.test.tsx` | +4 / -656 |
| `apps/web/src/__tests__/components/admin/AllowlistTable.test.tsx` | +434 / -208 |
| `apps/web/src/__tests__/components/common/Layout.test.tsx` | +368 / -133 |
| `apps/api/test/settings/system-settings.integration.spec.ts` | +29 / -399 |
| `apps/api/test/fixtures/test-data.factory.ts` | +4 / -418 |
| `.github/workflows/ci.yml` | +30 / -388 |
| `apps/web/src/__tests__/mocks/handlers.ts` | +7 / -399 |
| `apps/web/src/services/api.ts` | +353 / -23 |
| `apps/api/test/integration/device-auth.integration.spec.ts` | +0 / -266 |
| `apps/api/test/storage/storage.integration.spec.ts` | +30 / -209 |
| `apps/api/test/settings/user-settings.integration.spec.ts` | +20 / -214 |
| `apps/web/src/types/index.ts` | +162 / -71 |
| `infra/otel/otel-collector-config.yaml` | +16 / -182 |
| `apps/web/src/__tests__/pages/HomePage.test.tsx` | +51 / -143 |
| `apps/api/prisma/seed.ts` | +167 / -15 |
| `apps/api/src/common/schemas/settings.schema.ts` | +39 / -140 |
| `apps/web/src/__tests__/components/navigation/AppBar.test.tsx` | +7 / -168 |
| `apps/web/src/__tests__/components/navigation/UserMenu.test.tsx` | +13 / -139 |
| `apps/web/src/__tests__/services/api.test.ts` | +1 / -140 |
| `apps/web/src/__tests__/utils/test-utils.tsx` | +7 / -133 |
| `apps/web/src/__tests__/contexts/AuthContext.test.tsx` | +4 / -127 |
| `apps/web/src/__tests__/setup.ts` | +7 / -118 |
| `apps/web/src/components/navigation/UserMenu.tsx` | +107 / -13 |
| `apps/api/src/app.module.ts` | +45 / -59 |
| `apps/api/src/common/types/settings.types.ts` | +95 / -4 |
| `apps/web/src/hooks/useUserSettings.ts` | +84 / -13 |
| `apps/web/src/hooks/useSystemSettings.ts` | +89 / -7 |
| `apps/web/src/__tests__/hooks/useUsers.test.ts` | +46 / -48 |
| `infra/nginx/nginx.conf` | +12 / -70 |
| `apps/web/src/components/navigation/AppBar.tsx` | +68 / -13 |
| `.github/workflows/deploy.yml` | +70 / -4 |
| `apps/api/src/config/configuration.ts` | +29 / -42 |
| `apps/api/src/instrumentation.ts` | +64 / -7 |
| `apps/web/src/components/common/Layout.tsx` | +36 / -34 |
| `apps/api/src/main.ts` | +27 / -41 |
| `apps/web/src/contexts/ThemeContext.tsx` | +56 / -8 |
| `apps/web/src/__tests__/hooks/useUserSettings.test.ts` | +7 / -54 |
| `infra/compose/.env.example` | +16 / -45 |
| `apps/api/test/rbac/rbac.integration.spec.ts` | +7 / -52 |
| `apps/web/src/__tests__/hooks/useSystemSettings.test.ts` | +32 / -26 |
| `infra/compose/base.compose.yml` | +21 / -24 |
| `apps/api/src/common/constants/roles.constants.ts` | +28 / -16 |
| `apps/web/src/theme/index.ts` | +34 / -10 |
| `.github/pull_request_template.md` | +24 / -19 |
| `apps/web/src/pages/HomePage.tsx` | +33 / -10 |
| `apps/api/test/mocks/prisma.mock.ts` | +3 / -37 |
| `apps/api/test/helpers/test-app.helper.ts` | +6 / -33 |
| `apps/api/test/auth/oauth.integration.spec.ts` | +25 / -10 |

## Migrations

Matched by normalised SQL first, then by the name after the 14-digit timestamp.

| Base | App | Shared | Renamed | Same name, different SQL | Base-only | App-only |
|---|---|---|---|---|---|---|
| 43 | 2 | 1 | 0 | 0 | 42 | 1 |

Base-only:

- `20260329151231_add_personal_access_tokens`
- `20260830211041_add_credentials`
- `20260831010356_add_notification_deliveries`
- `20260831014110_drop_stale_uuid_defaults`
- `20260831030721_add_notifications`
- `20260905182958_add_push_subscriptions`
- `20260906120000_add_jobs`
- `20260906190000_add_worker_nodes`
- `20260907120000_add_database_backup_runs`
- `20260907130000_add_notification_broadcasts`
- `20260907140000_add_backup_run_job_link`
- `20260907150000_add_job_node_secrets`
- `20260907160000_add_backup_run_pg_dump_version`
- `20260908120000_add_job_claim_token`
- `20260926034919_add_ai_platform`
- `20260927000000_revoke_viewer_ai_use`
- `20260927120000_add_user_credentials`
- `20260927130000_add_device_session_credential_link`
- `20260928100000_add_worker_node_vitals`
- `20260930120000_add_job_trace_context`
- `20261006120000_add_retention_created_at_indexes`
- `20261007141244_add_organizations`
- `20261007161956_split_system_org_roles`
- `20261007202337_org_scoped_rls`
- `20261007222406_add_groups`
- `20261008000859_add_grants`
- `20261008012052_add_org_settings`
- `20261008041856_add_org_credentials`
- `20261008052119_add_jobs_org_id`
- `20261008052120_add_jobs_org_id_status_index`
- `20261008080749_add_broadcast_target_org`
- `20261008120000_add_android_app`
- `20261013115831_open_job_reason`
- `20261013154013_ai_usage_feature`
- `20261013195500_add_app_metadata`
- `20261013214001_open_sharing_vocabularies`
- `20261101003924_add_worker_node_events`
- `20261101044654_add_webhooks`
- `20261101050011_add_alerts`
- `20261108011158_notifications_state_counted`
- `20261108112214_add_storage_migrations`
- `20261117220229_add_oauth_server`

App-only:

- `20260322203853_add_server_profile_color`

## Prisma models

Base models present in the app: 14 of 53. Total models in the app: 16.

- Missing from the app: `AiModel`, `AiRun`, `AiUsageEvent`, `AlertIncident`, `AlertRule`, `AndroidAppRelease`, `Credential`, `DatabaseBackupRun`, `Grant`, `Group`, `GroupInvite`, `GroupMember`, `Invite`, `Job`, `JobNodeSecret`, `JobStatsRollup`, `Membership`, `NodeCredential`, `Notification`, `NotificationBroadcast`, `NotificationDelivery`, `OAuthAuthorizationCode`, `OAuthAuthorizationRequest`, `OAuthClient`, `OAuthGrant`, `OAuthToken`, `OrgCredential`, `OrgSettings`, `Organization`, `PersonalAccessToken`, `PushSubscription`, `StorageMigrationItem`, `StorageMigrationRun`, `UserAiKey`, `UserCredential`, `WebhookDelivery`, `WebhookEndpoint`, `WorkerNode`, `WorkerNodeEvent`
- App-only: `ServerProfile`, `TerminalSession`

Shared models whose fields differ:

| Model | Fields added in the app | Fields removed in the app |
|---|---|---|
| `AuditEvent` | none | `org`, `orgId` |
| `DeviceCode` | none | `collectedAt`, `credentialExpiresAt`, `org`, `orgId`, `pat`, `patId`, `refreshTokens`, `revokedAt` |
| `Permission` | none | `scope` |
| `RefreshToken` | none | `deviceCode`, `deviceCodeId`, `org`, `orgId` |
| `Role` | none | `invites`, `memberships`, `scope` |
| `StorageObject` | none | `migrationItems`, `org`, `orgId` |
| `StorageObjectChunk` | none | `org`, `orgId` |
| `User` | `serverProfiles`, `terminalSessions` | `aiKeys`, `aiModelsUpdated`, `aiRuns`, `aiUsageEvents`, `androidAppReleases`, `broadcastsCreated`, `credentialUpdates`, `databaseBackupRuns`, `databaseRestores`, `grantsGiven`, `grantsReceived`, `grantsRevoked`, `groupInvitesClaimed`, `groupInvitesSent`, `groupMembersAdded`, `groupMemberships`, `groupsCreated`, `invitesAccepted`, `invitesSent`, `memberships`, `metadata`, `nodeCredentials`, `notificationDeliveries`, `notifications`, `oauthClientsCreated`, `oauthGrants`, `orgCredentialUpdates`, `orgSettingsUpdates`, `organizationsCreated`, `personalAccessTokens`, `pushSubscriptions`, `storageMigrationRunsCancelled`, `storageMigrationRunsStarted`, `userCredentials`, `webhookEndpoints`, `workerNodes` |

## Zero-drift modules

Modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

- api-test: `users` (1 files)
