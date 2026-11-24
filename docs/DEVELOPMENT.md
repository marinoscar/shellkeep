# Development Guide

> **Audience:** developers · Rules for contributions and AI assistants: [AGENTS.md](../AGENTS.md) · Design: [ARCHITECTURE.md](ARCHITECTURE.md)

## Contents

1. [Prerequisites and setup](#1-prerequisites-and-setup)
2. [Daily loop](#2-daily-loop)
3. [Generated files](#3-generated-files)
4. [Database changes](#4-database-changes)
5. [Adding things](#5-adding-things)
6. [NestJS and Fastify notes](#6-nestjs-and-fastify-notes)
7. [Debugging](#7-debugging)
8. [The CLI](#8-the-cli)
9. [Checks CI runs](#9-checks-ci-runs)

## 1. Prerequisites and setup

- Node.js 24 (`engines` in `package.json`), npm workspaces (`apps/*`, `packages/*`), Docker with Compose, a Google OAuth client (ID and secret, callback URL `http://localhost:8323/api/auth/google/callback`).
- An external PostgreSQL 16 reachable on the `devnet` Docker network, or the `devdb` overlay for a local one. The API must connect as an ordinary role (not a superuser), because row-level security is inert for a superuser ([runbooks/application-role.md](runbooks/application-role.md)); the `devdb` overlay creates it.

```bash
npm install                                   # repository root, all workspaces
cp infra/compose/.env.example infra/compose/.env
# set at least: POSTGRES_*, JWT_SECRET (32+ chars), SECRETS_ENCRYPTION_KEY (openssl rand -base64 32),
#   GOOGLE_CLIENT_ID/SECRET, INITIAL_ADMIN_EMAIL, APP_URL=http://localhost:8323,
#   GOOGLE_CALLBACK_URL=http://localhost:8323/api/auth/google/callback
docker network create devnet                  # once per host
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up
# in another shell, migrate and seed with the same -f files (the API does not migrate on startup):
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:migrate
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:seed
```

App: http://localhost:8323 (the platform default 3535 is not used). API reference: http://localhost:8323/api/docs. Add `-f telemetry.compose.yml` for the collector and GreptimeDB (explorer under `/admin/settings/telemetry`). The first sign-in as `INITIAL_ADMIN_EMAIL` bypasses the allowlist and becomes the administrator; add other people on the Users page (Allowlist tab).

`DATABASE_URL` is built at runtime from `POSTGRES_*`: use the `npm run prisma:*` scripts, never bare `npx prisma`. Storage, AI keys, SMTP, Web Push and the telemetry connection are configured at runtime in the admin UI and **never** get environment variables.

## 2. Daily loop

Work happens in a worktree on a branch, and every change ships as a pull request ([AGENTS.md](../AGENTS.md): issue first, worktree under `worktrees/<short-name>`, small Conventional Commits). Inside the worktree:

```bash
npm install
npm run prisma:generate --workspace=api       # after install and after any schema change
npm test --workspace=api                      # unit + mocked integration, no database
npm run test:run --workspace=web              # Vitest
npm run test:run --workspace=cli
npm run typecheck --workspace=api             # also web, cli
npm run lint
```

Without Docker: `npm run api:dev` (Nest watch) and `npm run web:dev` (Vite) need a database and the same `.env` values exported; the compose dev stack is the supported path because nginx provides the same-origin routing and the WebSocket location.

## 3. Generated files

| Never edit | Source of truth | Regenerate |
|---|---|---|
| `apps/api/prisma/schema/*` | `apps/api/prisma/fragments/*` and the platform's fragments | `npm run db:compose --workspace=api`, then `prisma:generate` (`db:compose:check` in CI) |
| `infra/compose/*.compose.yml` (except `app.*`), `infra/nginx/*` except `app.d/`, `infra/otel/otel-collector-config.yaml`, `infra/compose/.env.example` | `@marinoscar/platform-infra` plus `infra/compose/app.env.example`, `app.*.compose.yml`, `infra/nginx/app.d/`, `infra/otel/app-collector.yaml` | `npm run platform:infra:sync` (`-- --check` in CI); the lock is `infra/platform-infra.lock.json` |
| `apps/api/prisma/catalog/permissions.json` | the registrations in `src/app-registrations/` | `npm run catalog:permissions --workspace=api` |
| `apps/api/prisma/catalog/system-settings-defaults.json` | the settings registry | `npm run catalog:settings --workspace=api` |
| the web's permission snapshot | the permission registry | `npm run permissions:dump --workspace=api` (`-- --check` in CI) |
| `openapi.json` | the controllers | `npm run openapi:dump`, `npm run openapi:lint` |
| `apps/api/prisma/migrations/**` installed platform copies | the platform package | `npm run db:sync --workspace=api`; never edit; `platform.lock` records every hash, comments count |

A platform variable ShellKeep serves differently (`APP_URL`, `GOOGLE_CALLBACK_URL`, `APP_BIND_PORT`) is set in `.env`, not repeated in `app.env.example`. Never add a commented `# KEY=value` line to either env example: the CLI reads it as a declared variable.

## 4. Database changes

- **ShellKeep's own tables** (`server_profiles`, `terminal_*`, `runbook*`): edit the fragment in `apps/api/prisma/fragments/`, `db:compose`, `prisma:generate`, then `cd apps/api && npm run prisma:migrate:dev -- --name <name>`. Review the SQL. A table that carries `org_id` and should be isolated is an **org table**: forced RLS, a policy per table, composite foreign keys that include `org_id`, and the migration runs as `BEGIN; SELECT set_config('app.rls_bypass','on',true); ...; COMMIT;` ([SECURITY-ARCHITECTURE.md §8](SECURITY-ARCHITECTURE.md#8-database-role-and-row-level-security)). Classify the model in `app-registrations/model-ownership.ts` and, if it references a user, `user-owned-models.ts` with a purge and export decision; the conformance suite fails otherwise.
- **A platform table**: not a local change. File a seam request (`seam_request.yml`) and follow the `platform-migration` skill only when the platform ships the migration.
- **Partial or expression indexes** are written in migration SQL and listed in `rawSqlIndexes`; never "fix" one with `@@unique`.
- `npm run db:check` (hashes), `db:check:database` (the ledger of a live database), `db:drift` (migrations equal the composed schema) and `db:baseline` (adopt a deployed database: [runbooks/database-baseline.md](runbooks/database-baseline.md)).
- Seed: `npm run prisma:seed --workspace=api` seeds roles, permissions and the initial admin from the generated catalog; it runs as the application role in CI.
- Apply in production: `npm run prisma:migrate` (the CLI's deploy does it).

## 5. Adding things

| Task | Where and how |
|---|---|
| An endpoint | controller method with `@Auth({ permissions })` (or `@Public()`), Zod DTO, `@ApiOperation`/`@ApiResponse`, service method, unit and integration tests, `npm run openapi:dump && npm run openapi:lint`; conventions in [API.md](API.md) |
| A permission | `src/app-registrations/permissions.ts`; `npm run catalog:permissions`; update the matrix in [ARCHITECTURE.md §4](ARCHITECTURE.md#4-authorization) (`docs-consistency.spec.ts` fails otherwise) |
| A job type | `add-job-type` skill; add the type and label to `test/jobs/job-type-snapshot.spec.ts` and the table in ARCHITECTURE.md §6 |
| A notification | `add-notification` skill; `notify()` only after the write commits |
| A settings namespace | `src/app-registrations/settings.ts` (append, never insert), defaults catalog |
| A settings page | `add-settings-page` skill: a card in `adminSections.tsx` or `userSettingsSections.tsx` with the exact permission the controller enforces |
| An AI feature | `src/app-registrations/ai.ts`; terminal text only through `TerminalContextService.forAi` ([specs/terminal-ai.md §4](specs/terminal-ai.md#4-extending-it)) |
| A runbook step kind | [specs/fleet-runbooks.md §4](specs/fleet-runbooks.md#4-extending-it) |
| A terminal protocol message | [specs/terminal.md §4](specs/terminal.md#4-extending-it) |
| A platform gap | a seam request and a row in [platform-adoption/local-exceptions.md](platform-adoption/local-exceptions.md) with a `// PLATFORM-ADOPTION-SHIM(<issue>)` marker; never copy or patch platform code |

Base code (`apps/api/src/platform/`) never names the terminal domain; the domain registers itself from `app-registrations/` (`test/architecture/base-domain-boundary.spec.ts`). Deep imports into platform packages are refused (`npm run check:platform-imports`).

## 6. NestJS and Fastify notes

- The API runs on **Fastify**, not Express. Prefer returning values and letting Nest serialize; when you need the reply, use `FastifyReply` (`res.code(200).send(body)`, not `status().json()`), and `FastifyRequest` from `fastify`.
- The success envelope is applied by a global interceptor; do not wrap bodies by hand. Errors are thrown as `HttpException`s with a registered `code` and answered by the global filter ([API.md](API.md#errors)).
- Validation is Zod through `ZodValidationPipe`; WebSocket messages are validated by hand in the gateway.
- Sign-in strategies, cookies and the Passport/Fastify adapter live in the platform identity slice; do not reimplement them. The only cookie is the HttpOnly `refresh_token`.
- Prisma: use the `PrismaService`/`forOrg`/`runInOrg` helpers; row-level security context is written only with `set_config(..., true)` as the first statement of a transaction. Never use a `forOrg` client inside `$transaction(async tx => ...)`; use `runInOrg`.
- A new `@Cron` only enqueues a job (`enqueueHousekeepingJob`); work in a `JobHandler`.
- `ssh2` is imported only by the SSH factory and the executors; open every connection with `SshConnectionFactory.open`.

## 7. Debugging

| Symptom | Look at |
|---|---|
| Sign-in fails for a valid account | the allowlist (Users page) and `INITIAL_ADMIN_EMAIL`; the Google callback URL equals `GOOGLE_CALLBACK_URL` exactly |
| "Default role not found" on first login | the database was not seeded: `npm run prisma:seed` |
| Terminal does not connect | browser console for `auth_fail` or `session_error` and the reason table in [specs/terminal.md §3](specs/terminal.md#3-websocket-protocol); `HOST_KEY_UNKNOWN` means trust the key on the Servers page; check the API logs for `ws.auth.denied` (no token is ever logged) |
| Terminal drops after a minute | a proxy with a 60 s read timeout between browser and API ([ssl-nginx-setup.md](ssl-nginx-setup.md)) |
| Scroll wheel moves the cursor instead of the history | the tmux session was created before `mouse on`; create a new session |
| A run is stuck `queued` | the worker queue: Jobs page (`/admin/settings/jobs`); `runbooks.enabled`; reconcile sweep status in Doctor |
| `db:drift` fails | a migration and a fragment disagree; recompose, then fix the fragment, never the generated schema |
| Everything under RLS returns empty | the API connected as a superuser or `BYPASSRLS` role, or the org context was not set; Doctor check `db.rls_role` |
| OpenTelemetry noise | `OTEL_ENABLED=false` locally, or run the telemetry overlay |

Logs are structured JSON (Pino); trace and request ids correlate. Doctor (`/admin/settings/doctor`, `shellkeep doctor`) is the first stop for configuration problems.

## 8. The CLI

`apps/cli` is the `shellkeep` command over `@marinoscar/platform-cli` (`npm run dev --workspace=cli -- <args>` runs it from source). Usage, deploy, doctor and worker nodes: [apps/cli/README.md](../apps/cli/README.md). Every improvement bumps `apps/cli/package.json` once per PR and refreshes the lockfile (`npm install --package-lock-only`).

## 9. Checks CI runs

Typecheck (api, web, cli), lint, `check:classification`, `db:compose:check`, `db:check`, `permissions:dump --check`, `check:platform-pin` (one exact `@marinoscar/platform-*` version everywhere), `check:single-instance`, `check:platform-imports`, `platform:infra:sync --check`, `test:infra` (compose config per mode and `nginx -t`), the docker smoke test on port 8323, API, web and CLI tests, the database job (fresh migrate, seed, `db:check:database`, `db:drift`, `test:db` as the bootstrap superuser **and** as `shellkeep_app`), OpenAPI dump and Spectral lint, and visual regression. Details: [TESTING.md](TESTING.md).
