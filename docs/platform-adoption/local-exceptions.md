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
| Legacy `terminal.keyShortcuts` (#80) | `apps/web/src/lib/terminal/settings.ts` (`resolveKeyShortcuts`), `apps/api/src/terminal/settings/terminal.user-settings.ts` (`terminalSettingsSchema` still accepts the field on a stored row) | Before #80 the key bar's shortcuts were stored at `terminal.keyShortcuts`; they now live in the `shortcuts` user-settings namespace. The seed step `apps/api/prisma/settings-migrations/terminal-shortcuts.ts` moves every stored list (idempotent, inverse mapping with `--revert` in the same file); until it has run on a deployment, the client reads the old key when `shortcuts` is absent and the API keeps accepting it on a stored row. No write ever names it | #83 (once every deployment has run the seed: drop the field from the stored schema and the fallback from `resolveKeyShortcuts`) |

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

### Infrastructure (#73)

`infra/` is generated by `npm run platform:infra:sync` and checked in CI with `--check`. Everything below is app-owned, so a platform release never needs a hand merge.

| Decision | Detail | Removed by |
|---|---|---|
| Port 8323, not 3535 | `NGINX_PORT=8323` in `infra/compose/app.env.example` (dev and devdb); `APP_BIND_PORT=8323` in a VPS `.env`. The platform's `.env.example` still says `APP_URL=http://localhost:3535`, so a ShellKeep `.env` overrides `APP_URL` and `GOOGLE_CALLBACK_URL` | Kept (the shared VPS proxy and the docs use 8323) |
| `app.d/locations/terminal-ws.conf` | `/api/terminal/ws` needs a 3600 s read and send timeout; the platform's `/api` location reads for 60 s | Kept |
| `app.d/locations/runbook-streams.conf` | The runbook log SSE routes through `platform/sse-proxy.conf`; the path is a TODO until #62 merges | #62 |
| `app.d/locations/ai-terminal-streams.conf` | `/api/ai/terminal/` (terminal AI assistant); the generic AI response and telemetry assistant streams are already in the platform's `nginx.conf` | Kept |
| `app.d/locations/terminal-uploads.conf` | The terminal toolbar's multipart `POST /api/storage/objects` takes up to 100 MiB; the platform sets no `client_max_body_size` (nginx default 1 MiB) | Kept |
| Dockerfiles build from the repository root | The generated compose uses `context: ../..` with `apps/<app>/Dockerfile`, sources at `/app/apps/<app>`, and `web:5173` as the web upstream; the web production image listens on 5173 (`apps/web/nginx.conf`). The root `.dockerignore` replaces the per-app one | Kept |
| No `app.*.compose.yml` overlay | The platform defaults (512M api, 128M web) are kept: no measurement of concurrent SSH streams exists to justify another number. `vps` mode needs `apps/stack-agent`, which ShellKeep does not have yet | #72 / #74 |

### Identity ports bound by the host (#46)

`IDENTITY_METRICS` is bound to the host core's `AppMetricsService` and `IDENTITY_EVENT_BUS` to its event bus (`platform/identity/identity-host.module.ts`), so the identity slice records its metrics and invalidates its principal cache across replicas (`EVENT_BUS_ADAPTER=postgres`). `IDENTITY_AUTH_CREDENTIALS` (bound to the deployment `CredentialsService`; Google still reads the environment) and the host port `SYSTEM_SETTINGS_STORE` (bound to the settings slice's `SystemSettingsService`) were bound by #48.

### The host core (#46)

`platformHostModule` (`AUDIT_SINK`, `PLATFORM_PRISMA`, `SYSTEM_SETTINGS_STORE`) and `doctorModule` were mounted ahead of #46 because identity needs them. #46 completed the host: `platform/host-core.config.ts` (`PlatformHostCoreModule.forRoot`: event bus, app metrics, maintenance with `MaintenanceGuard` as the only `APP_GUARD`, the `{ data }` envelope, the exception filter, request ids, `/api/health`, `/live`, `/ready`), `platform/about/about.config.ts` (`GET /api/admin/about`) and `openapi/` plus `main.ts` (`registerPlatformDocs`: `/api/docs`, `/api/openapi.json`). The health paths are the platform's and equal the old ones, so no alias was needed and compose and nginx health checks are unchanged.

