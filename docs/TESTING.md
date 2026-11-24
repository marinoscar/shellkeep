# Testing Guide

> **Audience:** developers · Per-API detail (E2E database options): [../apps/api/TESTING.md](../apps/api/TESTING.md)

## Contents

1. [Tiers](#1-tiers)
2. [Running tests](#2-running-tests)
3. [Conformance and guard specs](#3-conformance-and-guard-specs)
4. [Conventions and helpers](#4-conventions-and-helpers)
5. [Terminal, SSH and runbook fixtures](#5-terminal-ssh-and-runbook-fixtures)
6. [Docs guards](#6-docs-guards)
7. [CI](#7-ci)

## 1. Tiers

| Tier | Where | Tooling | Needs |
|---|---|---|---|
| API unit | `apps/api/src/**/*.spec.ts` beside the code | Jest | nothing |
| API integration (mocked database) | `apps/api/test/**/*.spec.ts` | Jest + Supertest, `createTestApp({ useMockDatabase: true })`, `jest-mock-extended` Prisma mock | nothing |
| API real database | `apps/api/test/**/*.db.spec.ts` | Jest, run in band | migrated PostgreSQL (`npm run test:db`); RLS, composite keys, raw-SQL indexes and the run engine are proven here because a mocked Prisma cannot |
| Web | `apps/web/src/__tests__/` and beside components | Vitest + React Testing Library + MSW | nothing |
| CLI | `apps/cli/src/**/*.test.ts` | Vitest | nothing; `npm run test:infra` adds compose config and `nginx -t` |
| Browser e2e | `tests/e2e/specs/` | Playwright | the running stack |
| Visual regression | `tests/visual/specs/` | Playwright over `apps/web/visual/` (a fake terminal socket, no API) | the pinned container CI uses; baselines regenerate through the `visual-baselines` workflow |

Mock OAuth in CI: no test depends on Google.

## 2. Running tests

```bash
npm test --workspace=api                  # unit + mocked integration (skips *.db.spec.ts)
npm run test:db --workspace=api           # real-Postgres tier; point POSTGRES_HOST/PORT at a migrated database
npm run test:all --workspace=api          # everything
npm run test:cov --workspace=api          # coverage
npm run test:run --workspace=web          # also: test:watch, test:coverage
npm run test:run --workspace=cli
npm run typecheck --workspace=api         # also web, cli
npm run test:scripts                      # the repository's own scripts
npm run test:infra                        # compose config per mode, nginx -t
```

Memory is tight on small machines: add `-- -w 1` (one Jest worker) or `--runTestsByPath <file>`; the web suite is heavier than the API's.

`test:db` builds its database from the migrations (the `test.compose.yml` overlay provides a throwaway PostgreSQL and GreptimeDB). CI runs it twice: as the bootstrap superuser, then as the application role `shellkeep_app`, because RLS only bites for the latter ([runbooks/application-role.md](runbooks/application-role.md)).

## 3. Conformance and guard specs

These are executable rules; a failure names the rule and usually the fix. Do not skip one: an exemption needs a written reason.

| Spec | Guards |
|---|---|
| `test/conformance.spec.ts` | `runPlatformConformance` over ShellKeep's code, one suite per adopted slice (the suites and their options are listed in the file): `cron-enqueue-only` with no exemption, `on-event-no-io` (the one listener, the runbook job-settled listener, only enqueues), `user-owned-data`, `identity`, `settings`, `credentials`, `host`, `doctor-read-only`, `nodes`, `storage`, `email`, `notifications`, `dbBackup`, `telemetry`, `webhooks`, `alerts` and the seven `ai-*` suites |
| `test/jobs/job-type-snapshot.spec.ts` | every registered job type string and label is pinned; a type may not disappear; every `ai.*`, export and user-data type is server-only |
| `test/architecture/base-domain-boundary.spec.ts` | base code never names the terminal domain |
| `test/tenancy/system-injection-boundary.spec.ts` | only listed files inject `PrismaSystemService`, each with a registered reason |
| `test/ssh/ssh-boundary.spec.ts` | `ssh2` is used only by the connection factory and executors |
| `test/terminal-ai/capture-boundary.spec.ts` | `capture-pane` appears only in `SessionHistoryService` |
| `test/platform/storage-key-prefixes.spec.ts` | every object-key prefix a writer uses is registered |
| `test/platform-resolve.spec.ts`, `check:platform-pin`, `check:single-instance`, `check:platform-imports` | one platform version, no deep imports |
| `test/pg-client-version.spec.ts` | the `pg_dump` client matches the server major |
| `test/docs-links.spec.ts`, `test/ai-assistant-config.spec.ts`, `test/docs-consistency.spec.ts` | docs ([§6](#6-docs-guards)) |
| web `conformance.test.ts`, `platform-resolve.test.ts`, `architecture/` | the web conformance suites, the five breakpoint gates (`config/breakpointGates.test.ts`), the scroll chain (`TerminalWorkspace.workspace.test.tsx`) |
| `npm run check:classification` | every top-level directory under the classified roots has a row in [platform-adoption/module-classification.md](platform-adoption/module-classification.md) |

Standing facts the suites encode: a record you may not see is 404, never 403; terminal and runbook secrets never appear in a response, export, log or payload; SSH and `ai.*` jobs carry neither node member; every `@Cron` only enqueues.

## 4. Conventions and helpers

- Name files `<unit>.spec.ts` (API) and `<unit>.test.ts(x)` (web, CLI); `*.db.spec.ts` needs a database; `*.integration.spec.ts` uses the mocked app.
- API helpers in `apps/api/test/helpers/`: `test-app.helper` (`createTestApp`, `closeTestApp`), `auth-mock.helper` (`authHeader`, `createMockAdminUser`), `db-test-support`, `rls-database.helper` (a real database with the application role and org context), `sharing-doubles` (allow-all sharing for mocked suites). `test/mocks/prisma.mock.ts` and `test/fixtures/mock-setup.helper.ts` set up the Prisma mock; `test/fixtures/` holds role, user and settings fixtures.
- A behaviour change carries its test in the same commit or the next. A bug fix starts with the failing test.
- Test data uses invented placeholders: `server-a.example.test`, `Person A`, `Org Alpha`, `SHA256:AAAA...`; never real hosts, people, keys or user-supplied material.
- A test never sleeps for a wall-clock interval to prove a property (liveness, ReDoS safety): assert it structurally (RE2 patterns, fake timers).
- Web: render with the providers the page needs (`__tests__/utils/test-utils.tsx`, `mock-providers.tsx`), mock the API with MSW, mock browser APIs (`matchMedia`, `visualViewport`, `WebSocket`) in `setup.ts`; terminal tests use a fake socket and never a real xterm canvas.

## 5. Terminal, SSH and runbook fixtures

- `test/terminal/scripted-ssh-server.ts` and `test/runbooks/runbook-ssh-fixture.ts` are in-process SSH servers that script a shell, record exactly what was sent (the dry-run allowlist and the stdin-only rule are asserted against it) and can present a changed host key.
- `test/runbooks/engine-harness.ts` drives the engine with a fake queue against the real database tier.
- `test/terminal-ai/summary-fakes.ts` fakes the provider; no test calls a real AI provider.
- A gateway test creates a socket against the Nest `WsAdapter` and exercises `auth`, `connect`, expiry (fake timers) and maintenance; the protocol it asserts is [specs/terminal.md §3](specs/terminal.md#3-websocket-protocol).

## 6. Docs guards

- `test/docs-links.spec.ts`: every relative link in `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/**`, the agent definitions, skills, `AGENTS.md` files and package READMEs resolves to a file. Name a future file in backticks, not as a link.
- `test/ai-assistant-config.spec.ts`: size budgets of `AGENTS.md` and `CLAUDE.md` (root `AGENTS.md` stays under 24 KB) and the two agent sets in step ([AI-ASSISTANTS.md](AI-ASSISTANTS.md)).
- `test/docs-consistency.spec.ts`: the lists the code owns and the docs restate (permission matrix, job types, WebSocket reasons, redaction kinds, step kinds, run statuses) between `<!-- name:start -->` markers equal the code. Change both in one pull request.

## 7. CI

`.github/workflows/ci.yml` jobs: **Typecheck and lint** (classification, `db:compose:check`, `db:check`, `permissions:dump --check`, typechecks, lint, pin and import checks, `platform:infra:sync --check`, `test:infra`); **Docker** (build the images, generated stack, smoke on 8323, `nginx -t`); **Tests** (API, web, CLI); **Database** (fresh migrate, seed, ledger, drift, `test:db` as superuser and as `shellkeep_app`); **OpenAPI** (typecheck, dump, Spectral); **Visual regression**. `deploy.yml` builds and publishes the images. A red check this diff did not cause is stated on the pull request; no check is skipped or quarantined to get green.
