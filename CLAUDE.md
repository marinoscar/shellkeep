# CLAUDE.md

@AGENTS.md

Claude Code loads the shared rules above (project overview, structure, every MANDATORY section, key commands) from [AGENTS.md](AGENTS.md). Area rules load from the nested `AGENTS.md` of the folder you work in (`apps/api`, `apps/web`). This file adds only what is specific to Claude Code: the documentation table, the subagent delegation rules and the cloud-session exception. How Claude Code and OpenCode share these files: [docs/AI-ASSISTANTS.md](docs/AI-ASSISTANTS.md).

## MANDATORY: No real people, companies or user material

Never use real people, companies or material a user shares as examples, fixtures or test data; use invented placeholders. Rule and exemptions: [AGENTS.md](AGENTS.md#mandatory-no-real-people-companies-or-user-material).

## Cloud sessions

The worktree rule in AGENTS.md has an exception: in a cloud session, or whenever the environment has already put you on a designated branch, work on the branch the session designates instead of creating a worktree. The PR rules still apply: commit in slices, push that branch, open the PR against `main`.

## Where things are documented

Full index with a "Doc map by task": [docs/README.md](docs/README.md). Read docs by section (`grep -n '^#'`, then offsets), never whole. Later program issues append rows here as their docs land.

| Topic | Read |
|---|---|
| Architecture, module map, data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Security design: auth, RBAC, SSH credential encryption, sessions | [docs/SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) |
| API conventions and endpoint reference (the generated OpenAPI is at `/api/docs`) | [docs/API.md](docs/API.md) |
| Dev loop, environment variables, debugging | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| Testing tiers, helpers, fixtures | [docs/TESTING.md](docs/TESTING.md), [apps/api/TESTING.md](apps/api/TESTING.md) |
| Terminal scrolling (touch scroll, scroll buttons, keyboard inset) | [docs/SCROLLING.md](docs/SCROLLING.md) |
| Device authorization (RFC 8628) | [docs/DEVICE-AUTH.md](docs/DEVICE-AUTH.md) |
| Original implementation specs (foundation build order) | [docs/specs/README.md](docs/specs/README.md) |
| Nginx, SSL and compose notes | [docs/ssl-nginx-setup.md](docs/ssl-nginx-setup.md), [docs/docker-compose-project-name-fix.md](docs/docker-compose-project-name-fix.md) |
| Deployment (VPS install and update) | [infra/deploy/DEPLOY.md](infra/deploy/DEPLOY.md) |
| Recipes (skills) | [add-job-type](.claude/skills/add-job-type/SKILL.md), [add-settings-page](.claude/skills/add-settings-page/SKILL.md), [add-notification](.claude/skills/add-notification/SKILL.md), [platform-migration](.claude/skills/platform-migration/SKILL.md): each applies once its slice is adopted |
| Area rules | [apps/api/AGENTS.md](apps/api/AGENTS.md), [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| How Claude Code and OpenCode share these files, guard specs | [docs/AI-ASSISTANTS.md](docs/AI-ASSISTANTS.md) |

## Specialized Subagents (MANDATORY)

Delegate development work to the matching subagent in `.claude/agents/`. Each agent carries its domain's rules and points to the docs that own the details, so delegation keeps patterns consistent.

| Agent | Domain | MUST use for |
|---|---|---|
| `backend-dev` | NestJS API, Fastify, SSH, WebSocket gateway, auth, RBAC | **Any** backend code: endpoints, services, guards, gateway, JWT, OAuth, job handlers |
| `frontend-dev` | React, MUI, xterm.js, TypeScript | **Any** frontend code: components, pages, hooks, theming, responsive design |
| `database-dev` | PostgreSQL, Prisma | **Any** database work: schema, migrations, seeds, queries |
| `testing-dev` | Jest/Supertest (API), Vitest/RTL (web) | **Any** testing: unit, integration, typecheck, fixtures |
| `docs-dev` | Technical documentation | **Any** documentation: ARCHITECTURE.md, SECURITY-ARCHITECTURE.md, API.md, README, specs, runbooks |
| `ops-dev` | Routine operations (Haiku) | Rebuilding/restarting containers, running Prisma migrations, running typecheck |

Delegation rules:

1. Backend code changes → `backend-dev`.
2. Frontend code changes → `frontend-dev`.
3. Database/Prisma changes → `database-dev`.
4. Writing or updating tests → `testing-dev`.
5. Documentation updates → `docs-dev`.
6. Routine ops (container rebuilds, migrations, typecheck) → `ops-dev`. `ops-dev` must **never** perform state-changing git operations (pull, merge, push, commit, worktree or branch management); the main agent does those, and `ops-dev` refuses them.

Multi-domain tasks invoke several agents in sequence, for example a new per-server setting: `database-dev` (migration) → `backend-dev` (endpoint) → `frontend-dev` (UI) → `testing-dev` (tests) → `docs-dev` (docs).

```
"Use backend-dev to implement the server profile endpoint"
"Use testing-dev to write integration tests for the terminal gateway"
"Use ops-dev to rebuild the api container and run migrations"
```

Do not write controllers, services, guards, components, Prisma schema, migrations, tests or documentation directly. The only exceptions:

- Reading files to understand context.
- Answering questions about the codebase.
- Planning and coordinating between agents.
- Running simple commands (`git status`, `npm install`, etc.).
