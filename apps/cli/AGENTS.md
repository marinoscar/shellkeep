# apps/cli rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the `shellkeep` CLI. Usage, install, flags, exit codes and environment variables: [README.md](README.md), the source of truth; do not restate it elsewhere.

## Layout

- The engine is **`@marinoscar/platform-cli`** (pinned in `package.json`, one exact version with the other platform packages): the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the ink TUI, the VPS deploy pipeline and the worker-node engine. `src/` holds only what the platform does not have; **never add a copy of an engine file**.
- `src/app.ts`: `APP_CLI_OPTIONS` (identity from `@shellkeep/shared`, `readVersion()`, commands, TUI screens, deploy checks, env-spec fragment, proxy stream paths, versioned manifests, update notice). `src/cli.ts`: the entry point, import-light. `src/run.ts`: one invocation; returns the exit code and never calls `process.exit()`.
- `src/commands/`: one file per command (`servers-list`, `servers-test`, `sessions-list`, `sessions-attach`, `runbook-list`, `runbook-run`, `runbook-status`, `runbook-logs`), each over `ApiClient` with `--json`, and the group files (`servers.ts`, `sessions.ts`, `runbook.ts`). `src/terminal/bridge.ts`: the raw-mode terminal bridge. `src/tui/`: the Servers, Sessions and Runs screens; they colour through `useTuiTheme()` and `textColor(theme.<token>)`, never an ink colour literal. The brand theme and the root-menu banner are `APP_TUI_THEME` and `APP_TUI_MENU_ROOT` in `app.ts` (#148), from `BRAND` of `@shellkeep/shared`. `src/extensions/`: the deploy checks and the env-spec fragment.
- The CLI is the workspace `cli` (`--workspace=cli`), built from this monorepo and not published. CLI environment variables take the `SHELLKEEP_` prefix; API-side variables never do. The prefix, `~/.shellkeep/` and the systemd unit derive from `cliName` in `packages/shared/identity.json`.
- Extend through the platform's registries (`extraCommands`, `tuiScreens`, `deploySteps`, `deployChecks`, `nodeExecutors`, `proxy.streamPaths`), not by editing a platform file: `node_modules/@marinoscar/platform-cli/README.md`.

## Version bump (root rule: CLI Version Bump on Improvement)

- The version lives **only** in `apps/cli/package.json`. `readVersion()` in `src/app.ts` reads it at runtime; never hardcode it or import `package.json` elsewhere.
- It is recorded as `appctlVersion` in a deployment's state file and sent as the User-Agent of every request, so a stale version makes two installs indistinguishable.
- PATCH for an improvement or a set shipped together; MINOR for a new command or subcommand; **one bump per PR**. Then `npm install --package-lock-only` (the lockfile's `apps/cli` entry carries the version).
- The deploy version step versions `apps/api`, `apps/web` and `packages/shared` only (`deploy.versionedManifests`), never this package.
- Applies to `apps/cli` and `install.sh`. Docs-only edits, like this file, are not a CLI improvement.

## Deploying

VPS deployment is this CLI's `deploy` group (the platform's pipeline over the compose files `npm run platform:infra:sync` generates); there is no deploy script and there should not be. `.appctl-deploy.json` and the proxy sentinel `# Managed by appctl deploy` are the platform's fixed literals: live servers carry them, never rename them. Operator procedure and adopting an install made by the removed scripts: [README.md#deploying-to-a-server](README.md#deploying-to-a-server).

## Rules

- **The token never reaches argv, a URL, a log line or an error.** `sessions attach` sends it only in the WebSocket `auth` frame; `SHELLKEEP_DEBUG=1` logs frame sizes and types, never terminal bytes. The terminal is restored on every exit path (`terminal/bridge.ts`).
- **List output is an explicit field projection**, never the response passed through (`servers-list.ts`, `sessions-list.ts`): a field added to a response must not reach a terminal or a pipe by accident.
- A node never persists a job-scoped credential (root queue rule 3). `nodeExecutors` stays empty until a ShellKeep job type is node-eligible.
- **`parseEnvExample` reads any commented `# KEY=value` line** in `.env.example` as a declared variable. `.env.example` is generated: add a variable to `infra/compose/app.env.example`, uncommented, with its metadata in `src/extensions/env-spec.ts` (`app.test.ts` checks every key has one); never an illustrative commented assignment.
- `proxy.streamPaths` have no trailing slash (nginx 301s the bare list route) and match `infra/nginx/app.d/locations/`.
- A behaviour change carries tests in the same or the next commit; the `--help` of the ShellKeep commands is pinned (`UPDATE_HELP_SNAPSHOT=1`, review the diff).

Run: `npm run test:run --workspace=cli`, `npm run typecheck --workspace=cli`. `src/conformance.test.ts` runs the platform's `cli`, `deployRegistrations` and `tui` suites.
