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
| `TerminalPrincipalResolver` | `apps/api/src/terminal/ws/terminal-principal.resolver.ts` | Verifies an access token sent on the terminal WebSocket and resolves the principal (`JwtService` with the slice's secret, `AuthService.validateJwtPayload`, `toPrincipal`), because the identity slice resolves a bearer token only inside its HTTP guard. Seam request EnterpriseAppBase#1216: "verify an access token for a non-HTTP transport and return the principal". It relies on three `@internal` exports | The platform release that ships the seam, adopted in the PR that bumps the pin and replaces the class with the seam (no ShellKeep issue yet; tracked by EnterpriseAppBase#1216) |
| Storage status answered by the web host | `apps/web/src/platform/platformHost.tsx` (`hostApi`) | The packaged profile page (`UserProfilePage`) reads `GET /api/storage/status`, which ShellKeep does not serve yet, and the API refuses `imageSource: 'upload'` (see `ShellkeepSettingsProfileImages`). The host transport answers that one route with `{ configured: false }`, so the page shows the "storage is not configured" notice instead of an upload control that would fail; every other call goes to the app client | #50 (storage slice serves the route and the avatar upload) |
| `NoNodeObjectStore` and `NoNodeJobInputs` (`NODE_OBJECT_STORE`, `NODE_JOB_INPUTS`) | `apps/api/src/platform/jobs/node-ports.shim.ts` | The nodes data plane's two ports. ShellKeep registers no node-eligible job type (every job is server-only; an SSH credential is never brokered to a node), so no node ever holds a job with bytes to move and neither is reached. They refuse (an error, and the data plane's named "no input" 422) instead of minting a URL from ShellKeep's own S3 module | #50 (storage: `nodeObjectStoreBinding` and the input resolver) |
| `DefaultOrgResolver` | `apps/api/src/prisma/default-org.resolver.ts`, used by `ObjectsService` only (storage objects, whose platform model requires `org_id`) | Reads the default organization's id once and caches it, so every new storage object is stamped with it. The domain (server profiles, terminal sessions) takes the organization from the request since #47 | #50 (storage slice) |
| `fingerprintOf` / `sameFingerprint` and the probe's own SSH exchange | `apps/api/src/terminal/doctor/host-key-fingerprint.ts`, `apps/api/src/terminal/doctor/tmux-probe.ts` | The Doctor's `terminal.tmux.probe` (#46) verifies a profile's pinned `SHA256:` fingerprint inside ssh2's `hostVerifier`, before authenticating, with its own two-line fingerprint function and its own one-shot connection, because the host-key trust flow and the single SSH connection factory do not exist yet | #60 (host-key verification: the canonical `fingerprintOf` and the connection factory replace both) |

### Conformance exemptions (`apps/api/test/conformance.spec.ts`)

| Suite | Exemption | Why | Removed by |
|---|---|---|---|
| `on-event-no-io` | the suite is skipped with a reason (`onEventNoIo: { skip }`) | ShellKeep declares no `@OnEvent` listener. #50 deleted the app's only one (its storage module) and #51 added none: the notifications slice's listeners (job failure, broadcast failure, node offline) ship compiled in the package, the suite scans the app's `.ts` sources only, and it refuses a scan that finds no listener (`minListenerFiles` must be a positive integer). Not a violation: nothing exists to check | The first ShellKeep `@OnEvent` listener: re-enable with `{ minListenerFiles: 1 }` |
| `user-owned-data` | raw SQL in `prisma/prisma.service.ts` (test-only `cleanDatabase()`) | It touches no user-owned table in production code | Kept (the health indicator's entry went with its file in #46; the host core's own indicator lives in the package) |

### The queue and the fleet (#49)

`JobsModule.forRoot` and `NodesModule.forRoot` (`platform/jobs/jobs.config.ts`, host ports in `jobs-host.module.ts`) are mounted ahead of the settings composition, with `NodeCredentialModule`, which backs `IDENTITY_NODE_CREDENTIALS`. The `jobs`, `nodes` and `retention` system namespaces are registered by `platform/settings/registry.ts` after `maintenance`. Registered job types are pinned by `test/jobs/job-type-snapshot.spec.ts`: ShellKeep's `terminal.session.reap`, the jobs slice's `job.history.purge` and `audit.events.purge`, the nodes slice's `nodes.fleet.sweep`, `nodes.fleet.prune` and `nodes.node_events_purge`, and identity's `auth.token.cleanup` and `device-auth.code.cleanup` (the OAuth server's types register only when it is enabled). The identity jobs port is no longer a shim: `IdentityJobsAdapter` registers into the platform `JobHandlerRegistry` and enqueues through `enqueueHousekeepingJob`.

| Difference from the previous build | Detail | Resolved by |
|---|---|---|
| The reaper's counts are logged, not stored on the job | `JobHandler.process` returns nothing and the `jobs` table has no result column, so the Jobs page shows the run (status, attempts, duration) and the API log carries the three counts. `SessionReapHandler.reap()` returns them with the terminated session ids | Kept; since #51 the handler sends the reaped-session notification from the sessions `reap()` returns |
| The retention namespace lists policies of slices not adopted yet | `retention` carries `notifications`, `notificationDeliveries`, `auditEvents` and `aiRuns` from the platform. `auditEvents` (`audit.events.purge`, ships disabled), `notifications` and `notificationDeliveries` (#51) and, since #55, `aiRuns` (`ai.runs.purge`; the AI slice also registers `ai.usage.purge`) have handlers mounted | Resolved by #55 |

### Email and notifications (#51)

`EmailModule.forRoot` (`platform/email/`) and `NotificationsModule.forRoot` with `BroadcastsModule` (`platform/notifications/`) are mounted after the host core and before the storage routes. No environment variable: the transport (SMTP or SES), the sender and the VAPID keys are configured at runtime (`/api/email-settings`, `/api/admin/push-config`), the secrets live in the credential store under the deployment purposes `smtp`, `email_ses` and `push_vapid` (`app-registrations/credentials.ts`). The `notifications` system and user settings namespaces are registered by `platform/settings/registry.ts`, the `notifications` permission set by `app-registrations/platform-slices.ts` (`broadcasts:*`, `push:*`, `org_broadcasts:*`). The channel, template and event registries are filled by `app-registrations/notifications.ts`, not by a `platform/notifications/notification.manifest.ts`, because the base folders may not name the terminal domain. The identity notifier is a thin port bridge (no marker, no row): `security.role_changed`, `user.welcome` and `allowlist.invitation`; an organization invitation is logged and dropped in single-organization mode. The slice registers the job types `admin.broadcast.start`, `admin.broadcast.chunk`, `notifications.inbox.purge` and `notifications.deliveries.purge` (pinned by `test/jobs/job-type-snapshot.spec.ts`).

Web: `platform/notifications.ts` calls `configureNotificationsWeb` before the first render; `NotificationProvider` wraps the routes at the root (it opens the SSE stream only while signed in) and the packaged `NotificationBell` sits in the current `components/navigation/AppBar.tsx` until #76 moves it into the shell; `Layout.tsx` keeps this device's push subscription in sync and shows `NotificationPermissionBanner`; sign-out drops the subscription (`onBeforeLogout={removePushSubscription}`). The PWA build switched to `injectManifest`: the app's `src/sw.ts` precaches the shell, keeps the prompt update handshake of #46 and registers the packaged push and notification-click handlers from `@marinoscar/platform-web/notifications/service-worker`; it caches nothing under `/api` (the generated worker's runtime caches are dropped). Cards: admin `Email` (`system_settings:read`) and `Web Push` (`push:read`) appended to General, `Broadcasts` (`['broadcasts:read', 'org_broadcasts:read']`, the controller's `anyPermissions`) appended to Operations, and the user `Notifications` card appended to Account. The admin `Notifications` policy page (`NotificationSettingsPage`) is not mounted yet.

| Difference | Detail | Resolved by |
|---|---|---|
| `terminal.session_reaped` is on for in-app, email and push by default | The platform has one `defaultEnabled` per event, not per channel, so the intended default (in-app on, email off, push off) cannot be declared. Email is sent only when a transport is configured and push only to a browser that subscribed; a user switches either off in the preferences matrix | Kept until the platform supports per-channel defaults (seam request) |
| The runbook events are defined but not registered | `registerRunbookNotifications()` (`notifications-registry/runbooks.notifications.ts`) registers `runbooks.run_finished`, `runbooks.run_failed` and `runbooks.approval_requested` and their templates; Fleet Runbooks calls it when its module is mounted, so the preferences matrix does not list events that cannot fire | #61 |
| The reaped-session notification is one per owner per pass | `SessionReapHandler.process()` calls `notify` after `reap()` returned (its updates are autocommitted statements, never inside a `$transaction`), listing up to ten sessions (longest idle first) and counting the rest | Kept |

### Database backup and restore, and the application role (#52)

`DbBackupModule.forRoot` (`platform/db-backup/db-backup.config.ts`, host ports in `db-backup-host.module.ts`) is mounted after the storage routes: `/api/admin/db-backup`, the job types `db.backup.run`, `db.backup.sweep`, `db.restore.run` and `db.restore.old-db-drop`, the `databaseBackup` system namespace and four Doctor checks. Self-hosted: restore is on. The target is the storage slice's active provider under `database-backups/`; no mirror. No environment variable was added.

| Decision | Detail | Removed by |
|---|---|---|
| **No `RestoreCarryOver` is registered** | ShellKeep keeps no deployment state outside the database that a restore must carry across the swap. The slice carries the backup catalog (`database_backup_runs`) and the restore's own job row itself. Server profiles and terminal sessions are ordinary rows in the archive; SSH secrets are ciphertext in the credential store and open again with the same `SECRETS_ENCRYPTION_KEY`, which lives outside the database (an archive restored under another key keeps every profile but cannot connect). Add one only if a later slice keeps state that must survive a restore | Revisit when a slice adds such state |
| The API connects as `shellkeep_app` | `POSTGRES_USER` / `POSTGRES_PASSWORD` name the role; there is no second set of variables for the restore: its cluster-admin connection (a short-lived client on the `postgres` database, outside the Prisma pool) uses the same login, so the role carries `CREATEDB` (`create-app-role.sql`, `-v createdb=off` to withhold it). The bootstrap superuser is used only by the operator: extensions, the role script, a manual restore | Kept |
| `PrismaSystemService` is injected by an allowlist | `test/tenancy/system-injection-boundary.spec.ts`: the storage host module, the backup host module (Doctor `backup.rls-bypass`) and `main.ts` (startup count of `org_credentials`). The same spec lists the files of ShellKeep's own code that name an org table | Kept |
| `infra/deploy/*.sh` take no backup | `DEPLOY.md` describes a manual `pg_dump`, now superseded by the admin page | #72 replaces the deploy scripts |

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

### Storage (#50)

`StorageModule.forRoot`, `StorageConfigModule` and `ProfileImageModule.forRoot` are mounted from `platform/storage/storage.config.ts`; the `storage` system namespace is registered by `platform/settings/registry.ts` and the `storage` credential purpose by `app-registrations/credentials.ts`. `STORAGE_SYSTEM_DATA` is bound to `PrismaSystemService`, a separate pool whose transactions set `app.rls_bypass` (`platform/storage/storage-host.module.ts`); only that file injects it (the settings profile-image adapter reaches the same port). The nodes data plane uses `nodeObjectStoreBinding` and `NodeJobInputsAdapter`.

| Difference from the previous build | Detail | Resolved by |
|---|---|---|
| Objects no longer expire after 24 hours | ShellKeep's `StorageExpiryTask` deleted every storage object older than a day. The slice only reclaims unfinished uploads (`storage.cleanup.stale-uploads`). Avatars, session logs and runbook artifacts must persist | Kept |
| Objects routes need `storage:read` / `storage:write` | The forked controller used a bare `@Auth()`. The slice's permissions are seeded to contributor and viewer (read) and org_admin; a viewer can no longer upload | Kept |
| Another user's object in the same organization answers 403, not 404 | The slice reports an object the caller can see but does not own as forbidden; another organization's object is a 404 (row-level security) | Kept (the platform's contract) |
| New object keys are `uploads/<orgId>/<timestamp>/...` | Existing rows keep their stored `storage_key`; nothing is moved | Kept |
| `STORAGE_PART_SIZE` is gone | The part size is the slice's 10 MiB default; `storage:import-env` reports a different old value and ignores it | Kept |
| A legacy `customImageUrl` profile picture is no longer shown | The platform rule reads a `useProviderImage: false` profile as `imageSource: 'none'` and ignores `customImageUrl` | Kept |

## App-owned host pieces (not shims)

| Piece | Where | Why it is the app's | Removed by |
|---|---|---|---|
| `TerminalMaintenancePolicy` | `apps/api/src/terminal/ws/terminal-maintenance.policy.ts` | `MaintenanceGuard` covers HTTP only; the terminal WebSocket applies the same window itself (the admin rule and every `registerMaintenanceBypass` predicate), refusing only a NEW `auth` or `connect` with `{ type: 'auth_fail', reason: 'maintenance' }`. An open socket is never closed | Kept (domain) |
| The `terminal` About section and the four `terminal.*` Doctor checks, with the `terminal.ssh` egress contributor | `apps/api/src/terminal/about/`, `apps/api/src/terminal/doctor/` | The terminal domain's own facts and health | `terminal.ssh.legacy-secrets` goes with the legacy columns in #84; the rest is kept |
| The terminal socket's maintenance state | `apps/web/src/services/terminal-ws.ts`, `components/terminal/TerminalConnectionAlert.tsx` | The packaged `MaintenanceGate` reads HTTP 503s only; the socket treats the gateway's `maintenance` refusal as its own state: no reconnect loop, an info banner with Retry | Kept (domain) |
| The admin `Terminal` card | `apps/web/src/components/terminal/settings/TerminalSystemSettingsPage.tsx`, card in `apps/web/src/config/adminSections.tsx` | Edits the `terminal` system namespace (the reaper thresholds and the Doctor probe profile) on the packaged `useSystemSettings`; the profile select lists the viewer's own server profiles | Kept (domain) |

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
| `server_profiles` and `terminal_sessions` carry `org_id` but are not under row-level security | Single organization only: the tables are not isolated per organization, and the API connects as the ordinary `shellkeep_app` role since #52, which only matters for the platform's org tables. Every row's `org_id` is the default organization | A future multi-organization epic |

The `MonoRepo` rollback tag exists on `95145d0d850a4a53757b65d289158d58e34fc33d`.

## Drift allowlist

Intentional schema drift that the drift checks must accept (raw-SQL partial indexes, row-level-security policies). Empty at the baseline; the entries are added by #45 and the slice issues that introduce them, each with a reason.

| Entry | Reason | Added by |
|---|---|---|
| _none yet_ | | |

### The AI slice (#55)

`AiModule.forRoot({ imports: [AiHostModule] })` (`platform/ai/ai.config.ts`) is mounted after the db-backup slice and before the domain modules; a feature module imports that same `AiModule`, never the platform's. No environment variable and no provider key in the repository: keys are stored at runtime in `user_ai_keys` (a user's own), `org_credentials` or `credentials` (encrypted with `SECRETS_ENCRYPTION_KEY`), AI is off until an administrator enables it at `/admin/settings/ai`, and the tables came with platform migration `add_ai_platform` (no new migration). `AiHostModule` binds `AI_SYSTEM_PRISMA` (the bypass client, allowlisted in `system-injection-boundary.spec.ts`), `AI_OBJECT_STORE` (a view over the storage slice), `AI_METRICS` and `DefaultAiTargetResolver` (the platform order; ShellKeep has no resolver of its own). The five features (`terminal_assist`, `terminal_explain`, `session_summary`, `runbook_agent`, `runbook_draft`) are registered by `app-registrations/ai.ts`; the `ai` permission slice, the AI credential purpose, the `ai` system namespace (appended last, organization-overridable) and the user namespace are registered with the other manifests. The eight `ai.*` job types are pinned in `test/jobs/job-type-snapshot.spec.ts` and are server-only. The seven `ai-*` conformance suites run with no skip.

| Difference | Detail | Resolved by |
|---|---|---|
| `viewer` holds no `ai:use` | The platform grants `ai:use` to `org_admin` and `contributor` only (the same as the reference app); a viewer can read `GET /api/ai/config` but not use AI or store a key | Kept (a platform decision) |
| Telemetry assistant shim | The `TELEMETRY_AI` disabled adapter shim marked `#55` lives on the telemetry branch (#53), not here; once this slice is merged it can be replaced by the real adapter over `AiService` | A follow-up after #53 and #55 merge |
| `logPromptContent` | Off by default. Turning it on logs prompt text, which for the terminal features is terminal snippets (already redacted by #56) | Kept |
