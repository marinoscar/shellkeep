# ShellKeep documentation

> **Audience:** developers and operators · **Rules for assistants:** [AGENTS.md](../AGENTS.md)

ShellKeep is a browser-based terminal workspace with persistent tmux-backed sessions over SSH. This index lists every document that exists today. Later program issues (platform retrofit, epic #30) append rows as their docs land; a doc that is not listed here does not exist yet.

## Doc map by task

| I want to... | Read |
|---|---|
| Run the app locally | [README.md](../README.md), then [DEVELOPMENT.md](DEVELOPMENT.md) |
| Understand how it is built | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change the API or add an endpoint | [API.md](API.md), [DEVELOPMENT.md](DEVELOPMENT.md), [../apps/api/AGENTS.md](../apps/api/AGENTS.md) |
| Change the web UI or the terminal | [SCROLLING.md](SCROLLING.md), [../apps/web/AGENTS.md](../apps/web/AGENTS.md) |
| Understand auth, RBAC and SSH credential handling | [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) |
| Authorize a CLI or device | [DEVICE-AUTH.md](DEVICE-AUTH.md) |
| Write or run tests | [TESTING.md](TESTING.md), [../apps/api/TESTING.md](../apps/api/TESTING.md) |
| Deploy to a VPS | [../infra/deploy/DEPLOY.md](../infra/deploy/DEPLOY.md), [ssl-nginx-setup.md](ssl-nginx-setup.md), [docker-compose-project-name-fix.md](docker-compose-project-name-fix.md) |
| Work with Claude Code or OpenCode on this repo | [AI-ASSISTANTS.md](AI-ASSISTANTS.md), [../AGENTS.md](../AGENTS.md) |
| Baseline an existing database, create the application role | [runbooks/database-baseline.md](runbooks/database-baseline.md), [runbooks/application-role.md](runbooks/application-role.md) |
| Move the SSH secrets of a deployed database into the credential store | [runbooks/ssh-secret-reencryption.md](runbooks/ssh-secret-reencryption.md) |
| See the original build specs | [specs/README.md](specs/README.md) |

## Index

| Document | Holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, modules, data flow |
| [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) | Security design |
| [API.md](API.md) | API reference |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev loop, gotchas, debugging |
| [TESTING.md](TESTING.md) | Testing tiers and helpers |
| [SCROLLING.md](SCROLLING.md) | Terminal touch scrolling and keyboard inset |
| [DEVICE-AUTH.md](DEVICE-AUTH.md) | Device authorization (RFC 8628) |
| [AI-ASSISTANTS.md](AI-ASSISTANTS.md) | Claude Code and OpenCode configuration, size budgets, guards |
| [runbooks/database-baseline.md](runbooks/database-baseline.md) | Baseline a deployed database onto the platform migration history |
| [runbooks/application-role.md](runbooks/application-role.md) | The `shellkeep_app` database role: create, switch, rollback |
| [runbooks/database-backup-restore.md](runbooks/database-backup-restore.md) | In-app database backup and restore |
| [runbooks/ssh-secret-reencryption.md](runbooks/ssh-secret-reencryption.md) | Re-encrypt SSH secrets into the platform credential store (dry run, apply, verify, rollback) |
| [specs/README.md](specs/README.md) | Foundation implementation specs |
| [ssl-nginx-setup.md](ssl-nginx-setup.md) | SSL and Nginx reverse proxy notes |
| [docker-compose-project-name-fix.md](docker-compose-project-name-fix.md) | Compose project name note |

## Maintenance

- Add a doc: create it, then list it here and in the table of `CLAUDE.md` if assistants need it.
- Links are relative and resolve from the containing file; `apps/api/test/docs-links.spec.ts` fails on a broken one.
- Name a future file in backticks, never as a link, until it exists.
