# Platform drift report

Generated 2026-11-23T18:05:44.770Z by `scripts/platform-drift.mjs` (schema 1).

| | Root | Commit |
|---|---|---|
| Base | `<SCRATCH>/eab-slice-view` | not a git checkout |
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
| api | `apps/api/src` | 235 | 7 | 3 | 72 | 153 | 96 | +1291 / -4665 | 4.3% |

## Modules by changed lines

| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|
| api | `auth` | 63 | 17 | 34 | 9 | +322 / -1345 | 5.6% |
| api | `storage` | 104 | 19 | 75 | 9 | +367 / -1060 | 1.1% |
| api | `device-auth` | 20 | 13 | 2 | 3 | +184 / -869 | 11.8% |
| api | `settings` | 44 | 5 | 29 | 10 | +250 / -685 | 0% |
| api | `users` | 13 | 6 | 1 | 5 | +43 / -248 | 12.5% |
| api | `test-auth` | 13 | 4 | 6 | 2 | +63 / -152 | 9.1% |
| api | `common` | 23 | 4 | 0 | 19 | +27 / -164 | 0% |
| api | `allowlist` | 11 | 3 | 2 | 4 | +12 / -84 | 28.6% |
| api | `health` | 9 | 1 | 4 | 4 | +23 / -58 | 0% |
| api | `(root)` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api | `config` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api | `prisma` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| api | `server-profiles` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| api | `terminal` | 17 | 0 | 0 | 17 | +0 / -0 | n/a |

## Most changed files (top 50)

| File | Lines +/- |
|---|---|
| `apps/api/src/auth/auth.service.ts` | +199 / -801 |
| `apps/api/src/storage/objects/objects.service.ts` | +82 / -468 |
| `apps/api/src/settings/system-settings/system-settings.service.ts` | +87 / -337 |
| `apps/api/src/device-auth/device-auth.service.ts` | +80 / -337 |
| `apps/api/src/settings/user-settings/user-settings.service.ts` | +87 / -247 |
| `apps/api/src/device-auth/README.md` | +30 / -296 |
| `apps/api/src/users/users.service.ts` | +27 / -189 |
| `apps/api/src/storage/objects/objects.controller.ts` | +44 / -162 |
| `apps/api/src/test-auth/test-auth.service.ts` | +56 / -123 |
| `apps/api/src/storage/providers/s3/s3-storage.provider.ts` | +26 / -147 |
| `apps/api/src/auth/guards/jwt-auth.guard.ts` | +4 / -151 |
| `apps/api/src/auth/auth.controller.ts` | +52 / -99 |
| `apps/api/src/common/filters/http-exception.filter.ts` | +17 / -100 |
| `apps/api/src/storage/processing/object-processing.service.ts` | +50 / -64 |
| `apps/api/src/auth/dto/auth-user.dto.ts` | +5 / -80 |
| `apps/api/src/health/health.controller.ts` | +23 / -58 |
| `apps/api/src/allowlist/allowlist.service.ts` | +7 / -73 |
| `apps/api/src/device-auth/device-auth.controller.ts` | +13 / -63 |
| `apps/api/src/storage/tasks/storage-cleanup.task.ts` | +57 / -13 |
| `apps/api/src/device-auth/dto/device-token-response.dto.ts` | +6 / -59 |
| `apps/api/src/storage/providers/storage-provider.types.ts` | +1 / -61 |
| `apps/api/src/common/interceptors/transform.interceptor.ts` | +6 / -55 |
| `apps/api/src/settings/settings.module.ts` | +10 / -51 |
| `apps/api/src/settings/user-settings/user-settings.controller.ts` | +35 / -24 |
| `apps/api/src/settings/system-settings/system-settings.controller.ts` | +31 / -26 |
| `apps/api/src/auth/decorators/auth.decorator.ts` | +11 / -45 |
| `apps/api/src/auth/interfaces/authenticated-user.interface.ts` | +14 / -37 |
| `apps/api/src/device-auth/dto/device-session.dto.ts` | +5 / -44 |
| `apps/api/src/storage/providers/storage-provider.interface.ts` | +2 / -45 |
| `apps/api/src/storage/storage.module.ts` | +12 / -30 |
| `apps/api/src/auth/guards/google-oauth.guard.ts` | +8 / -26 |
| `apps/api/src/auth/auth.module.ts` | +7 / -26 |
| `apps/api/src/auth/guards/permissions.guard.ts` | +8 / -25 |
| `apps/api/src/users/dto/user-response.dto.ts` | +5 / -28 |
| `apps/api/src/device-auth/dto/device-code-request.dto.ts` | +13 / -19 |
| `apps/api/src/users/users.controller.ts` | +9 / -22 |
| `apps/api/src/storage/objects/dto/object-list-query.dto.ts` | +20 / -4 |
| `apps/api/src/storage/objects/dto/object-response.dto.ts` | +19 / -5 |
| `apps/api/src/test-auth/test-auth.controller.ts` | +3 / -21 |
| `apps/api/src/device-auth/tasks/device-code-cleanup.task.ts` | +11 / -12 |
| `apps/api/src/storage/objects/dto/init-upload.dto.ts` | +17 / -6 |
| `apps/api/src/auth/tasks/token-cleanup.task.ts` | +7 / -12 |
| `apps/api/src/auth/decorators/current-user.decorator.ts` | +4 / -14 |
| `apps/api/src/device-auth/dto/device-code-response.dto.ts` | +5 / -13 |
| `apps/api/src/storage/providers/storage-providers.module.ts` | +4 / -14 |
| `apps/api/src/device-auth/dto/device-token-error.dto.ts` | +4 / -13 |
| `apps/api/src/storage/providers/index.ts` | +1 / -16 |
| `apps/api/src/allowlist/allowlist.controller.ts` | +3 / -11 |
| `apps/api/src/storage/objects/dto/complete-upload.dto.ts` | +8 / -5 |
| `apps/api/src/storage/processing/index.ts` | +9 / -4 |

## Zero-drift modules

Modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

None.
