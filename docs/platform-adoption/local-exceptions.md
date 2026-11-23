# Local exceptions to the platform

Every place where ShellKeep deviates from `@marinoscar/platform-*` on purpose, and the issue that removes it. Introduced by #40 (epic #31), completed by #83. An exception without a row here is a bug. At the baseline commit there were none; rows are added as slices are adopted.

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
| `ShellkeepProfileImages` (`IDENTITY_PROFILE_IMAGES`) | `apps/api/src/platform/identity/identity-user.adapters.ts` | Picks the picture `/api/auth/me` and `/api/users` report from the stored `profile` setting: `imageSource` `none` hides it (the platform settings slice writes it since #48), a legacy row keeps ShellKeep's old rule (custom image when `useProviderImage` is false, else the provider's). The platform rule also serves an uploaded avatar object | #50 (storage: `resolveProfileImageUrl`) |
| `ShellkeepSettingsProfileImages` (`SETTINGS_PROFILE_IMAGES`) | `apps/api/src/platform/settings/settings-profile-images.adapter.ts` | Normalises a stored `profile` with the platform's rule (a legacy `useProviderImage` row reads as `imageSource`); `isUploadedAvatar` answers false because ShellKeep's own storage module writes no avatar object, so `imageSource: 'upload'` is a 400 | #50 (storage: the avatar check) |
| `TerminalPrincipalResolver` | `apps/api/src/terminal/ws/terminal-principal.resolver.ts` | Verifies an access token sent on the terminal WebSocket and resolves the principal (`JwtService` with the slice's secret, `AuthService.validateJwtPayload`, `toPrincipal`), because the identity slice resolves a bearer token only inside its HTTP guard. Seam request EnterpriseAppBase#1216: "verify an access token for a non-HTTP transport and return the principal". It relies on three `@internal` exports | The platform release that ships the seam, adopted in the PR that bumps the pin and replaces the class with the seam (no ShellKeep issue yet; tracked by EnterpriseAppBase#1216) |
| Storage status answered by the web host | `apps/web/src/platform/platformHost.tsx` (`hostApi`) | The packaged profile page (`UserProfilePage`) reads `GET /api/storage/status`, which ShellKeep does not serve yet, and the API refuses `imageSource: 'upload'` (see `ShellkeepSettingsProfileImages`). The host transport answers that one route with `{ configured: false }`, so the page shows the "storage is not configured" notice instead of an upload control that would fail; every other call goes to the app client | #50 (storage slice serves the route and the avatar upload) |
| `DefaultOrgResolver` | `apps/api/src/prisma/default-org.resolver.ts`, used by `ObjectsService` only (storage objects, whose platform model requires `org_id`) | Reads the default organization's id once and caches it, so every new storage object is stamped with it. The domain (server profiles, terminal sessions) takes the organization from the request since #47 | #50 (storage slice) |
| `fingerprintOf` / `sameFingerprint` and the probe's own SSH exchange | `apps/api/src/terminal/doctor/host-key-fingerprint.ts`, `apps/api/src/terminal/doctor/tmux-probe.ts` | The Doctor's `terminal.tmux.probe` (#46) verifies a profile's pinned `SHA256:` fingerprint inside ssh2's `hostVerifier`, before authenticating, with its own two-line fingerprint function and its own one-shot connection, because the host-key trust flow and the single SSH connection factory do not exist yet | #60 (host-key verification: the canonical `fingerprintOf` and the connection factory replace both) |

### Conformance exemptions (`apps/api/test/conformance.spec.ts`)

| Suite | Exemption | Why | Removed by |
|---|---|---|---|
| `cron-enqueue-only` | `terminal/tasks/session-cleanup.task.ts` | Reaps stale sessions inline; no queue yet | #49 (becomes the enqueue-only cron and the `terminal.session.reap` job) |
| `cron-enqueue-only` | `storage/tasks/storage-cleanup.task.ts`, `storage/tasks/storage-expiry.task.ts` | ShellKeep's own storage module works inline | #50 (deleted for the storage slice) |
| `credentials` | the suite's `purposes` option names the platform's storage purpose definition instead of the registry | ShellKeep registers no deployment (system or organization) credential purpose until #50, and the suite refuses a scan of zero; the `ssh` user purpose is checked from the registry | #50 (storage registers its purpose; the option is deleted) |
| `user-owned-data` | raw SQL in `prisma/prisma.service.ts` (test-only `cleanDatabase()`) | It touches no user-owned table in production code | Kept (the health indicator's entry went with its file in #46; the host core's own indicator lives in the package) |

### Identity ports bound by the host (#46)

`IDENTITY_METRICS` is bound to the host core's `AppMetricsService` and `IDENTITY_EVENT_BUS` to its event bus (`platform/identity/identity-host.module.ts`), so the identity slice records its metrics and invalidates its principal cache across replicas (`EVENT_BUS_ADAPTER=postgres`). `IDENTITY_AUTH_CREDENTIALS` (bound to the deployment `CredentialsService`; Google still reads the environment) and the host port `SYSTEM_SETTINGS_STORE` (bound to the settings slice's `SystemSettingsService`) were bound by #48.

### The host core (#46)

`platformHostModule` (`AUDIT_SINK`, `PLATFORM_PRISMA`, `SYSTEM_SETTINGS_STORE`) and `doctorModule` were mounted ahead of #46 because identity needs them. #46 completed the host: `platform/host-core.config.ts` (`PlatformHostCoreModule.forRoot`: event bus, app metrics, maintenance with `MaintenanceGuard` as the only `APP_GUARD`, the `{ data }` envelope, the exception filter, request ids, `/api/health`, `/live`, `/ready`), `platform/about/about.config.ts` (`GET /api/admin/about`) and `openapi/` plus `main.ts` (`registerPlatformDocs`: `/api/docs`, `/api/openapi.json`). The health paths are the platform's and equal the old ones, so no alias was needed and compose and nginx health checks are unchanged.

| Difference from the previous build | Detail | Resolved by |
|---|---|---|
| A 400 validation error carries `details.issues` | The platform exception filter names each offending field (`path`) and the validator's message, never a submitted value; the forked filter returned only `statusCode`, `code`, `message`, `timestamp` and `path`. The web client reads `message` and `code`, so nothing breaks | Kept (the platform's contract) |
| A maintenance 503 has `code: "ERROR"` and `details.reason: "MAINTENANCE_MODE"` | The filter derives `code` from the status; the marker the web keys on is `details.reason` (and the `Retry-After: 30` header) | Kept |
| `common/logger` and `common/exceptions` stay | The host core has no Pino logger or seed exception; nothing injects `LoggerService` and nothing references `DatabaseSeedException`, so both are dead code | Deleted with the telemetry adoption (#53) and the seed review (#84) |
| `@stoplight/spectral-cli` is a root dev dependency | The OpenAPI CI job lints the dumped document with the platform's Spectral ruleset (`.spectral.yaml`) | Kept |

## App-owned host pieces (not shims)

| Piece | Where | Why it is the app's | Removed by |
|---|---|---|---|
| `TerminalMaintenancePolicy` | `apps/api/src/terminal/ws/terminal-maintenance.policy.ts` | `MaintenanceGuard` covers HTTP only; the terminal WebSocket applies the same window itself (the admin rule and every `registerMaintenanceBypass` predicate), refusing only a NEW `auth` or `connect` with `{ type: 'auth_fail', reason: 'maintenance' }`. An open socket is never closed | Kept (domain) |
| The `terminal` About section and the four `terminal.*` Doctor checks, with the `terminal.ssh` egress contributor | `apps/api/src/terminal/about/`, `apps/api/src/terminal/doctor/` | The terminal domain's own facts and health | `terminal.ssh.legacy-secrets` goes with the legacy columns in #84; the rest is kept |

## App-owned settings and credentials (not shims)

What ShellKeep declares itself because the platform has no equivalent. None is removed by a later issue unless it says so.

| Declaration | Where | Why it is the app's | Removed by |
|---|---|---|---|
| System namespaces `ui` (`allowUserThemeOverride`) and `features` (free-form flags) | `apps/api/src/platform/settings/app-system-settings.ts`, listed in `app-registrations/settings.ts` | Keys the `global` row has always held; the platform declares no `ui` or `features` namespace and ShellKeep stores no key without a home (the platform also keeps unknown keys on write, so nothing is dropped either way) | Kept; revisit with the shell (#76) if the platform grows an equivalent |
| System namespace `terminal` (`detachAfterMinutes`, `terminateDetachedAfterHours`, `purgeTerminatedAfterDays`, `doctorProbeProfileId`) and user namespace `terminal` (`showScrollButtons`, `keyShortcuts`) | `apps/api/src/terminal/settings/` | The terminal domain's own settings | Kept (domain) |
| `USER_DEFAULTS` seeds the terminal defaults | `app-registrations/settings.ts` (`APP_USER_SETTINGS_INITIAL_VALUES`), used by `platform/identity/identity-user.adapters.ts` | A new user's stored document keeps the shape ShellKeep always created (the platform leaves an optional namespace absent) | Optional since #48: the web applies the same defaults when the namespace is absent (`apps/web/src/lib/terminal/settings.ts`); kept so stored rows keep their shape |
| User purpose `ssh` (`system: null`, `fallback: []`) | `apps/api/src/app-registrations/credentials.ts` | A server's secret is its owner's alone | Kept (domain) |
| The platform's `dataTables` and `navigation` user namespaces are not registered | `apps/api/src/platform/settings/registry.ts` | ShellKeep's web has no consumer yet; unknown stored keys are stripped on write, and no row holds them | #76 (shell) and #80 register them with their first consumer |

## Standing constraints

| Constraint | Detail | Removed by |
|---|---|---|
| `server_profiles.encrypted_password`, `encrypted_private_key` and `encrypted_passphrase` are LEGACY | Never read or written since #48; they hold the secrets as the old build left them (AES-256-GCM under the legacy `ENCRYPTION_KEY`), so the previous build still works for a rollback. `ENCRYPTION_KEY` stays in the environment for `npm run ssh:migrate-secrets` only ([runbook](../runbooks/ssh-secret-reencryption.md)) | #84 (a migration drops the columns after production verification; `ENCRYPTION_KEY` leaves the environment and `server-profiles/migrate/` is deleted) |
| SSH secrets of 8+ characters get a platform display hint | SSH secrets of 8+ characters get a platform display hint (last 4 characters) stored in clear in `user_credentials.hint`; ShellKeep never reads or returns it | Removed when EnterpriseAppBase#1218 lands (per-purpose `hint: 'none'`) |
| `server_profiles` and `terminal_sessions` carry `org_id` but are not under row-level security | Single organization only: the tables are not isolated per organization, and the API still connects as the bootstrap superuser (the `shellkeep_app` role exists but is not switched, #52). Every row's `org_id` is the default organization | A future multi-organization epic |

The `MonoRepo` rollback tag exists on `95145d0d850a4a53757b65d289158d58e34fc33d`.

## Drift allowlist

Intentional schema drift that the drift checks must accept (raw-SQL partial indexes, row-level-security policies). Empty at the baseline; the entries are added by #45 and the slice issues that introduce them, each with a reason.

| Entry | Reason | Added by |
|---|---|---|
| _none yet_ | | |
