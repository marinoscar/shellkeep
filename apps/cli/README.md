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

## Files

Reads and writes files on a server over SFTP, through the files API (the access of opening a terminal on that server: `sessions:write` plus the right to connect). `<server>` is a server profile **name** (exact, then case-insensitive) or id; a name that matches nothing or several profiles is exit 2. Nothing is buffered: downloads, uploads and `cat` move one chunk or window at a time.

| Command | API | Notes |
|---|---|---|
| `files ls <server> [path] [--all] [--long] [--json]` | `GET /api/server-profiles/:id/files` | `path` defaults to `~`. One name per line, folders with a trailing `/`; `--all` shows dotfiles; `--long` adds type and mode, size and modified time (UTC), and a link's target. `--json` is `{ path, truncated, entries[] }` |
| `files cat <server> <path> [--tail N \| --head N] [--json]` | `GET .../files/content` | Prints a text file window by window (the server caps a window; a file above its paged limit is refused). `--head` stops once it has N lines; `--tail` reads backwards from the end. A binary file (`FILE_IS_BINARY`) or one that is too large (`FILE_TOO_LARGE`) fails with exit 3 and a hint to use `get`. `--json` is one object per window (`{ path, offset, length, size, eof, text }`) |
| `files get <server> <path> [dest] [--force] [--json]` | `POST .../files/download-token`, `GET /api/files/download/:token` | Streams to disk. `dest` is a file, or an existing directory (the remote name is used); the default is the current directory. Refuses to replace a file without `--force` (exit 1). It is written to `.<name>.shellkeep-<hex>.part` next to the destination and renamed when complete, so a failed or short download leaves nothing. Progress goes to stderr on a terminal |
| `files put <server> <local> <remote-dir> [--name N] [--overwrite] [--json]` | `POST .../files/upload` | Streams the file as `application/octet-stream` with its length, with progress on a terminal. A name already taken is a 409: the error says to use `--overwrite` (exit 3). The server writes to a temp name and renames, so a reader never sees half a file |
| `files archive <server> <path> [dest] [--no-wait] [--force] [--timeout s] [--json]` | `POST .../files/archive`, `GET /api/files/archives/:id`, `.../download` | Starts the `files.archive` job for a folder, polls every 2 s (dots on a terminal) until it is ready, then downloads the `tar.gz` through the presigned storage URL (sent without your token, never printed). `--no-wait` prints the archive id and stops. A failed or expired archive, or `--timeout` (default 1800 s), is exit 1 (the build keeps going on the server) |

Exit codes are the CLI's: `0` success; `1` the command failed (destination exists, a short download, a failed archive); `2` usage (bad arguments, unknown or ambiguous server, no such local file); `3` the API answered with an error (not found, too large, binary, 409); `4` the server could not be reached; `5` log in again. The token never reaches argv, a URL printed by the command, or an error.

## Runbooks

Runs are queued on the server and executed over SSH by the runbook engine; the CLI starts them and reads their state. Every command has `--json`, which carries a fixed field list (no parameter values, no secret names, no hostnames).

| Command | API | Notes |
|---|---|---|
| `runbook list [--tag t] [--search text] [--filter all\|mine\|shared]` | `GET /api/runbooks` | Every page |
| `runbook run <id> [--targets <ids\|tag:x>] [--param NAME=value] [--secret-ref NAME=secret] [--runbook-version n] [--wait] [--interval s] [--timeout s]` | `POST /api/runbooks/:id/runs` | Queues the run and prints its id (exit 0 means *accepted*). With `--wait` it polls `GET /api/runbook-runs/:id` until the run ends and exits **0 only if the run and every target succeeded**; any other outcome, or `--timeout`, exits 1 (a timed-out run keeps going) |
| `runbook status <runId>` | `GET /api/runbook-runs/:id` | A servers x steps matrix in plain text. Read only: exit 0 whatever the run's status |
| `runbook logs <runId> [--target <server>] [--follow]` | step log routes, or the SSE routes with `--follow` | `--target` takes a server id or name. `--follow` streams until the run ends |

