# ShellKeep documentation

> **Audience:** developers and operators · **Rules for assistants:** [AGENTS.md](../AGENTS.md)

ShellKeep is a browser-based terminal workspace with persistent tmux-backed sessions over SSH, a Terminal AI assistant and Fleet Runbooks. It hosts the EnterpriseAppBase `@marinoscar/platform-*` packages; this folder documents ShellKeep's own design and links to the platform's docs for everything the platform owns. A document that is not listed here does not exist.

## Doc map by task

| I want to... | Read |
|---|---|
| Run the app locally | [README.md](../README.md), then [DEVELOPMENT.md](DEVELOPMENT.md) |
| Understand how it is built | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change the terminal (sessions, WebSocket, tmux, scrolling, mobile input) | [specs/terminal.md](specs/terminal.md), [../apps/web/AGENTS.md](../apps/web/AGENTS.md) |
| Change Terminal AI (assist, explain, summaries, redaction, consent) | [specs/terminal-ai.md](specs/terminal-ai.md) |
| Change runbooks (definitions, run engine, approvals, AI step, logs) | [specs/fleet-runbooks.md](specs/fleet-runbooks.md) |
| Change the API or add an endpoint | [API.md](API.md), [DEVELOPMENT.md](DEVELOPMENT.md), [../apps/api/AGENTS.md](../apps/api/AGENTS.md) |
| Understand auth, RBAC, SSH credential handling, host-key trust | [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) |
| Authorize a CLI or device | the platform's [device authorization guide](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/DEVICE-AUTH.md), [personal access tokens](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/personal-access-tokens.md) |
| Write or run tests | [TESTING.md](TESTING.md), [../apps/api/TESTING.md](../apps/api/TESTING.md) |
| Deploy to a VPS with the `shellkeep` CLI (install, update, adopting an old install) | [../apps/cli/README.md](../apps/cli/README.md#deploying-to-a-server), [ssl-nginx-setup.md](ssl-nginx-setup.md) |
| Know where ShellKeep deviates from the platform | [platform-adoption/local-exceptions.md](platform-adoption/local-exceptions.md) |
| Use a platform capability (jobs, AI, sharing, ...) | the slice READMEs and specs in [EnterpriseAppBase](https://github.com/marinoscar/EnterpriseAppBase/tree/main/docs), mapped in [ARCHITECTURE.md §2](ARCHITECTURE.md#2-subsystem-map) |
| Work with Claude Code or OpenCode on this repo | [AI-ASSISTANTS.md](AI-ASSISTANTS.md), [../AGENTS.md](../AGENTS.md) |
| Operate: baseline a database, create the application role, back up and restore | [runbooks/database-baseline.md](runbooks/database-baseline.md), [runbooks/application-role.md](runbooks/application-role.md), [runbooks/database-backup-restore.md](runbooks/database-backup-restore.md) |
| Move SSH secrets into the credential store | [runbooks/ssh-secret-reencryption.md](runbooks/ssh-secret-reencryption.md) |
| Ship the Android app; configure storage, webhooks, alerts | [runbooks/android-app.md](runbooks/android-app.md), [runbooks/storage-configuration.md](runbooks/storage-configuration.md), [runbooks/webhooks.md](runbooks/webhooks.md), [runbooks/alerts.md](runbooks/alerts.md) |

## Index

| Document | Holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Subsystem map, domain, permission matrix, tables, job types, settings, infrastructure |
| [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) | Trust boundaries, WebSocket authorization, SSH secrets, host keys, AI and runbook safety, threat model |
| [API.md](API.md) | API conventions (auth, envelope, errors, SSE, WebSocket summary); endpoints are in `/api/docs` |
| [specs/terminal.md](specs/terminal.md) | Sessions, gateway protocol, tmux, reaper, browser terminal |
| [specs/terminal-ai.md](specs/terminal-ai.md) | Assist, explain, session summaries, redaction pipeline, consent |
| [specs/fleet-runbooks.md](specs/fleet-runbooks.md) | Runbook model, run engine, logs, safety, AI step |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev loop, database changes, gotchas |
| [TESTING.md](TESTING.md) | Test tiers, conformance, docs guards |
| [AI-ASSISTANTS.md](AI-ASSISTANTS.md) | Claude Code and OpenCode configuration, size budgets, guards |
| [ssl-nginx-setup.md](ssl-nginx-setup.md) | Host proxy, TLS and the WebSocket |
| [platform-adoption/](platform-adoption/README.md) | Frozen baseline, module classification, the exceptions ledger |

## Runbooks

Operator procedures in [runbooks/](runbooks/database-baseline.md):

| Runbook | Holds |
|---|---|
| [database-baseline.md](runbooks/database-baseline.md) | Baseline a deployed database onto the platform migration history |
| [application-role.md](runbooks/application-role.md) | The `shellkeep_app` database role: create, switch, rollback |
| [database-backup-restore.md](runbooks/database-backup-restore.md) | In-app database backup and restore |
| [ssh-secret-reencryption.md](runbooks/ssh-secret-reencryption.md) | Re-encrypt SSH secrets into the credential store (dry run, apply, verify, rollback) |
| [android-app.md](runbooks/android-app.md) | Android app: install, trust, pair, releases |
| [storage-configuration.md](runbooks/storage-configuration.md) | Configure object storage |
| [webhooks.md](runbooks/webhooks.md) | Outbound webhooks: events, endpoints, signature verification, rotation |
| [alerts.md](runbooks/alerts.md) | Alerts: the four ShellKeep starter rules, enabling, tuning, incidents |

## Maintenance

- Add a doc: create it, then list it here and, if assistants need it, in the table of `CLAUDE.md`.
- Links are relative and resolve from the containing file; `apps/api/test/docs-links.spec.ts` fails on a broken one. Name a future file in backticks, never as a link.
- Lists the code owns (permissions, job types, WebSocket reasons, redaction kinds, step kinds, run statuses) sit between `<!-- name:start -->` markers and are checked by `apps/api/test/docs-consistency.spec.ts`.
- Use invented placeholders (`app.example.test`, `server-a.example.test`, `Person A`) for hosts, people and organizations.
