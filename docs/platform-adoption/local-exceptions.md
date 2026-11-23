# Local exceptions to the platform

Every place where ShellKeep deviates from `@marinoscar/platform-*` on purpose, and the issue that removes it. Introduced by #40 (epic #31), completed by #83. An exception without a row here is a bug. At the baseline commit there are none: ShellKeep has not adopted any package yet.

## How to use this page

- **A shim in code** carries the comment `// PLATFORM-ADOPTION-SHIM(<issue>)`, where `<issue>` is the issue that removes it. List them all with `grep -rn "PLATFORM-ADOPTION-SHIM" apps/api/src`.
- **A deviation in the database** is an entry under `deviations` in `apps/api/prisma/platform.lock` (created by #45).
- **The PR that removes an exception deletes its row here.** It also removes the marker, the lock deviation and any allowlist entries it names.
- A new exception adds a row in the same PR, with an issue that removes it. If no issue exists, file one.

## Database deviations (declared in `platform.lock`)

| Deviation id | What differs from the platform | Where | Why | Removed by |
|---|---|---|---|---|
| `shellkeep:domain-schema` | ShellKeep's domain tables `server_profiles` and `terminal_sessions`, the enums `AuthMethod` and `SessionStatus` and their indexes and foreign keys, which platform `0001` does not create. Not a change to a platform table. | `apps/api/prisma/platform.lock` (`deviations`), created by migration `20260124223147_add_terminal_domain` | The tables were created by `prisma db push`, so a deployed database has them and the baseline dry run (B3) lists them as undeclared. The statements are the pre-`org_id` shape, so the baseline is run **before** `shellkeep_domain_org_id` is applied and never re-run after it. | Kept while the baseline can still be run on a pre-adoption database; deleted once every deployment has adopted it (after #84) |

## Code shims (`PLATFORM-ADOPTION-SHIM`)

| Shim | Where | What it does | Removed by |
|---|---|---|---|
| `DefaultOrgResolver` | `apps/api/src/prisma/default-org.resolver.ts`, used by `ServerProfilesService.create`, `SessionsService.create` and `ObjectsService` (storage objects, whose platform model requires `org_id`) | Reads the default organization's id once and caches it, so every new row is stamped with it while ShellKeep is single-organization | #47 (identity: the request's organization via `@CurrentOrg()` / `resolveOrgId`); the storage use ends with #52 |

## Standing constraints

| Constraint | Detail | Removed by |
|---|---|---|
| `server_profiles` and `terminal_sessions` carry `org_id` but are not under row-level security | Single organization only: the tables are not isolated per organization, and the API still connects as the bootstrap superuser (the `shellkeep_app` role exists but is not switched, #52). Every row's `org_id` is the default organization | A future multi-organization epic |

The `MonoRepo` rollback tag exists on `95145d0d850a4a53757b65d289158d58e34fc33d`.

## Drift allowlist

Intentional schema drift that the drift checks must accept (raw-SQL partial indexes, row-level-security policies). Empty at the baseline; the entries are added by #45 and the slice issues that introduce them, each with a reason.

| Entry | Reason | Added by |
|---|---|---|
| _none yet_ | | |
