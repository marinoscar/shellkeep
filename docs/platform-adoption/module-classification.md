# Module classification

Frozen baseline classification of every top-level ShellKeep module against EnterpriseAppBase (EAB) and its `@marinoscar/platform-*` packages. Input: the generated reports [drift-baseline.md](drift-baseline.md) (apps view) and [drift-baseline-slices.md](drift-baseline-slices.md) (slice view). Part of the platform retrofit program (#30, #31); tracked by issue #40.

| Field | Value |
|---|---|
| EAB commit | `6ea11edbecd6794e3da09680834713f562423cdd` |
| ShellKeep commit | `95145d0d850a4a53757b65d289158d58e34fc33d` (the pre-adoption commit, the `MonoRepo` rollback point) |
| Date | 2026-11-23 |

## How the numbers were produced

Both reports come from EAB's `scripts/platform-drift.mjs`, run from a scratch directory. `<EAB>` is a checkout of EnterpriseAppBase at the commit above, `<SHELLKEEP>` is a checkout of ShellKeep at its commit, `<SCRATCH>` is a temporary directory.

```bash
# Apps view: ShellKeep against EAB's apps/ layout (web, prisma, infra, api bindings)
cd <SCRATCH> && node <EAB>/scripts/platform-drift.mjs \
  --app <SHELLKEEP> --base <EAB> --out <SCRATCH>/apps \
  --app-product-name ShellKeep --app-repo-slug marinoscar/shellkeep

# Slice view: each ShellKeep base module against its packaged slice (API only)
bash <SHELLKEEP>/scripts/platform-adoption/make-slice-view.sh <EAB> <SCRATCH>/eab-slice-view
cd <SCRATCH> && node <EAB>/scripts/platform-drift.mjs \
  --app <SHELLKEEP> --base <SCRATCH>/eab-slice-view --areas api --out <SCRATCH>/slices \
  --app-product-name ShellKeep --app-repo-slug marinoscar/shellkeep
```

The slice view needs the two identity flags too: ShellKeep has no `packages/shared/identity.json`, so without them the product and slug would not be normalised. Only `.env.example` files appear in the reports (no real `.env` file exists in the tree), and the reports list paths and line counts, never contents.

The apps view under-counts the API: EAB's `apps/api/src` holds only bindings, so ShellKeep's base modules show as app-only. For API base modules the **Drift** column therefore uses the slice view; everything else (web, prisma, infra, API modules with no slice) uses the apps view. Drift is written `identical % / +lines added −lines removed`; identical % counts identical and normalised-identical files over the base-side files, `n/a` when the base has no file at that path. **Files** counts the ShellKeep-side files under the path (specs included).

A drift figure is small evidence of intent: ShellKeep is a fork of an older EAB, so most "drift" is the platform having moved on (new fields, org scoping, rewritten services), not ShellKeep changes. The categories below separate the two.

## Categories

- **noise**: differs from the platform only because the platform moved on, or only in comments, whitespace, identity or issue numbers, or the package covers it with no behaviour loss. The package replaces it. Delete on adoption.
- **backport**: ShellKeep changed a base module in a way the platform lacks (domain content living inside a base file). ShellKeep sends no seam PRs, so each one is re-expressed as a ShellKeep workaround on top of the package (registry entry, namespace, permission declaration, side module). The row names the workaround and the issue that applies it.
- **domain**: ShellKeep product code (server profiles, terminal sessions, SSH, xterm.js UI). Stays in ShellKeep.
- **shellkeep-divergence**: ShellKeep and EAB solved the same problem differently (composition roots, deploy scripts) and ShellKeep keeps its own design for now. The row says which issue converges it.
- **mixed**: an umbrella row for a directory holding files of several categories; its files are classified in the rows that follow it.

Issue numbers are GitHub issues of `marinoscar/shellkeep`: #44 base to domain decoupling, #45 database baseline, #46 host, #47 identity, #48 settings and credentials, #49 jobs, #50 storage, #53 telemetry, #72 CLI, #73 infra, #76 web shell, #78 to #80 home, servers and terminal preferences. Targets are EAB slice names from `packages/platform-slices.json`.

### ShellKeep workarounds referenced below

| Workaround | What it is | Used by | Applied by |
|---|---|---|---|
| Terminal user-settings namespace | The `terminal` block (`showScrollButtons`, `keyShortcuts`, max 50) is domain content inside the base user-settings schema, types and service. It moves to `apps/api/src/terminal/settings/terminal.user-settings.ts` and is registered with `registerUserSettingsNamespaces`; stored key names do not change. Resolved by #44 (API), then #48: the namespace is registered with the platform registry by `platform/settings/registry.ts` (`app-registrations/settings.ts`); the local registry is deleted. | settings, `common/schemas`, `common/types` | #44, #48 (done) |
| App permission declarations | `servers:read\|write\|delete` and `sessions:read\|write\|delete` live in the base `roles.constants.ts` and `prisma/seed.ts`. They move to `app-registrations/permissions.ts` (`APP_PERMISSIONS`) and become platform `PermissionDeclaration`s with the same defaults (admin and contributor all six, viewer the two read permissions). Resolved by #44: `roles.constants.ts` and `prisma/seed.ts` derive from `APP_PERMISSIONS`. | `common/constants`, `prisma/seed.ts` | #44, then #47 |
| Terminal web extraction | `KeyShortcutsSettings`, `KeystrokeEditor` and the terminal API calls leave base web files (`components/settings`, `services/api.ts`, `types/index.ts`, `Sidebar`/`HomePage` destinations) for `components/terminal/settings/`, `services/terminal-api.ts` and `config/destinations.ts`. Resolved by #44 (web): terminal types are in `types/terminal.ts` (the `terminal` user-settings namespace augments `UserSettingsNamespaces`), the settings panel is mounted through `config/userSettingsPanels.tsx`, and `src/__tests__/architecture/base-domain-boundary.test.ts` guards the base files. | `components/settings`, `services`, `types` | #44, then #76, #80 |
| ShellKeep storage key prefixes | The platform owns `uploads/`, where every existing object lives. ShellKeep adds `session-logs/` and `runbook-artifacts/` through `registerStorageKeyPrefixes`; the S3 environment variables are removed (storage is runtime-configured). | storage | #50 |
| SSH credential re-encryption | `ServerProfile` secrets are encrypted with `ENCRYPTION_KEY` by `encryption.util.ts`; they are re-encrypted with the credentials slice's `SECRETS_ENCRYPTION_KEY` and the three `encrypted*` columns are retired. Resolved by #48: `encryption.util.ts` is deleted, `server-profiles/migrate/` holds the frozen cipher and the `ssh:migrate-secrets` command, the columns stay (unread) until #84 ([runbook](../runbooks/ssh-secret-reencryption.md)). | `common/utils` | #48 (done), #84 (drop the columns) |
| Terminal WebSocket authorization | The gateway verifies the JWT and `isActive` but checks no permission. A `TerminalPrincipalResolver` over the identity slice enforces `sessions:write` and the token expiry. Resolved by #47 (the resolver is a `PLATFORM-ADOPTION-SHIM`; a seam request to the platform is pending). | `terminal` | #47 |

## Classification

### API (`apps/api/src`)

The **Drift** column uses the slice view where the module has a packaged slice and the apps view otherwise (`n/a` when the base has no file at that path). `common` is an umbrella row; its files are classified in the `common/…` rows below it.

| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `apps/api/src/auth` | 5.6% / +322 −1345 | 29 | noise | identity slice | #47 | deleted by #47 |
| `apps/api/src/users` | 12.5% / +43 −248 | 12 | noise | identity slice | #47 | deleted by #47 |
| `apps/api/src/allowlist` | 28.6% / +12 −84 | 9 | noise | identity slice | #47 | deleted by #47 |
| `apps/api/src/device-auth` | 11.8% / +184 −869 | 18 | noise | identity slice | #47 | deleted by #47 |
| `apps/api/src/test-auth` | 9.1% / +63 −152 | 7 | noise | identity slice (`identity/testing`) | #47 | deleted by #47 |
| `apps/api/src/health` | 0% / +23 −58 | 5 | noise | host slice (`host/health`) | #46 | deleted by #46 (`/api/health`, `/live` and `/ready` are the host core's, same paths and bodies) |
| `apps/api/src/settings` | 0% / +250 −685 | 15 | backport | settings slice | #48 | deleted by #48 (the platform settings slice is bound in `platform/settings/`; the `terminal` user and system namespaces are `terminal/settings/`) |
| `apps/api/src/common` | 0% / +27 −164 | 23 | mixed (see sub-rows) | split across host, core, settings, credentials, identity and otel-core | #44, #46, #47, #48, #53 | see the `common/` rows |
| `apps/api/src/storage` | 1.1% / +367 −1060 | 29 | noise | storage slice | #50 | deleted by #50 (the platform storage slice is bound in `platform/storage/`; `session-logs/` and `runbook-artifacts/` are registered with `registerStorageKeyPrefixes` in `app-registrations/storage-prefixes.ts`; the S3 environment variables are removed and `npm run storage:import-env` carries them over once) |
| `apps/api/src/config` | 0% / +29 −42 | 1 | noise | host core (config and `buildCorsOptions`) | #46 | Env-derived `DATABASE_URL` and the S3 and trace-UI variables disappear with #50 and #53 |
| `apps/api/src/openapi` | n/a / +0 −0 | 2 | noise | host slice (`createOpenApiDocument`, `registerPlatformDocs`) | #46 | keep (ShellKeep's identity for the document, `APP_OPENAPI`, and `resolveApiVersion`; the tag taxonomy is `app-registrations/openapi-tags.ts`) |
| `apps/api/src/prisma` | 0% / +3 −37 | 2 | noise | platform-db and core data-access (`PrismaService`) | #45 | none |
| `apps/api/src/server-profiles` | n/a / +0 −0 | 9 | domain | keep (host-key scan, trust and forget routes and the facts routes, #60) | #60 | none |
| `apps/api/src/ssh` | n/a / +0 −0 | 16 | domain | keep: the one SSH connection factory (host keys verified before any credential), the host-key trust policy, the server facts probe, the `ssh` system namespace, the `app.ssh.host_key_checks` metric and the `ssh.host_key_policy` Doctor check | #60 | none |
| `apps/api/src/runbooks` | n/a / +0 −0 | 24 | domain | keep: versioned runbook definitions (`runbook-definition.schema.ts`, RE2-validated), `/api/runbooks` and `/api/runbook-secrets` (org credential purpose `runbook_secret`), the target resolver, the tighten-only `runbooks` system namespace and the `app.runbooks.definitions_saved` metric | #61 | none |
| `apps/api/src/command-safety` | n/a / +0 −0 | 0 | domain | keep: pure terminal-text safety (`redactText`, `stripAnsi`, `classifyCommand` over the data table `destructive-patterns.ts`); no Nest, no I/O; the runbook engine (#62) and approvals (#67) reuse it | #56 | none |
| `apps/api/src/terminal-ai` | n/a / +0 −0 | 0 | domain | keep: `TerminalContextService` (the only door from a terminal to an AI feature: consent, per-server switch, strip, redact, cap, audit), `POST/GET /api/ai/terminal/consent`, `POST /api/ai/terminal/assist` (#57), `POST /api/ai/terminal/explain` and `/explain/preview` (#58), the session summaries (#59: `ai.session.summarize` and its three routes), the `terminalAi` settings namespaces, the `AI_CONSENT_REQUIRED` and `AI_OUTPUT_SHARING_DISABLED` error codes and the `app.terminal_ai.redactions` metric | #56 | none |
| `apps/api/src/dashboard` | n/a / +0 −0 | 6 | domain | keep: `GET /api/dashboard/summary` (the Home page's one bounded read over what the caller may see; `runs` comes from the `DASHBOARD_RUNS_SOURCE` port, bound by `RunbooksModule` to `runbooks/engine/runs-dashboard.source.ts`) | #78 | none |
| `apps/api/src/onboarding` | n/a / +0 −0 | 3 | domain | keep: ShellKeep's onboarding manifest (`onboarding.manifest.ts` registers the platform's facts and steps, then the app's from `app-registrations/onboarding.ts`), the permanent step and fact ids (`onboarding.ids.ts`) and the `shellkeep.add-ai-key` step over `user_ai_keys`; the other facts and steps sit beside their domain (`server-profiles/`, `terminal/`, `runbooks/*.onboarding.ts`); the slice itself is `@marinoscar/platform-api/onboarding`, bound in `platform/onboarding/` | #70 | none |
| `apps/api/src/terminal` | n/a / +0 −0 | 17 | domain | keep (its `tasks/session-cleanup` `@Cron` is an enqueue-only cron and the work is the `terminal.session.reap` job, done in #49) | #49 (cron), #47 (WebSocket auth) | none |
| `apps/api/src/app-registrations` | n/a / +0 −0 | 6 | domain | keep (composition root with `shellkeep.manifest.ts`: `APP_PERMISSIONS`, the user-owned model and ownership classifications `registrations.ts` with the platform manifest registrations (#47), `settings.ts` (the terminal and `ui`/`features` namespaces) and `credentials.ts` (the `ssh` purpose) (#48), `notifications.ts` (the channel, template and event manifest, #51), `telemetry.ts` (the app metrics and the "Terminal" metric group, #53)) | #44, #47, #48 | none |
| `apps/api/src/email-templates` | n/a / +0 −0 | 5 | domain | keep (ShellKeep's own email templates: `terminal-session-reaped` and the three runbook templates, registered with the email slice's template registry; added by #51) | #51 | none |
| `apps/api/src/notifications-registry` | n/a / +0 −0 | 3 | domain | keep (the identity, terminal and runbook event registrations for the notifications slice; added by #51) | #51 | none |
| `apps/api/src/platform` | n/a / +0 −0 | 10 | domain | keep (bindings of the packaged slices: `platform-host.module.ts`, `doctor.config.ts` and `identity/` from #47, `settings/` and `credentials/` from #48, `email/` and `notifications/` from #51, `telemetry/` from #53, `sharing/` from #71, `exports/` from #68, `host-core.config.ts`, `host-app-metrics.ts` and `about/` from #46; one folder per slice as each is adopted) | #47 | Interim host-port adapters are `PLATFORM-ADOPTION-SHIM`s listed in `local-exceptions.md` |
| `apps/api/src/common/filters` | 0% / +17 −100 | 2 | noise | host/core (`http-exception.filter`) | #46 | deleted by #46 (a 400 now also carries `details.issues`, see `local-exceptions.md`) |
| `apps/api/src/common/interceptors` | 0% / +7 −61 | 4 | noise | host (`logging.interceptor`, `transform.interceptor`) | #46 | deleted by #46 (no `304` path exists in ShellKeep, so no shim was needed) |
| `apps/api/src/common/middleware` | 0% / +3 −3 | 2 | noise | host (`request-id.middleware`) | #46 | deleted by #46 |
| `apps/api/src/common/logger` | n/a / +0 −0 | 4 | noise | host core (Pino logging) | #46 | kept by #46: the host core has no Pino equivalent (it owns the request log line, not the logger), and the Fastify logger is Pino already; nothing injects `LoggerService`, so it is dead code to delete with the telemetry adoption (#53) |
| `apps/api/src/common/schemas` | 0% / +39 −140 | 2 | backport | settings slice | #48 | deleted by #48 (the terminal part moved to the terminal namespace by #44) |
| `apps/api/src/common/types` | 0% / +95 −4 | 1 | backport | settings slice | #48 | `settings.types.ts` deleted by #48 (`KeyShortcut`, `DEFAULT_KEY_SHORTCUTS` moved to the terminal namespace by #44); `owner-scope.ts` stays |
| `apps/api/src/common/utils` | n/a / +0 −0 | 2 | noise | credentials slice (`encryption.util.ts`, AES-256-GCM) | #48 | deleted by #48 (SSH credentials are re-encrypted from `ENCRYPTION_KEY` to `SECRETS_ENCRYPTION_KEY`; the frozen cipher copy is `server-profiles/migrate/legacy-cipher.ts`) |
| `apps/api/src/common/services` | n/a / +0 −0 | 2 | noise | identity slice (`admin-bootstrap.service.ts`) | #47 | deleted by #47 |
| `apps/api/src/common/decorators` | 0% / +0 −0 | 1 | noise | otel-core (`@Trace()`) | #53 | none |
| `apps/api/src/common/constants` | 0% / +28 −16 | 1 | backport | identity slice (roles and permissions) | #44, #47 | `servers:*` and `sessions:*` permissions moved to `app-registrations/permissions.ts` (`APP_PERMISSIONS`, resolved by #44), then to platform `PermissionDeclaration` (resolved by #47: org scoped, org_admin and contributor write, viewer reads; `ROLES` and `PERMISSIONS` are derived from the platform declarations); defaults keep admin and contributor with all six, viewer with the two read permissions |
| `apps/api/src/common/exceptions` | n/a / +0 −0 | 1 | noise | core errors (`database-seed.exception.ts`) | #46 | kept by #46: no host or core equivalent exists, and nothing references it; deleted with the seed review in #84 |
| `apps/api/src/common/common.module.ts` | 0% / +3 −3 | 1 | noise | host core | #46 | deleted by #48 (its only provider froze the local registry primitive, deleted with the settings module) |

### API top-level files and the four base `@Cron` tasks

The four tasks are covered by their module rows above; they are listed so the slice that owns each one is explicit. `apps/api/src/terminal/tasks/session-cleanup.task.ts` is domain code handled by #49.

| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `apps/api/src/instrumentation.ts` | 0% / +64 −7 | 1 | noise | otel-core and telemetry slice | #53 | none |
| `apps/api/src/app.module.ts` | 0% / +45 −59 | 1 | shellkeep-divergence | app composition root, rebuilt on `forRoot` bindings by each slice issue | #46–#54 | none |
| `apps/api/src/main.ts` | 0% / +27 −41 | 1 | shellkeep-divergence | app composition root (`shellkeep.manifest.ts` is imported first, #44) | #44, #46 | none |
| `apps/api/src/auth/tasks/token-cleanup.task.ts` | 0% / +7 −12 | 1 | noise | identity slice (`@Cron`, owned by the slice) | #47 | deleted by #47 |
| `apps/api/src/device-auth/tasks/device-code-cleanup.task.ts` | 0% / +11 −12 | 1 | noise | identity slice (`@Cron`, owned by the slice) | #47 | deleted by #47 |
| `apps/api/src/storage/tasks/storage-cleanup.task.ts` | 0% / +57 −13 | 1 | noise | storage slice (`@Cron`, owned by the slice) | #50 | deleted by #50 |
| `apps/api/src/storage/tasks/storage-expiry.task.ts` | n/a / +0 −0 | 1 | noise | storage slice (`@Cron`, owned by the slice) | #50 | deleted by #50 |

### Web (`apps/web/src`)

Drift comes from the apps view.

| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `apps/web/src/__tests__` | 4% / +1484 −2889 | 68 | mixed | tests follow their module: delete with the module they cover, keep for domain code | per module | none |
| `apps/web/src/components` | 22.2% / +216 −65 | 40 | mixed (see `components/…` rows) | see below | — | see below |
| `apps/web/src/contexts` | 0% / +56 −8 | 1 | noise | `AuthContext` deleted by #47 (identity web `AuthProvider`); `ThemeContext` to shell theme (#76) | #47, #76 | `AuthContext.tsx` deleted by #47; `ThemeContext.tsx` deleted by #76 (the shell's `ShellRoot`, same `theme_mode` storage key; folder gone) |
| `apps/web/src/hooks` | 11.1% / +173 −20 | 11 | mixed (see `hooks/…` rows) | see below | — | see below |
| `apps/web/src/config` | n/a / +0 −0 | 2 | shellkeep-divergence | app composition root: `destinations.ts` (consumed by `Sidebar`, maps onto `ShellNavigation`), `userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`, the registry the packaged `SettingsHub` draws at `/settings`: packaged Profile and Appearance, the terminal domain's Terminal card), `adminSections.tsx` (`ADMIN_SECTIONS`, drawn at `/admin/settings` since #46: About, Maintenance, the terminal domain's Terminal card, the packaged Storage page (#50), the identity slice's Users & Allowlist, the packaged Doctor, the jobs slice's Operations cards (#49), the packaged Email and Web Push pages and the Broadcasts card (#51)) and, per user, the packaged Notifications preferences (#51); #80 redesigns the Terminal card | #44, #46, #48, #49, #50, #51, #76, #80 | `userSettingsPanels.tsx` deleted by #48; `shell.ts` (`SHELLKEEP_NAVIGATION`) added and `destinations.ts` rewritten onto `ShellDestination` by #76 (Console replaces User Management; the admin hub is titled Console) |
| `apps/web/src/features` | n/a / +0 −0 | 1 | domain | keep: `features/runbooks/` is the runbooks domain's web slice (#65): `api/` (wire types imported from the #61 schema and #62 events, the HTTP calls, the fetch-based run stream with `Last-Event-ID` resume), `hooks/` (the live run, the shared approvals count), `lib/` (status and step-kind display, the log buffer, run patching, the builder model, the JSON diff) and `components/` (target picker, launcher, matrix, card list, log drawer, approvals card, builder parts) | #65 | none |
| `apps/web/src/identity` | n/a / +0 −0 | 3 | shellkeep-divergence | identity web bindings (#47): `IdentityProviders` (packaged `AuthProvider` on the app client, `IdentityWebAdaptersProvider`), `identityAdapters.ts`, `LoginPage` (packaged page with the ShellKeep `Logo` slot) | #47 | none |
| `apps/web/src/platform` | n/a / +0 −0 | 1 | shellkeep-divergence | platform host binding (#48): `platformHost.tsx` mounts the packaged `PlatformHostProvider` (the app client unchanged, the viewer, `applyTheme` to the theme context); `notifications.ts` configures the notifications web slice (`configureNotificationsWeb` over the app client and core's `connectSse`, #51) | #48, #50, #51, #76 | none (`shellTheme.ts`, the ShellKeep palette over `createShellTheme`, added by #76; `applyTheme` calls the shell theme's `setMode`) |
| `apps/web/src/lib` | n/a / +0 −0 | 3 | domain | keep (`lib/terminal`; `settings.ts` holds the terminal namespace defaults since #48, `system-settings.ts` the `terminal` system namespace's bounds and defaults since #46) | — | none |
| `apps/web/src/pages` | 0% / +35 −12 | 12 | mixed (see page rows) | see below | — | see below |
| `apps/web/src/services` | 0% / +353 −23 | 4 | mixed (see `services/…` rows) | see below | — | see below |
| `apps/web/src/theme` | 0% / +76 −17 | 4 | noise | shell theme (`createShellTheme`, `ShellThemeProvider`) | #76 | deleted by #76 (the ShellKeep palette moved to `platform/shellTheme.ts` over `createShellTheme`; typography, shape and component overrides are the shell's; folder gone) |
| `apps/web/src/types` | 0% / +162 −71 | 1 | backport | web types: base types to the packages, terminal types to the domain | #44, #76 | Terminal types moved to `types/terminal.ts`; `types/index.ts` re-exports them for existing imports (resolved by #44) |
| `apps/web/src/utils` | 50% / +0 −0 | 2 | domain | keep (`dispatchXtermScroll.ts`) | — | none |

### Web files that are classified one by one

`hooks`, `pages` and `services` mix base and domain files, so the umbrella rows above point here. `pages` holds no sub-directories.

| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `apps/web/src/App.tsx` | 0% / +23 −644 | 1 | shellkeep-divergence | app routing, rebuilt on the shell and registries | #76 | rebuilt by #76: `ShellRoot`, `ShellProviders` around `Layout`, the destination and registry routes |
| `apps/web/src/main.tsx` | 0% / +0 −10 | 1 | shellkeep-divergence | app entry (providers) | #42, #76 | #76: the stray `CssBaseline` removed (`ShellRoot` mounts it) |
| `apps/web/src/hooks/useSystemSettings.ts` | 0% / +89 −7 | 1 | noise | settings web hooks (`useSystemSettings`) | #48 | deleted by #48 |
| `apps/web/src/hooks/useUserSettings.ts` | 0% / +84 −13 | 1 | noise | settings web hooks (`useUserSettings`) | #48 | deleted by #48 (the terminal pages read `useTerminalSettings`) |
| `apps/web/src/hooks/useTerminalSettings.ts` | n/a / +0 −0 | 1 | domain | keep: the terminal namespace on the packaged `useUserSettings`, defaults applied (#48) | #48 | none |
| `apps/web/src/hooks/useUsers.ts` | n/a / +0 −0 | 1 | noise | identity web hooks | #47 | deleted by #47 |
| `apps/web/src/hooks/useAllowlist.ts` | n/a / +0 −0 | 1 | noise | identity web hooks | #47 | deleted by #47 |
| `apps/web/src/hooks/usePermissions.ts` | n/a / +0 −0 | 1 | noise | identity web hooks | #47 | deleted by #47 |
| `apps/web/src/hooks/useTerminal.ts` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/hooks/useTouchScroll.ts` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/hooks/useKeyboardInset.ts` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/hooks/useSessions.ts` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/hooks/useServerProfiles.ts` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/services/api.ts` | 0% / +353 −23 | 1 | backport | core web client (`createPlatformApiClient`); terminal calls moved to `services/terminal-api.ts`; `onErrorResponse` records a maintenance 503 in the host slice's block store for the packaged `MaintenanceGate` (#46); the forked storage calls moved to `services/storage.ts` on the packaged objects client (#50) | #44, #46, #50, #76 | Terminal API calls extracted to `services/terminal-api.ts` (resolved by #44) |
| `apps/web/src/services/storage.ts` | n/a / +0 −0 | 1 | shellkeep-divergence | the packaged objects client (`createStorageObjectsClient` of `@marinoscar/platform-web/storage/headless`) over the app client, plus the terminal's paste-an-image flow and its error messages; replaces the forked `uploadFile`/`getDownloadUrl` of `services/api.ts` | #50 | none |
| `apps/web/src/services/terminal-api.ts` | n/a / +0 −0 | 1 | domain | keep (server-profile and session calls on the base client) | #44 | none |
| `apps/web/src/services/terminal-ws.ts` | n/a / +0 −0 | 1 | domain | keep (re-sends `auth` after token refresh, #47; a `maintenance` refusal stops the socket with no reconnect loop and shows a banner with Retry, #46) | #46, #47 | none |
| `apps/web/src/pages/UserManagementPage.tsx` | n/a / +0 −0 | 1 | noise | identity web (`UsersPage`) | #47 | deleted by #47 |
| `apps/web/src/pages/SystemSettingsPage.tsx` | n/a / +0 −0 | 1 | noise | orphan: no route renders it; delete | #76 | deleted by #48 (its hook and editors were replaced, so it no longer compiled) |
| `apps/web/src/pages/UserSettingsPage.tsx` | n/a / +0 −0 | 1 | noise | settings web (`SettingsHub`, `UserProfilePage`, `UserAppearancePage`) | #48, #80 | deleted by #48 |
| `apps/web/src/pages/runbooks` | n/a / +0 −0 | 7 | domain | keep: the Runbooks and Runs destinations' pages (#65): the list, the builder, a runbook's page with Share, the launcher deep links, the approvals inbox, the runs list and the live run view | #65 | none |
| `apps/web/src/pages/UserSettingsHubPage.tsx` | n/a / +0 −0 | 1 | shellkeep-divergence | binding of the packaged `SettingsHub` over `USER_SETTINGS_SECTIONS` (#48) | #48 | none |
| `apps/web/src/pages/AdminSettingsHubPage.tsx` | n/a / +0 −0 | 1 | shellkeep-divergence | binding of the packaged `SettingsHub` over `ADMIN_SECTIONS` (#46); the About, Maintenance and Doctor pages are the packaged ones, routed straight from `App.tsx` | #46 | none |
| `apps/web/src/pages/LoginPage.tsx` | n/a / +0 −0 | 1 | noise | identity web (`LoginPage`) | #47 | deleted by #47 |
| `apps/web/src/pages/AuthCallbackPage.tsx` | n/a / +0 −0 | 1 | noise | identity web | #47 | deleted by #47 |
| `apps/web/src/pages/ActivateDevicePage.tsx` | n/a / +0 −0 | 1 | noise | identity web (device activation) | #47 | deleted by #47 |
| `apps/web/src/pages/TestLoginPage.tsx` | 0% / +2 −2 | 1 | noise | identity web (testing) | #47 | kept by #47: the platform ships the test login endpoint (`identity/testing`) but no web page; the form posts to `POST /api/auth/test/login` and stays out of production builds |
| `apps/web/src/pages/HomePage.tsx` | 0% / +33 −10 | 1 | domain | keep (dashboard, redone in #78) | #78 | none |
| `apps/web/src/pages/ServerProfilesPage.tsx` | n/a / +0 −0 | 1 | domain | keep (redone in #79) | #79 | none |
| `apps/web/src/pages/SessionsPage.tsx` | n/a / +0 −0 | 1 | domain | keep | — | none |
| `apps/web/src/pages/TerminalPage.tsx` | n/a / +0 −0 | 1 | domain | keep (workspace redone in #77) | #77 | deleted by #77: `/sessions/:id` is `TerminalWorkspacePage.tsx` (tabs, splits, the session switcher, the status bar, the AI panel shell); its toolbar actions live in `components/terminal/useTerminalActions.ts` |
| `apps/web/src/pages/TerminalFullPage.tsx` | n/a / +0 −0 | 1 | domain | keep (workspace redone in #77) | #77 | deleted by #76 (`/terminal/:id` redirects to `/sessions/:id`, the full-bleed `TerminalPage` inside the shell) |
| `apps/web/src/components/PWAUpdatePrompt.tsx` | n/a / +0 −0 | 1 | noise | host web (`UpdatePrompt`) | #46 | deleted by #46 (the packaged `UpdatePrompt`, which also registers the service worker, and `InstallPrompt` are mounted in `App.tsx`) |

### Web components (`apps/web/src/components`)



| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `apps/web/src/components/navigation` | 0% / +175 −26 | 3 | noise | shell (`ShellAppBar`, `ShellNavigationRail`, `ShellUserMenu`); `Sidebar` destinations come from `config/destinations.ts` (resolved by #44) | #76 | `AppBar.tsx`, `Sidebar.tsx`, `UserMenu.tsx` deleted by #76 (the packaged `ShellAppBar`, `ShellNavigationRail`, `ShellBottomNav`, `ShellUserMenu`; the bell, user menu and banners are slots of `components/common/Layout.tsx`; folder gone) |
| `apps/web/src/components/common` | 66.7% / +36 −34 | 6 | noise | shell and identity guards (`Layout.tsx` to `ShellLayout`; `ProtectedRoute`, `RequirePermission`, `AdminOnly` to identity web; `ErrorBoundary`, `LoadingSpinner` to the host; `Layout.tsx` mounts the host slice's `MaintenanceBanner` since #46) | #76, #47 | `ProtectedRoute`, `RequirePermission`, `AdminOnly` deleted by #47; `Layout.tsx` rewritten by #76 as a thin `ShellLayout` binding that reads no breakpoint |
| `apps/web/src/components/admin` | n/a / +0 −0 | 6 | noise | identity web (`AddEmailDialog`, `AllowlistTable`, `UserList`); `FeatureFlagsList`, `SystemSettingsEditor`, `UISettings` to settings web | #47, #48 | `AddEmailDialog`, `AllowlistTable`, `UserList` deleted by #47 (identity web `UsersPage`); `FeatureFlagsList`, `SystemSettingsEditor`, `UISettings` deleted by #48 (folder gone) |
| `apps/web/src/components/auth` | n/a / +0 −0 | 1 | noise | identity web (`OAuthButton`) | #47 | deleted by #47 |
| `apps/web/src/components/device-activation` | n/a / +0 −0 | 3 | noise | identity web | #47 | deleted by #47 |
| `apps/web/src/components/user` | 0% / +5 −5 | 1 | noise | identity web (`UserProfileCard`) | #47 | `UserProfileCard.tsx` deleted by #76 (only its test imported it; folder gone) |
| `apps/web/src/components/settings` | n/a / +0 −0 | 3 | backport | settings web (`ImageUpload`, `ProfileSettings`, `ThemeSettings`); `KeyShortcutsSettings` and `KeystrokeEditor` are terminal domain | #48, #80 | `KeyShortcutsSettings` and `KeystrokeEditor` moved to `components/terminal/settings/` (resolved by #44); `ImageUpload`, `ProfileSettings`, `ThemeSettings` deleted by #48 (packaged `UserProfilePage`, `UserAppearancePage`; folder gone); the "Terminal" card (`TerminalSettingsPage`) since #48, redesigned in #80 |
| `apps/web/src/components/terminal` | n/a / +0 −0 | 10 | domain | keep (`settings/` holds `KeyShortcutsSettings` and `KeystrokeEditor` since #44, and the admin `TerminalSystemSettingsPage` for the `terminal` system namespace since #46) | — | none |
| `apps/web/src/components/server-profiles` | n/a / +0 −0 | 2 | domain | keep | — | none |
| `apps/web/src/components/home` | 0% / +0 −0 | 5 | domain | keep (redone in #78: `FleetHealthTiles`, `ActiveSessionsPanel` on the summary, `RecentRunsPanel`, `QuickConnectPanel`; `SessionStatsBar` and `RecentActivityPanel` removed) | #78 | none |
| `apps/web/src/components/onboarding` | n/a / +0 −0 | 2 | domain | keep: ShellKeep's required-steps banner (`OnboardingBanner`) and welcome-dialog panes (`welcomePanes.tsx`) over `@marinoscar/platform-web/onboarding`; the provider, the dialog, the menu row and the Getting started and Setup guide pages are the platform's | #70 | none |

### Infrastructure (`infra`)



| Module | Drift | Files | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| `infra/compose` | 6.7% / +45 −100 | 6 | noise | platform-infra generated compose, plus app-owned `app.*.compose.yml` overlays | #73 | Done in #73: generated files committed; `otel.compose.yml` was replaced by the telemetry fragment (#53); no app overlay (see local-exceptions) |
| `infra/nginx` | 0% / +12 −70 | 2 | noise | platform-infra generated `nginx.conf`, plus app-owned `app.d/` (WebSocket location for `/api/terminal/ws`) | #73 | Done in #73: `nginx.dev.conf` deleted (the dev CSP is `csp.dev.conf`); WebSocket, SSE and upload locations live in `nginx/app.d/locations/` |
| `infra/otel` | 0% / +16 −182 | 2 | noise | telemetry slice (replaces the former trace UI stack) | #53 | none |
| `infra/deploy` | n/a / +0 −0 | 3 | shellkeep-divergence | CLI `deploy` command on `createCli` (`install-shellkeep.sh`, `update.sh`, `DEPLOY.md`) | #72 | Done in #72: the directory is deleted; `shellkeep deploy` (`apps/cli`) replaces it and its operator prose is in `apps/cli/README.md` |

## Prisma

Source: `drift-baseline.json` (`prismaModels`, `migrations`). Platform schema: 53 models; ShellKeep: 16.

### Models

| Group | Models | Drift against the platform | Category | Target | Issue | Workaround |
|---|---|---|---|---|---|---|
| Base, identical | `AllowedEmail`, `RolePermission`, `SystemSettings`, `UserIdentity`, `UserRole`, `UserSettings` | none | noise | identity and settings fragments | #45 | none |
| Base, platform has more fields | `AuditEvent`, `DeviceCode`, `Permission`, `RefreshToken`, `Role`, `StorageObject`, `StorageObjectChunk` | the platform adds `orgId`/`org` (org tables under row-level security), `Permission.scope`, `Role.scope`, `DeviceCode` PAT and revoke fields; ShellKeep removes none | noise | platform-db fragments | #45, #47, #50 | `org_id` backfilled to the default organization in the #45 baseline migration |
| Base with domain back-relations | `User` | `serverProfiles` and `terminalSessions` added by ShellKeep; the platform adds about 35 relations | backport | platform-db fragments plus an `extend model User` block | #45 | back-relations declared as an `extend model` block in the app fragment, never an edit to a platform file |
| Domain | `ServerProfile`, `TerminalSession` (and enum `SessionStatus`, `AuthMethod`) | app-only | domain | app fragment `apps/api/prisma/fragments/` | #45 | none |
| Base, not yet present | the 39 platform models ShellKeep lacks (jobs, nodes, notifications, credentials, AI, webhooks, alerts, sharing, organizations, memberships and others) | missing from ShellKeep | noise | arrive with the owning slice issue | #45 to #55 | none |

The 14 base models are the 14 of EAB `0001_initial`. `DeviceCode` and `StorageObject` also have enums (`DeviceCodeStatus`, `StorageObjectStatus`) that stay with their models.

### Migrations

| Migration | Drift | Category | Target | Issue | Note |
|---|---|---|---|---|---|
| `20260124223146_initial` | identical (byte for byte) to platform `0001_initial` | noise | `@marinoscar/platform-db` migration `0001_initial` | #45 | Recorded in the `platform.lock` baseline; never edited |
| `20260322203853_add_server_profile_color` | app-only (`ALTER TABLE "server_profiles" ADD COLUMN "color"`) | domain | domain migration set | #45 | No migration created `server_profiles` or `terminal_sessions` (they came from `prisma db push`). #45 added `20260124223147_add_terminal_domain`, which sorts before this migration; on an existing database it is only marked applied (`migrate resolve --applied`) |
| `apps/api/prisma/seed.ts` | modified (+167 −15) | backport | platform seed plus an app seed | #45, #47 | The added content is the `servers:*`/`sessions:*` permissions and their role grants; they now come from `APP_PERMISSIONS` (resolved by #44, see the workaround table); #47 replaced the file with `seedPlatform` over the generated `prisma/catalog/` snapshots plus an empty `prisma/seed-app.ts` |
| `apps/api/prisma/tsconfig.json` | modified (+5 −15) | noise | platform-db tooling | #45 | none |

## Not classified here

- `apps/api/test` (specs for the modules above) follows its module and is handled in the same issue as the module.
- `apps/cli`, `apps/stack-agent`, `apps/android`, `packages` and `scripts` have no ShellKeep side at this commit (reported base-only); #72, #73 and #74 introduce them. `.github` is handled by the CI issues (#43).

## Status after adoption

Measured by #83 against EnterpriseAppBase `ad57217a3c5fb9c1d87e600e1ea6cca05d49db6a` and ShellKeep `a0acaae2645769a899feed6c22431ffb4b64d5f7` (2026-11-24): [drift-after.md](drift-after.md) (apps view) and [drift-after-slices.md](drift-after-slices.md) (slice view), same commands as above. The baseline files are untouched. Statuses: **adopted** (the packaged slice replaced it and the directory or file is gone), **bound** (a thin ShellKeep binding of a slice, kept), **kept (domain)**, **exception** (a row in [local-exceptions.md](local-exceptions.md)). PR numbers are the squash-merge PRs.

Slice view, API: no ShellKeep base module is left. `auth`, `users`, `allowlist`, `device-auth`, `test-auth`, `health`, `settings` and `storage` are gone (0 modified files); what remains under `apps/api/src` is bindings (`platform`, `app-registrations`, `prisma`, `config`, `openapi`, `common`) and domain (`terminal`, `terminal-ai`, `server-profiles`, `ssh`, `runbooks`, `command-safety`, `dashboard`, `onboarding`, `email-templates`, `notifications-registry`).

| Rows | Status | Issue | PR |
|---|---|---|---|
| `auth`, `users`, `allowlist`, `device-auth`, `test-auth`, the four identity cron tasks, `common/services`, web `contexts`, `components/{auth,admin,device-activation,user}`, the identity pages, `hooks/{useUsers,useAllowlist,usePermissions}` | adopted | #47 | #92 |
| `health`, `common/{filters,interceptors,middleware,logger,common.module.ts}`, `PWAUpdatePrompt` | adopted | #46 | #97 |
| `settings`, `common/{schemas,utils}`, `hooks/{useSystemSettings,useUserSettings}`, `components/settings`, `UserSettingsPage` | adopted | #48, #80 | #96, #109 |
| `storage` and its two cron tasks | adopted | #50 | #99 |
| `common/decorators`, `instrumentation.ts` (bootstrap is the platform's, the file hands it the identity), `infra/otel` | adopted (instrumentation: bound) | #53 | #103 |
| `config`, `openapi`, `prisma`, `common/types`, `common/constants`, `app.module.ts`, `main.ts`, `app-registrations`, `platform`, `web/platform`, `web/identity`, `web/config`, `TestLoginPage`, `components/common` | bound | #44 to #54, #76 | #91 to #106, #104 |
| `common/exceptions` | exception (dead code, deleted by #84; see "The host core (#46)") | #46 | #97 |
| web `theme`, `components/navigation`, `SystemSettingsPage`, `TerminalPage`, `TerminalFullPage`, `infra/deploy` (replaced by the `shellkeep` CLI) | adopted | #76, #77, #72 | #104, #107, #114 |
| `infra/compose`, `infra/nginx` (generated; ShellKeep overlays are app-owned) | adopted | #73 | #111 |
| baseline migrations `20260124223146_initial`, `20260322203853_add_server_profile_color` | adopted (platform baseline plus the `shellkeep:domain-schema` deviation) | #45 | #90 |
| `server-profiles`, `ssh`, `runbooks`, `command-safety`, `terminal-ai`, `terminal`, `dashboard`, `onboarding`, `email-templates`, `notifications-registry`, web `features`, `lib`, `utils`, `components/{terminal,server-profiles,home,onboarding}`, `pages/{runbooks,HomePage,ServerProfilesPage,SessionsPage}`, `hooks/use{Terminal,TouchScroll,KeyboardInset,Sessions,ServerProfiles}` | kept (domain) | #56, #60 to #65, #70, #78, #79 | #101, #105, #110, #118, #127, #131 |

Standing exceptions are the rows of [local-exceptions.md](local-exceptions.md); `npm run check:shims` keeps its shim rows and the code markers in step. Resolved in #83: the web-host storage status shim and `DefaultOrgResolver` (both gone since #50); the telemetry AI adapter is the real platform binding since #55 and the copied telemetry overlay is gone since #73, so neither has a row.
