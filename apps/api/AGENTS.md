# apps/api rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the NestJS API. Conventions: [docs/API.md](../../docs/API.md); testing: [docs/TESTING.md](../../docs/TESTING.md) and [TESTING.md](TESTING.md).

## Layout

- Domain (ShellKeep's own, stays after the retrofit): `src/server-profiles/` (profiles, test connection), `src/terminal/` (`sessions.*` REST, `session-manager.service.ts` tmux lifecycle, `ssh.service.ts`, `terminal.gateway.ts` WebSocket at `/api/terminal/ws`, `tasks/session-cleanup.task.ts`).
- Identity is the platform's since #47 (`src/platform/identity/` binds it; the forked `auth`, `users`, `allowlist`, `device-auth` and `test-auth` modules are deleted). Settings and credentials are the platform's since #48 (`src/platform/settings/`, `src/platform/credentials/`; `app-registrations/settings.ts` and `credentials.ts` hold the namespaces and the `ssh` purpose; the forked `settings` module and `common/utils/encryption.util.ts` are deleted). Base modules still to adopt (#46, #49 to #55): `src/storage`, `src/health`, `src/common`, `src/prisma`. Do not extend one that a later issue replaces; check the program (#30) first.
- Target layout *(from #44)*: `src/platform/<slice>/` binds each packaged slice (`forRoot` config, host ports); `src/app-registrations/` holds permissions, job labels and other registrations; base modules never import the domain modules.
- `prisma/fragments/` is hand-edited, `prisma/schema/` is GENERATED (`npm run db:compose`), `prisma/migrations/` holds installed platform copies plus the app's own migrations, `prisma/platform.lock` proves them, `prisma/sql/` holds operator scripts (`create-app-role.sql`).
- Tests in `test/` and beside sources (`*.spec.ts`); config `test/jest.config.js`.

## Rules

- **Every route declares its access** (`@Auth(...)` or `@Public()` from `@marinoscar/platform-api/identity`; take the request's organization with `@CurrentOrg()` and name it next to the owner in every query of an org-stamped table). A UI card's permission must equal the string enforced here. Add new routes to RBAC coverage.
- **Validate input** (Zod from #41; DTO classes until then). Document with `@ApiOperation` / `@ApiResponse`.
- **WebSocket gateway**: authenticate on the first `auth` message through `TerminalPrincipalResolver` (never a query string), require `sessions:write`, end the socket with `auth_expired` at the token's `exp` unless the client re-sends `auth`, re-authorize per message against the session or profile owner, validate every message shape, bound message size and rate, and clean up the tmux/SSH resources on disconnect. Never log terminal payloads.
- **SSH (`ssh.service.ts`)**: all connections go through one factory; host keys are verified before any command runs (#60); decrypted credentials exist only inside the call and never reach a log, span, error message, response, AI prompt or job payload. A profile's secrets are read and written only through `UserCredentialsService` (purpose `ssh`, names `profile.<id>.<field>`, `server-profiles/ssh-credentials.ts`); never name `ENCRYPTION_KEY` outside `server-profiles/migrate/`.
- **Long-running work is a queue job** (root queue rules, applies from #49). Interactive terminal I/O is not a job. A `@Cron` only enqueues.
- **AI** (root AI rules, applies from #55): `AiService.forUser`; redact terminal output before any model call and honour the per-profile AI switch (#56); `ai.*` jobs are server-only.
- **RLS clients** (from #45): `forOrg`/`runInOrg` for org tables, never a `forOrg` client inside `$transaction`; `set_config(..., true)` only.
- **`notify()` after commit**, outside any `$transaction`.
- **Never hand-edit `prisma/schema/`** once generated; use `npm run prisma:*`, never bare `npx prisma`. Never rewrite an applied migration.
- **No env vars for runtime-configured features** (storage, AI, VAPID, SMTP). App variables go in `.env.example` as documented in root AGENTS.md.
- **A behaviour change carries tests**; run `npm test` and `npm run typecheck` in this folder.