`--targets` is a comma-separated list of server profile ids and `tag:<name>` entries (`--targets 2f3c...,tag:staging`). Omit it to use the runbook's own default targets. `--param` values are typed from the runbook's definition (numbers and booleans are sent as such). A secret parameter takes the **name** of a stored runbook secret with `--secret-ref PARAM=name`; `--param` for a secret parameter is refused, so a secret value never appears in argv or shell history.

`--dry-run` rehearses a run (#67): the server connects to every target (host key and credential verified as for a real run) and checks every step with read-only probes: syntax, that the binaries exist, the package manager's own simulation, that the destination is writable. Nothing that changes a server is executed. The command sends `dryRun: true`, always waits for the dry run to end, prints a servers x steps plan (`would_run`, `precondition_failed`, `not_simulated`) and exits 0 only if every target would run cleanly (1 otherwise); `--json` is the run plus a `plan` array. A runbook with a destructive step needs no confirmation for a dry run, but a real run of one is answered `428 RUNBOOK_CONFIRMATION_REQUIRED` and, unless self-approval is on, waits for a second person's approval; the CLI does not send that confirmation, so launch such a run from the web app.

### `runbook logs --follow`

It reads `GET /api/runbook-runs/:id/logs/stream` (the per-server route with `--target`) with a `fetch` reader, because the stream needs `Authorization: Bearer`, which `EventSource` cannot send. Output is already redacted by the server. With several servers each line is prefixed `[server] `; `--json` prints one object per chunk instead.

If the connection drops, it reconnects with `Last-Event-ID` set to the last chunk it printed (`<stepRowId>:<seq>`), so nothing is repeated or lost; it waits 1 s, doubling to 10 s, and gives up with exit 1 after six attempts in a row that deliver nothing. A 4xx answer (not logged in, no access) is not retried. The first connection asks for every chunk the server still holds, so a late `--follow` sees the run so far. A run that has already ended is printed from its stored logs, without a stream. Exit 0 means the stream ran to the end of the run; use `runbook status` or `runbook run --wait` for the run's outcome.

Behind the host proxy the stream route must not be buffered: `/api/runbook-runs` is one of the `proxy.streamPaths` below.

The TUI menu has a **Runs** screen: the latest runs with live status (polled every 3 s), enter opens a run's matrix, `r` refreshes.

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

ShellKeep serves behind the shared host proxy on loopback port **8323**: the stack binds `127.0.0.1:$APP_BIND_PORT`. The platform's own default for `--port` is 3535, so `shellkeep` adds `--port 8323` to `deploy install`, `deploy doctor` and `deploy status` when you pass none (`src/extensions/default-port.ts`, applied in `src/run.ts`); `--port N` and `--port=N` win. `deploy update` takes no `--port`: it keeps the `APP_BIND_PORT` the deployment's `.env` records. `install --reinstall` and `--resume` also keep the recorded port. The deployment lives in `/opt/infra/apps/shellkeep` (`--root` or `--name` choose another).

The VPS stack does not run the platform's `stack-agent` container: `vps.compose.yml` builds it from `apps/stack-agent/`, which this repository does not have, so `infra/compose/app.vps.no-stack-agent.compose.yml` switches it off (`src/infra-conformance.test.ts` pins that). The API still needs `STACK_AGENT_TOKEN` set, which the deploy generates; nothing listens for it, so the admin UI's telemetry redeploy action has no agent to call.

Step by step (a fresh server, the database role, updating, certificates, the layout and uninstalling): [docs/deployment/vps.md](../../docs/deployment/vps.md).

To build the CLI on a fresh Ubuntu or Debian server, run `bootstrap-vps.sh` (`curl -fsSLo bootstrap-vps.sh https://raw.githubusercontent.com/marinoscar/shellkeep/main/apps/cli/bootstrap-vps.sh && bash bootstrap-vps.sh`). It installs `gh` and Node when missing, builds the CLI from `/opt/infra/cli/shellkeep` with `install.sh`, creates `/opt/infra/apps`, then runs `deploy doctor`. Options `--repo` (default `marinoscar/shellkeep`), `--ref`, `--yes`, `--no-tui`, `--update` (pull and rebuild the CLI) and `--dry-run`.

### Command reference

| Command | Does |
|---|---|
| `deploy doctor [--domain d]` | Read-only prerequisite checks, plus the ShellKeep checks below |
| `deploy install [--domain d]` | First install: clone, wizard, role, build, migrate, seed, start, proxy and certificate, renewal, verify. `--non-interactive --answers-file f` for unattended; `--skip-proxy` for no proxy and no certificate |
| `deploy update [--check [--json]]` | Move to the latest revision. `--check` (ShellKeep's) only reports `current`, `latest`, `commitsBehind`, `commits` and `checkedAt`, and changes nothing. `--no-version-bump` for a server that cannot push |
| `deploy status [--json]` | Health and migration state |
| `deploy list`, `deploy about [--json]` | The deployments on this server; the record in `deploy-info/info.json` |
| `deploy certs [--renew]` | Report, or renew inside the 30-day window |
| `deploy uninstall [--dry-run] --confirm <name>` | Remove a deployment. `--confirm` (ShellKeep's) takes the deployment's own name and is required for a real run; `.env` is first copied to `<apps-root>/<name>.env.<timestamp>.bak` (mode 0600), because it holds `SECRETS_ENCRYPTION_KEY` |

`--check` and `--confirm` are handled before the platform parses the command (`src/extensions/deploy-args.ts`), so they do not appear in `deploy --help`.

The exit codes: `0` success; `1` a step failed, or `status` found it unhealthy; `2` usage error, nothing installed where asked, or `uninstall` without `--confirm`; `3` the server answered with a non-2xx status; `4` it could not be reached; `5` the credential is missing or was rejected (log in again); `6` a required `doctor` check failed before anything was changed. `update --check` exits 0 whether or not an update is waiting, 2 when no deployment is found, 1 when git fails.

### Checks ShellKeep adds to `doctor`

| Id | Severity | What it checks |
|---|---|---|
| `docker-network-devnet` | recommended | The external `devnet` network the stack joins exists (a warning: install creates it) |
| `tmux-on-api-image` | recommended | `tmux -V` runs in the running `api` container. Skipped before the stack runs. The api image does not install tmux today (a session's tmux runs on the target server), so this reports a failure until the image does; it never blocks an install |
| `ssh-egress` | recommended | The `api` container can open a TCP connection to `SSH_EGRESS_TEST_HOST` (`host` or `host:port`, set in `infra/compose/.env`). Skipped when unset |

### Streaming routes at the host proxy

The VPS host proxy must not buffer or time out the routes the inner nginx already streams: `/api/terminal/ws`, `/api/runbook-runs` and `/api/ai/terminal` (`proxy.streamPaths` in `src/app.ts`, matching `infra/nginx/app.d/locations/`). They are written without a trailing slash on purpose: nginx answers a request for a proxied prefix location's URI without its slash with a 301.

### Adopting an existing install

Servers deployed before the CLI used `infra/deploy/install-shellkeep.sh` and `update.sh` (removed; the old runbook's prose lives here now). They leave `/opt/infra/apps/shellkeep` with a `repo/` checkout, a `.env`, a generated `compose.yml` and a proxy vhost `/opt/infra/proxy/nginx/conf.d/shellkeep.conf`, and no state file. Adoption is **`deploy update`**, not `deploy install`: `install` refuses a directory that already holds a deployment ("A deployment already exists"), while `update` rebuilds the missing record from the checkout and the `.env` and then deploys.

Take a database backup first and read the cutover runbook (issue #84); do not skip either on a server with data.

1. Install the CLI on the server (as root: `curl ... | sudo bash`).
2. Keep the existing `.env`. Check that it has `APP_BIND_PORT=8323` (the loopback port the scripts bound; the adopted record falls back to 3535 when the file names none), and add `SSH_EGRESS_TEST_HOST=` if you want that check. Keep its `SECRETS_ENCRYPTION_KEY` (see the warning below).
3. `shellkeep deploy list` shows the deployment as `inferred` (reconstructed from `.env`, with port 8323) and writes nothing.
4. Run the update against the existing layout:

   ```bash
   shellkeep deploy update --root /opt/infra/apps/shellkeep --no-version-bump
   ```

   It writes `.appctl-deploy.json` (a name fixed by the platform), runs the compose files under `repo/infra/compose/` and publishes the new vhost `conf.d/<domain>.conf` (the domain comes from `APP_URL`). Add the flags below as the situation needs.
5. Remove the old vhost, **after** the update succeeded: `rm /opt/infra/proxy/nginx/conf.d/shellkeep.conf`, then reload the proxy (`docker exec <proxy-container> nginx -s reload`, or `nginx -s reload` for a host nginx). The engine only ever writes and removes `<domain>.conf`; it does not know the old file. Both vhosts have the same `server_name`, nginx keeps the first one it reads (`shellkeep.conf` sorts before `<domain>.conf`) and ignores the other with only a warning, so until the old file is gone the new vhost, its stream paths and its renewals have no effect, silently. Removing it after the update (not before) keeps the site served by the old vhost, on the same port 8323, until the new one is validated by `nginx -t` and in place; if the update fails, nothing was lost.
6. Later deploys are `shellkeep deploy update`. The old `compose.yml` is no longer used.

Flags that adoption usually needs:

- **`--no-version-bump`** when the server cannot push to the repository. Without it the update bumps the patch version in `apps/api`, `apps/web` and `packages/shared`, commits and pushes the bump, which a server without push access to the repository cannot do.
- **Database role consent.** The platform wants the API to connect as an ordinary role that owns the tables (row-level security does not apply to a superuser). If `.env` names a superuser login, the update asks to create the role (`<app>_app`, or `--app-db-user`). Unattended, pass the consents: `--provision-app-role` (create the role), `--transfer-ownership` (move ownership of the existing database's objects to it) and `--admin-user <login>` for the administrative login that does it, with its password in the environment variable `SHELLKEEP_DB_ADMIN_PASSWORD` (never a flag). `--skip-role-provisioning` creates no role and requires `POSTGRES_USER` to be an ordinary role already; `--allow-superuser` keeps a superuser login and turns tenant isolation off.
- **`--non-interactive`** never prompts and fails listing anything unresolved, so supply what the prompts would: `--answer KEY=value` (repeat) or `--answers-file`. It needs `--answer SECRETS_ENCRYPTION_KEY=<the value already in .env>`.

> **Warning: `SECRETS_ENCRYPTION_KEY` decrypts every stored SSH credential** (server-profile passwords and keys, and every other credential kept in the encrypted store). Replace it, or let a deploy generate a new one, and all of them become permanently unreadable, with no error until someone connects. Copy the existing value from `.env` into the answer, and keep it in a place that survives the server. A blank answer never overwrites the value on disk.

The terminal WebSocket through the host proxy also needs a platform change (marinoscar/EnterpriseAppBase#1222, fix in progress): until it ships, `/api/terminal/ws` does not work through the host proxy even though the deploy itself succeeds.

This procedure reads the layout the scripts left and was exercised against a fixture of it (`src/deploy-adoption.test.ts`: discovery, the port read from `.env`, `install` refusing the layout, `update` taking it, nothing written by looking), not against a live stack. The cutover runbook is issue #84.

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

The tests include the platform's conformance suites (`cli`, `deployRegistrations`, `tui`), the pinned `--help` of the ShellKeep commands (`UPDATE_HELP_SNAPSHOT=1` rewrites `src/__snapshots__/help-snapshot.json`; review the diff), a fake terminal gateway for `sessions attach`, a fake runbook API and SSE server for `runbook` (exit codes, reconnect with `Last-Event-ID`), a stub HTTP server for `files` (`src/__support__/files-stub.ts`: real sockets, so streaming and bodies are real), and the adoption fixture. The version lives only in `apps/cli/package.json`; bump it per [AGENTS.md](AGENTS.md).