| Difference from the previous build | Detail | Resolved by |
|---|---|---|
| A 400 validation error carries `details.issues` | The platform exception filter names each offending field (`path`) and the validator's message, never a submitted value; the forked filter returned only `statusCode`, `code`, `message`, `timestamp` and `path`. The web client reads `message` and `code`, so nothing breaks | Kept (the platform's contract) |
| A maintenance 503 has `code: "ERROR"` and `details.reason: "MAINTENANCE_MODE"` | The filter derives `code` from the status; the marker the web keys on is `details.reason` (and the `Retry-After: 30` header) | Kept |
| `common/exceptions` stays | The host core has no seed exception and nothing references `DatabaseSeedException`, so it is dead code. `common/logger` was deleted with the telemetry adoption (#53) | Deleted with the seed review (#84) |
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

### Webhooks and alerts (#54)

`WebhooksModule.forRoot` (`platform/webhooks/`, host port in `webhooks-host.module.ts`) and `AlertsModule.forRoot` (`platform/alerts/`) are mounted after the database backup slice: `/api/webhooks`, `/api/org/webhooks`, `/api/admin/webhooks`, `/api/admin/alerts`, the job types `webhooks.deliver`, `webhooks.fanout`, `webhooks.deliveries_purge`, `alerts.evaluate`, `alerts.evaluate_event` and `alerts.incidents_purge`, the `webhook` notification channel and the `alerts.alert_fired`, `alerts.alert_resolved` and `webhooks.endpoint_disabled` notification events. Neither slice has a settings namespace or an environment variable, so no stored settings key moved. Every webhooks option is the slice's default: the SSRF guard is on, and a private receiver needs `allowedHosts` or `allowPrivateTargets` in `webhooks.config.ts` ([runbook](../runbooks/webhooks.md)).

| Decision | Detail | Removed by |
|---|---|---|
| ShellKeep's four starter alert rules are seeded by the app | The slice seeds a fixed list (`STARTER_ALERT_RULES`) and has no hook for an app's rules. `terminal/alerts/terminal-alert-rules.seed.ts` runs at start (`onApplicationBootstrap`) with the slice's own rule: insert if the key is absent, always disabled, never overwritten, a lost insert race is not an error. Keys `shellkeep.ssh_connect_failures`, `shellkeep.ssh_connect_slow`, `shellkeep.ws_auth_denied_spike`, `shellkeep.reaper_stalled` | A platform release whose alerts slice accepts the app's starter rules (seam request) |
| Two app alert rule kinds | `terminal_ssh_connect_p95` (a quantile of a histogram: `metric_threshold` aggregates a column and cannot interpolate buckets) and `terminal_job_stalled` (no job of a type succeeded: no built-in kind reads the queue). Registered with `registerAlertRuleKind` in `app-registrations/alerts.ts`; ids are permanent. The failure-count, WebSocket-refusal rules use `metric_threshold` with `rate` (per minute), so their thresholds are per-minute rates | Kept |
| The terminal events are `user` audience | `terminal.session.created`, `terminal.session.terminated` and `server_profile.host_key_changed` reach only the owner's own (`user` scope) endpoints, never an organization's or the deployment's, so one member's terminal activity is not visible to an administrator's endpoint. They are not bridged from notifications, and ShellKeep's notification events do not declare the `webhook` channel | Revisit if an organization-level feed is wanted |
| A session that ends by itself raises no event | `terminal.session.terminated` has the reasons `user`, `batch` and `reaped` (the issue's contract). A session whose tmux ended (the remote shell exited) is marked terminated by the session manager without an event | A follow-up that extends the reason set (the key stays) |
| `onEventNoIo` stays skipped | ShellKeep still declares no `@OnEvent` listener of its own; the webhooks and alerts listeners ship compiled in the package and the suite refuses a scan that finds none in the app's sources | The first ShellKeep listener |
| `PrismaSystemService` gained one injection | `platform/webhooks/webhooks-host.module.ts` binds `WEBHOOKS_SYSTEM_PRISMA` (reasons `webhooks` and `retention`); on the allowlist of `test/tenancy/system-injection-boundary.spec.ts` | Kept |

### Sharing (#71)

`SharingModule.forRoot` (`platform/sharing/sharing.config.ts`, host ports in `sharing-host.module.ts`) is mounted after the alerts slice: `/api/groups`, `/api/grants`, the grants prune job (`sharing.grants.prune`, server-only), the `sharing.groups.orphaned` Doctor check, and the notifications `groups.invitation` and `sharing.shared_with_you` with their e-mail templates (`email-templates/`). `server_profile` and `runbook` are the two resource types (`app-registrations/sharing.ts`); terminal sessions are deliberately not one.

| Decision | Detail | Removed by |
|---|---|---|
| **No row-level security on `server_profiles`** | Enabling RLS on ShellKeep's own tables is out of scope of #71. The table keeps its `org_id` reference and every query names it; the new `owner_group_id` is a COMPOSITE foreign key `(org_id, owner_group_id) -> groups (id, org_id)`, so a group of another organization cannot own a row (proved in `test/sharing/group-ownership.db.spec.ts`). `runbooks` already forces RLS (#61) | #83 |
| Credentials of a shared server stay with the user who saved them | `server_profiles.user_id` is the creator and the holder of the SSH secrets (`UserCredentialsService`, purpose `ssh`); a group-owned profile keeps its creating member as holder, because the credentials slice has no group tier. A grant carries a role, never a secret, and the secrets are read server-side only (`ServerProfilesService.getDecryptedProfile`), audited as `server_profile.connect_as_grantee` when the caller is not the holder. If the holder leaves the group, the profile keeps working; if the holder is deleted, the profile is deleted with them (`ON DELETE CASCADE`) | Kept (revisit if the credentials slice gains a group tier) |
| Only the credential holder changes the connection or the secrets | An `editor` may change the name, tags, color and host-key trust. A different hostname, port, username or auth method, and any secret, answer `403 SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY`, so a share cannot redirect a stored credential to another host | Kept |
| Ownership cannot be changed after creation | `ownerGroupId` is accepted on create only; there is no "move to group" route | Same |
| An open terminal keeps streaming after its share is revoked | The gateway re-checks `connect` on every attach and start (a revoked share answers `NOT_FOUND`), not on every keystroke of a socket that is already attached | Kept (the owner can terminate the session from the Sessions page) |
| The runbook list is private by default | Before #71 every member with `runbooks:read` saw every runbook of the organization; now a member sees their own, their groups' and those shared with them. A runbook whose author was deleted (`owner_user_id` NULL) and that has no group is owned by nobody: only `sharing:admin` can share it | Kept |
| The run engine (#62) must call `RunbooksService.requireRun` and `ServerProfilesService.getDecryptedProfile(id, principal, 'run')` | There is no run route yet. The decision API is in place: `run` on the runbook, `connect` per target (`TargetResolverService.resolve`), the credential audited on use | #62 |
| The runbook pages do not exist yet | `ShareResourceDialog` (`apps/web/src/components/common/`) carries the runbook roles; #65 mounts it on the runbook detail page and adds the owner chip and the "Shared with me" filter to the runbook list | #65 |
| `PrismaSystemService` gained one injection | `platform/sharing/sharing-data.adapter.ts` (reasons `purge`, `doctor`, `retention`, `link-resolution`, `invite-claim`); on the allowlist of `test/tenancy/system-injection-boundary.spec.ts`. `platform/sharing/sharing-access.ts` issues one `SELECT ... FROM <table>` (the EXISTS form of `accessibleWhere`) and is on the raw-SQL allowlist of `test/conformance.spec.ts` | Kept |
| The mocked integration suites run with allow-all sharing doubles | `test/helpers/sharing-doubles.ts` overrides `AccessPolicy` and `PrincipalGroupsProvider` in `createTestApp({ useMockDatabase: true })`; the real decisions are proven in `test/sharing/*.db.spec.ts` | Kept |

### Data export (#68)

`ExportsModule.forRoot` (`platform/exports/exports.config.ts`, host ports in `exports-host.module.ts`) is mounted after the sharing slice: `GET /api/exports/sources`, `POST|GET /api/exports`, `GET /api/exports/:id`, and the server-only jobs `export.run` and `export.purge`. The sources are ShellKeep's `server-profiles`, `terminal-sessions` and `runbook-runs` (`app-registrations/exports.ts`, implemented beside their domains in `server-profiles/export/`, `terminal/export/` and `runbooks/export/`, because `platform/` may not name the domain) plus the platform's `user-data`. Each ShellKeep source lists its columns as an allowlist and selects exactly those; `ServerProfile` keeps `exportOmit` for the three legacy ciphertext columns because the default redaction rule does not match their names. The proof is the `exports` conformance suite (`test/exports/exports-conformance.spec.ts`), `test/exports/export-sources-egress.spec.ts` (every writer, a client that returns every column) and `test/exports/exports.db.spec.ts` (real Postgres, real credential-store ciphertext).

| Decision | Detail | Removed by |
|---|---|---|
| **`runbook-runs` exports no dataset yet** | The run tables do not exist before #62. The source, its permission (`runbooks:read`) and its request shape (`from`, `to`, `runbookId`) are final; `runbookRunTables` in `runbooks/export/runbook-runs.export-source.ts` is the marked extension point, with the rules the implementation keeps (explicit owner filter, an allowlist of columns, artifact ids only, never log contents) | #62 |
| The legacy ciphertext columns are still in the schema | `encryptedPassword`, `encryptedPrivateKey` and `encryptedPassphrase` stay in `exportOmit` of the `ServerProfile` registry entry until the columns are dropped; `server-profiles` never selects them and `user-data` omits them | The migration that drops the columns |
| `includeShared` reaches the sharing slice through a binding | An export source has no injection, and the sharing conformance suite forbids a direct read of its tables, so `ServerProfilesExportBinding` (`server-profiles/export/`) hands the source the slice's `PrincipalGroupsProvider` at module init; `accessibleWhere` then decides the shared set in each organization the requester belongs to, as the list route does. Unbound (a process without the sharing slice), `includeShared` fails the export. More than 100,000 shared profiles fail it too | Kept |
| `PrismaSystemService` gained one injection | `platform/exports/exports-host.module.ts` binds `EXPORTS_SYSTEM_DATA` (reasons `export` and `purge`); on the allowlist of `test/tenancy/system-injection-boundary.spec.ts` | Kept |
| The Servers page Export action | `components/server-profiles/ExportServersButton.tsx` opens the packaged dialog preset to `server-profiles`; if #79 reworks the page, whichever lands second moves the button | #79 |

### User data deletion and factory reset (#69)

`UserDataModule.forRoot` (`platform/user-data/user-data.config.ts`, the bypass client in `user-data-host.module.ts`) is mounted after the exports slice. ShellKeep's decisions are pure data in `app-registrations/user-data.ts`; the manifest registers them after the platform's. The proof is the `userData` conformance suite (`test/user-data/user-data-conformance.spec.ts`), `test/user-data/user-data.integration.spec.ts` (the routes over HTTP) and, on a throwaway database owned by an ordinary role, `test/user-data/user-data-purge.db.spec.ts` and `test/user-data/factory-reset.db.spec.ts`.

| Decision | Detail | Removed by |
|---|---|---|
| **`ServerProfile` and `Runbook` are DELEGATED, not deleted inline** | The platform's `keepWhenReferenced` keeps a row with ANY back-relation, and every runbook has versions, so it cannot express "keep a group's runbook". A profile's SSH secrets are in the credential store, which only `UserCredentialsService` may delete. So `servers.user_data.purge` and `runbooks.user_data.purge` (`server-profiles/user-data/`, `runbooks/user-data/`) decide by ownership. The delegates are not run by the factory reset (it deletes rows only), so `shellkeep.servers.reset` deletes the profiles of the administrator, who is never deleted | Kept, unless the platform's hint grows an ownership predicate |
| The Runbook hint's `summary` is not printed | The platform prints a model's `summary` only on the "kept" lists, which list models a reset keeps; a runbook is deleted, so "Runbooks owned by a group stay with the group." is documentation, not page text. The factory reset step's `summary` does print, in "Deleted" | A platform change that prints summaries of deleted-with-exceptions models |
| No `storageObjectColumns` | No ShellKeep model has a column naming a `StorageObject` id: `TerminalSession` records no session log yet, and a run step records the KEY of its log (`log_storage_key`), which `runbooks.user_data.purge` deletes itself, bytes before rows. A future session-log writer adds its decision to the registry with it | The session-log writer |
| Step logs survive a factory reset in the bucket | They have no `storage_objects` row, and the reset's storage step pages those rows. `npm run storage:purge` sweeps the `runbook-artifacts/` prefix afterwards | A platform storage step that also sweeps registered prefixes |
| Offboarding is not usable | ShellKeep is single-organization (the default organization is never offboardable), and `server_profiles` and `terminal_sessions` reference `organizations` with `Restrict`, so a multi-organization deployment would need a precondition or a step first | Adopting multi-organization mode |
| `PrismaSystemService` gained one injection | `platform/user-data/user-data-db.adapter.ts` binds `USER_DATA_DB` (reasons `purge` and `admin-aggregate`); on the allowlist of `test/tenancy/system-injection-boundary.spec.ts`. The two delegated handlers use the same port | Kept |

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
| `logPromptContent` | Off by default. Turning it on logs prompt text, which for the terminal features is terminal snippets (already redacted by #56) | Kept |

### Terminal AI safety (#56)

Terminal output reaches an AI feature only through `TerminalContextService.forAi` (`apps/api/src/terminal-ai/`): consent, the per-server `aiOutputSharing` switch, ANSI stripping, redaction (`apps/api/src/command-safety/redact.ts`), size caps and one `terminal_ai.request` audit event holding kinds, counts and sizes only. `tmux capture-pane` exists only in `terminal/session-history.service.ts` (`test/terminal-ai/capture-boundary.spec.ts`). The settings namespace `terminalAi` is appended last in both the system list (tighten-only organization layer) and the user list (`consentAcceptedAt`). The new migration adds one column, `server_profiles.ai_output_sharing`.

| Difference | Detail | Resolved by |
|---|---|---|
| `POST /api/ai/terminal/consent` is an app route under `/api/ai/*` | It carries `AiEnabledGuard`, `AiOrgEnabledInterceptor` and `ai:use` like every platform consumer route there, so the `ai-kill-switch` and `ai-rbac-matrix` suites cover it | Kept |
| `POST /api/ai/terminal/assist` is an app route under `/api/ai/*` | It carries `AiEnabledGuard`, `AiOrgEnabledInterceptor` and `ai:use` (the `ai-rbac-matrix` suite allows no other permission in a declaration, so `sessions:write` is checked in the handler) like every platform consumer route there, so the `ai-kill-switch` and `ai-rbac-matrix` suites cover it | Kept |
| `/api/ai/terminal/sessions/:id/summaries` are app routes under `/api/ai/*`, and `ai.session.summarize` is an app `ai.*` job type | The routes carry `AiEnabledGuard`, `AiOrgEnabledInterceptor` and `ai:use` (`sessions:read` is checked in the handler), so `ai-kill-switch` and `ai-rbac-matrix` cover them. The `ai-kill-switch` suite keeps a fixed table of the platform's own `ai.*` job types and fails on an unknown one, with no extension point, so its fixture (`test/conformance/ai-fixture.ts`, `aiKillSwitchFixture`) boots without the handler; the handler's own proof (no pane read and no provider call while AI is off) is `test/terminal-ai/session-summary.integration.spec.ts`. `ai-jobs-server-only` boots the full app and checks the type. A seam request for an app job-payload table in the suite would remove the fixture | Kept until the suite takes an app table |
| `POST /api/ai/terminal/explain` and `/explain/preview` is an app route under `/api/ai/*` | It carries `AiEnabledGuard`, `AiOrgEnabledInterceptor` and `ai:use` (the `ai-rbac-matrix` suite allows no other permission in a declaration, so `sessions:read` is checked in the handler) like every platform consumer route there, so the `ai-kill-switch` and `ai-rbac-matrix` suites cover it | Kept |
| Redaction is best effort | The per-server switch is the hard control; the consent copy says so | Kept |

### The CLI (#72)

| Decision | Detail | Removed by |
|---|---|---|
| The workspace is named `cli`, not `@shellkeep/cli` | `npm run typecheck --workspace=cli` and the CI steps select a workspace by name; a scoped name would break them. The `bin` is `shellkeep` | Kept |
| `packages/shared` keeps the name `@shellkeep/shared` | Nothing imported it before the CLI; renaming it to the template's `@app/shared` would change the Docker layers and `.dockerignore` for no gain | Kept |
| `tmux-on-api-image` is a `recommended` check | The api image installs no tmux (a session's tmux runs on the target server over SSH), so a `required` check would fail every preflight. It reports the failure without blocking | Add tmux to the api image, then raise it to `required` |
| `proxy.streamPaths` also lists `/api/ai/terminal` | `infra/nginx/app.d/locations/ai-terminal-streams.conf` streams it for the inner nginx; the host proxy needs the same | Kept |
| There is no `deploy health` | The platform's pipeline reports health through `deploy status` (exit 1 when unhealthy) | Kept |
| A PAT on the terminal socket is re-validated every 15 minutes | A PAT has no `exp`; the socket is authorized for `PAT_SOCKET_TTL_MS` and the CLI re-sends `auth` every 10 minutes (the gateway's re-auth path) | Kept |
| The runbook commands and the Runs TUI screen are not shipped | They need the runbook routes of #62 | #62 |
| `nodeExecutors` is empty | No ShellKeep job type is node-eligible (`nodeResultSchema` and `persistNodeResult`) | A job type that declares itself eligible |
