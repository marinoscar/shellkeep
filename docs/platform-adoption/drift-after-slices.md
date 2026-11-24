# Platform drift report

Generated 2026-11-24T07:59:15.931Z by `scripts/platform-drift.mjs` (schema 1).

| | Root | Commit |
|---|---|---|
| Base | `<SCRATCH>/eab-slice-view` | not a git checkout |
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
| api | `apps/api/src` | 235 | 0 | 0 | 0 | 235 | 354 | +0 / -0 | 0% |

## Modules by changed lines

| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|
| api | `(root)` | 4 | 0 | 0 | 4 | +0 / -0 | n/a |
| api | `allowlist` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| api | `app-registrations` | 21 | 0 | 0 | 21 | +0 / -0 | n/a |
| api | `auth` | 54 | 0 | 54 | 0 | +0 / -0 | 0% |
| api | `command-safety` | 7 | 0 | 0 | 7 | +0 / -0 | n/a |
| api | `common` | 10 | 0 | 4 | 6 | +0 / -0 | 0% |
| api | `config` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api | `dashboard` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| api | `device-auth` | 17 | 0 | 17 | 0 | +0 / -0 | 0% |
| api | `email-templates` | 6 | 0 | 0 | 6 | +0 / -0 | n/a |
| api | `health` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api | `notifications-registry` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api | `onboarding` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api | `openapi` | 2 | 0 | 0 | 2 | +0 / -0 | n/a |
| api | `platform` | 75 | 0 | 0 | 75 | +0 / -0 | n/a |
| api | `prisma` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| api | `runbooks` | 105 | 0 | 0 | 105 | +0 / -0 | n/a |
| api | `server-profiles` | 21 | 0 | 0 | 21 | +0 / -0 | n/a |
| api | `settings` | 34 | 0 | 34 | 0 | +0 / -0 | 0% |
| api | `ssh` | 18 | 0 | 0 | 18 | +0 / -0 | n/a |
| api | `storage` | 95 | 0 | 95 | 0 | +0 / -0 | 0% |
| api | `terminal` | 48 | 0 | 0 | 48 | +0 / -0 | n/a |
| api | `terminal-ai` | 25 | 0 | 0 | 25 | +0 / -0 | n/a |
| api | `test-auth` | 11 | 0 | 11 | 0 | +0 / -0 | 0% |
| api | `users` | 8 | 0 | 8 | 0 | +0 / -0 | 0% |

## Most changed files (top 50)

No file differs after normalisation.

## Zero-drift modules

Modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

None.
