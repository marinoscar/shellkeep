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

## App migrations that move platform data

| Migration | What it does | Why it is not a platform change |
|---|---|---|
| `20261123200125_shellkeep_permissions_org_scope` (#47) | Sets the six `servers:*` and `sessions:*` permissions to scope `org`, copies `admin`'s grants of them to `org_admin` and deletes them from `admin`, as platform migration `0024_split_system_org_roles` did for the platform's own org permissions | The permissions are ShellKeep's. `seedPlatform` writes the scope and the `org_admin` grants but never deletes a grant, so the data move has to be a migration. Idempotent; a no-op on a database the seed has not reached |

## Code shims (`PLATFORM-ADOPTION-SHIM`)

| Shim | Where | What it does | Removed by |
|---|---|---|---|
| `IdentityJobsAdapter` (`IDENTITY_JOBS`) | `apps/api/src/platform/identity/identity-jobs.adapter.ts` | ShellKeep has no job queue. The identity slice registers its two housekeeping handlers (`auth.token.cleanup`, `auth.device-code.cleanup`) with `registerHandler` and its enqueue-only crons call `enqueueHousekeepingJob`; the adapter runs the registered handler in-process, one at a time per type. Both are idempotent deletes of expired credential rows | #49 (jobs: the platform's `JobsService` and `JobHandlerRegistry`) |
| `IdentityNodeCredentialsAdapter` (`IDENTITY_NODE_CREDENTIALS`) | `apps/api/src/platform/identity/identity-node-credentials.adapter.ts` | Resolves no `nod_` worker-node token (every one is a 401); ShellKeep has no worker nodes | #49 (nodes: `NodeCredentialService`) |
| `IdentityNotifierAdapter` (`IDENTITY_NOTIFIER`) | `apps/api/src/platform/identity/identity-notifier.adapter.ts` | Logs (debug, no address) and drops `roleChanged`, `userWelcomed` and `allowlistInvitation`; `orgInvitation` is dropped for good in single-organization mode. ShellKeep has no email or notifications slice | #51 (notifications: `NotificationsService`) |
| `ShellkeepProfileImages` (`IDENTITY_PROFILE_IMAGES`) | `apps/api/src/platform/identity/identity-user.adapters.ts` | Reads the stored `profile` user setting as ShellKeep always has (custom image when `useProviderImage` is false, else the provider's). The platform rule reads `profile.imageSource` and an uploaded storage object | #50 (storage: `resolveProfileImageUrl`) |
| `TerminalPrincipalResolver` | `apps/api/src/terminal/ws/terminal-principal.resolver.ts` | Verifies an access token sent on the terminal WebSocket and resolves the principal (`JwtService` with the slice's secret, `AuthService.validateJwtPayload`, `toPrincipal`), because the identity slice resolves a bearer token only inside its HTTP guard. Seam request EnterpriseAppBase#1216: "verify an access token for a non-HTTP transport and return the principal". It relies on three `@internal` exports | The platform release that ships the seam, adopted in the PR that bumps the pin and replaces the class with the seam (no ShellKeep issue yet; tracked by EnterpriseAppBase#1216) |
| `DefaultOrgResolver` | `apps/api/src/prisma/default-org.resolver.ts`, used by `ObjectsService` only (storage objects, whose platform model requires `org_id`) | Reads the default organization's id once and caches it, so every new storage object is stamped with it. The domain (server profiles, terminal sessions) takes the organization from the request since #47 | #50 (storage slice) |

### Conformance exemptions (`apps/api/test/conformance.spec.ts`)

| Suite | Exemption | Why | Removed by |
|---|---|---|---|
| `cron-enqueue-only` | `terminal/tasks/session-cleanup.task.ts` | Reaps stale sessions inline; no queue yet | #49 (becomes the enqueue-only cron and the `terminal.session.reap` job) |
| `cron-enqueue-only` | `storage/tasks/storage-cleanup.task.ts`, `storage/tasks/storage-expiry.task.ts` | ShellKeep's own storage module works inline | #50 (deleted for the storage slice) |
| `user-owned-data` | raw SQL in `prisma/prisma.service.ts` (test-only `cleanDatabase()`) and `health/indicators/database.indicator.ts` (`SELECT 1`) | Neither touches a user-owned table | Kept; the health indicator goes with #46 |

### Optional identity ports left unbound

Not code shims: the ports are optional, and leaving one unbound means the slice records nothing or reads the environment.

| Port | Effect while unbound | Bound by |
|---|---|---|
| `IDENTITY_METRICS` | The slice records no metrics | #46 (host: `AppMetricsService`) |
| `IDENTITY_EVENT_BUS` | The principal cache is invalidated in this process only (single instance) | #46 (host: the event bus) |
| `IDENTITY_AUTH_CREDENTIALS` | Google reads `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the environment | #48 (credentials store) |
| `SYSTEM_SETTINGS_STORE` (platform host port) | Not injected by the identity slice; ShellKeep's own system settings stay in `settings/` | #48 |

Adopted ahead of #46 because identity needs them: `platformHostModule` (`AUDIT_SINK`, `PLATFORM_PRISMA`) and `doctorModule` (`GET /api/admin/doctor`, `system_settings:read`, with the slice's `auth.*` and `tenancy.*` checks). #46 mounts the rest of the host core and the Doctor's other checks.

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
