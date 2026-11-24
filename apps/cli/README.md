# CLI (`shellkeep`)

`shellkeep` is ShellKeep from a terminal: log in, list your server profiles and terminal sessions, attach to a tmux-backed session, and deploy and operate a ShellKeep server. It is [`@marinoscar/platform-cli`](https://www.npmjs.com/package/@marinoscar/platform-cli) composed with ShellKeep's identity; `src/app.ts` holds the composition, `src/commands/` the ShellKeep commands, `src/terminal/bridge.ts` the terminal bridge. Rules for editing it: [AGENTS.md](AGENTS.md).

```bash
shellkeep --help          # init login api config node deploy servers sessions
shellkeep login           # device flow; stores a personal access token
shellkeep servers list
shellkeep sessions attach <id>
```

Run with no arguments in a terminal for the interactive menu (login, call an endpoint, status, worker node, deploy, servers, sessions, logout).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/shellkeep/main/install.sh | bash
```

The installer needs Node 20 or later, npm, git and curl. It clones `main`, builds the CLI workspace and installs it into `$SHELLKEEP_HOME/cli` (`~/.shellkeep/cli`; `/usr/local/lib/shellkeep/cli` when run as root, so `sudo shellkeep` finds it) with a `shellkeep` shim in `$SHELLKEEP_BIN_DIR` (`~/.local/bin`, or `/usr/local/bin` as root). Re-running it updates; `bash install.sh --uninstall` removes the CLI and the shim and never touches `config.json`.

| Variable | Meaning |
|---|---|
| `SHELLKEEP_REPO`, `SHELLKEEP_REF` | Repository URL and branch, tag or commit (default: this repository, `main`) |
| `SHELLKEEP_HOME`, `SHELLKEEP_BIN_DIR` | Install root and shim directory |
| `SHELLKEEP_SRC` | Install from a local checkout instead of cloning |
| `GITHUB_TOKEN` | For a private fork |

Set them on the process that reads them: `curl ... | SHELLKEEP_REF=v1.2.0 bash`.

An installed CLI prints, at most once a day on stderr, a line when `main` carries a newer version. `SHELLKEEP_NO_UPDATE_CHECK=1` turns it off.

## Logging in

```bash
shellkeep login --server https://app.example.com    # device flow in your browser
shellkeep login --server https://app.example.com --token pat_...   # headless, with a PAT
shellkeep config                                     # server URL and a masked token hint
```

The token goes into `~/.shellkeep/config.json` (mode 0600). In CI skip `login` and set `SHELLKEEP_SERVER_URL` and `SHELLKEEP_TOKEN`. `shellkeep api GET /api/auth/me` calls any endpoint.

## Servers and sessions

Each command reads the stored login and has `--json`.

| Command | API | Notes |
|---|---|---|
| `servers list [--tag t]` | `GET /api/server-profiles` | Every page. The output is a fixed field list: no credential, not even a "has password" flag |
| `servers test <id>` | `POST /api/server-profiles/:id/test` | Latency (this call's round trip) and host-key status (`trusted`, `unknown`, `mismatch`). Exit 1 on failure |
| `sessions list [--status active\|detached\|terminated\|all]` | `GET /api/sessions` | |
| `sessions attach <id>` | `WS /api/terminal/ws` | Below |

### `sessions attach`

Attaches this terminal to a session over the terminal gateway:

1. The server URL and token come from the stored login. The token travels only in the WebSocket `auth` frame: never in argv, a URL or a log line.
2. The terminal goes into raw mode once the session is ready; every byte you type is forwarded and every byte the session prints is written to stdout. The remote pane is resized to your terminal on connect and on every resize.
3. **`Ctrl-]` then `d` detaches** and leaves the tmux session running (it stays `active`). `Ctrl-C` goes to the remote program.
4. The terminal is restored on every way out: detach, session end, errors, `SIGINT`, `SIGTERM` and an uncaught error.
5. The token is re-sent every 10 minutes so a revoked token ends the terminal.

It needs an interactive terminal. `SHELLKEEP_DEBUG=1` prints frame sizes and message types to stderr, never terminal content.

| Exit | Meaning |
|---|---|
| 0 | Detached, or the session ended |
| 1 | Interrupted by a signal |
| 2 | stdin is not a TTY |
| 3 | The gateway refused the token (log in again) |
| 4 | The session could not be attached (not found, terminated, host key not trusted) or the connection failed |

The gateway accepts a `pat_` token as well as an access JWT.

## Deploying to a server

```bash
shellkeep deploy doctor
```

`doctor`, `install`, `update`, `status`, `list`, `about`, `certs` and `uninstall` are the platform's deploy pipeline over the compose files `npm run platform:infra:sync` generates (`infra/compose/`). They run on the server itself: SSH in, install the CLI (above), and run them. The pipeline, its steps, the answers file, consent, renewal and run records are described in the `@marinoscar/platform-cli` README; this section is what is ShellKeep's.

```bash
shellkeep deploy doctor --domain app.example.com      # read-only prerequisites
shellkeep deploy install --domain app.example.com     # first install
shellkeep deploy update                               # every later deploy
shellkeep deploy status                               # 0 healthy, 1 unhealthy, 2 nothing installed
```

ShellKeep serves behind the shared host proxy on loopback port **8323**: the stack binds `127.0.0.1:$APP_BIND_PORT`, and the platform's default for that variable is 3535, so pass `--port 8323` or answer `APP_BIND_PORT=8323` (`--answer APP_BIND_PORT=8323`). The deployment lives in `/opt/infra/apps/shellkeep` (`--root` or `--name` choose another).

The exit codes that matter for scripting: `0` success; `1` a step failed, or `status` found it unhealthy; `2` usage error or nothing installed where asked; `6` a required `doctor` check failed before anything was changed.

### Checks ShellKeep adds to `doctor`

| Id | Severity | What it checks |
|---|---|---|
| `docker-network-devnet` | recommended | The external `devnet` network the stack joins exists (a warning: install creates it) |
| `tmux-on-api-image` | recommended | `tmux -V` runs in the running `api` container. Skipped before the stack runs. The api image does not install tmux today (a session's tmux runs on the target server), so this reports a failure until the image does; it never blocks an install |
| `ssh-egress` | recommended | The `api` container can open a TCP connection to `SSH_EGRESS_TEST_HOST` (`host` or `host:port`, set in `infra/compose/.env`). Skipped when unset |

### Streaming routes at the host proxy

The VPS host proxy must not buffer or time out the routes the inner nginx already streams: `/api/terminal/ws`, `/api/runbook-runs` and `/api/ai/terminal` (`proxy.streamPaths` in `src/app.ts`, matching `infra/nginx/app.d/locations/`). They are written without a trailing slash on purpose: nginx answers a request for a proxied prefix location's URI without its slash with a 301.

### Adopting an existing install

Servers deployed before the CLI used `infra/deploy/install-shellkeep.sh` and `update.sh` (removed; the old runbook's prose lives here now). They leave `/opt/infra/apps/shellkeep` with a `repo/` checkout, a `.env`, a generated `compose.yml` and `shellkeep.conf`, and no state file. The CLI adopts that layout:

1. Install the CLI on the server (as root: `curl ... | sudo bash`).
2. Keep the existing `.env`. Add `APP_BIND_PORT=8323` (the loopback port the scripts bound), and `SSH_EGRESS_TEST_HOST=` if you want that check.
3. `shellkeep deploy list` shows the deployment as `inferred` (reconstructed from `.env`, with port 8323) and writes nothing.
4. `shellkeep deploy install --root /opt/infra/apps/shellkeep --domain <domain> --port 8323` points the pipeline at the existing `repo/` checkout and `.env`; it writes `.appctl-deploy.json`. That file name is fixed by the platform and is expected here.
5. Later deploys are `shellkeep deploy update`. The old `compose.yml` and `shellkeep.conf` are no longer used; the pipeline runs the compose files under `repo/infra/compose/` and publishes the proxy vhost itself.

This procedure reads the layout the scripts left and was exercised against a fixture of it (`src/deploy-adoption.test.ts`: discovery, the port read from `.env`, nothing written by looking), not against a live stack. The full cutover (backup, rehearsal, compose project names that must keep their volumes, rollback) is the cutover runbook, issue #84; do not skip it on a server with data.

**Rolling back to the scripts.** Revert the CLI change and restore `infra/deploy/*.sh` from that commit; a server deployed with the CLI keeps running. To return to the scripts, run `update.sh` from the restored checkout: it ignores `.appctl-deploy.json`.

### Configuration reference

The variables the deploy wizard asks about come from `infra/compose/.env.example`, generated by `npm run platform:infra:sync` from the platform's variables and then `infra/compose/app.env.example` (ShellKeep's own: `COMPOSE_PROJECT_NAME`, `NGINX_PORT`, `ENCRYPTION_KEY`, `SSH_EGRESS_TEST_HOST`). `src/extensions/env-spec.ts` carries their metadata. Storage, AI, Web Push and SMTP are configured at runtime in the admin UI, never in `.env` ([storage-configuration.md](../../docs/runbooks/storage-configuration.md)).

### Operating a deployment

```bash
docker compose -f /opt/infra/apps/shellkeep/repo/infra/compose/base.compose.yml -f /opt/infra/apps/shellkeep/repo/infra/compose/vps.compose.yml --env-file /opt/infra/apps/shellkeep/.env logs -f api
```

Database backups, restore and the one-time SSH secret re-encryption are admin-page and runbook procedures: [database-backup-restore.md](../../docs/runbooks/database-backup-restore.md), [ssh-secret-reencryption.md](../../docs/runbooks/ssh-secret-reencryption.md). A manual `pg_dump` must carry both `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on`, or the archive holds no org-table rows.

## Running a worker node

`shellkeep node enroll | register | start | stop | status | logs | doctor` are the platform's worker engine. ShellKeep registers no node executor yet: no ShellKeep job type is node-eligible (it would carry `nodeResultSchema` and `persistNodeResult`), so a node has nothing of ShellKeep's to run. A node never persists a job-scoped credential.

## Environment variables

| Variable | Meaning |
|---|---|
| `SHELLKEEP_SERVER_URL`, `SHELLKEEP_TOKEN` | Override the stored login, per field (CI) |
| `SHELLKEEP_NO_UPDATE_CHECK=1` | No start-up update notice |
| `SHELLKEEP_NO_TUI=1` | No interactive menu |
| `SHELLKEEP_DEBUG=1` | `sessions attach` logs frame sizes and types to stderr |

Worker variables (`SHELLKEEP_NODE_*`) are the platform's.

## Development

```bash
npm run build --workspace=cli && node apps/cli/dist/cli.js --help
npm run typecheck --workspace=cli
npm run test:run --workspace=cli
npm run test:infra          # just the infra conformance (compose config per mode, nginx -t)
```

The tests include the platform's conformance suites (`cli`, `deployRegistrations`, `tui`), the pinned `--help` of the ShellKeep commands (`UPDATE_HELP_SNAPSHOT=1` rewrites `src/__snapshots__/help-snapshot.json`; review the diff), a fake terminal gateway for `sessions attach`, and the adoption fixture. The version lives only in `apps/cli/package.json`; bump it per [AGENTS.md](AGENTS.md).
