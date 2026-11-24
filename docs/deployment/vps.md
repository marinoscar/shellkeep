# Runbook: deploy ShellKeep to a VPS

How to put ShellKeep on a server with the `shellkeep` CLI, keep it updated and take it off again. The CLI is [`@marinoscar/platform-cli`](https://www.npmjs.com/package/@marinoscar/platform-cli) (pinned `0.1.0-next.39`) composed with ShellKeep's identity; its `deploy` group is the whole pipeline, there is no deploy script. Flag-level reference and exit codes: [apps/cli/README.md](../../apps/cli/README.md#deploying-to-a-server). The host proxy and the terminal WebSocket: [ssl-nginx-setup.md](../ssl-nginx-setup.md). Examples use `app.example.test`.

Run every command below as `root` on the server.

## What is verified

`.github/workflows/deploy-e2e.yml` runs the real pipeline on a GitHub runner: doctor, an unattended install (answers file, `--skip-proxy`, the 8323 default), the layout, a loopback-only bind, `/api/health/ready`, a WebSocket upgrade through the inner nginx, status, `update --check`, a no-op and a real update, about, and the guarded uninstall. It deliberately does **not** cover the host proxy and the certificate (a runner has no public DNS), so the sections on the proxy and certificates below are the platform's documented behaviour, not something ShellKeep's CI exercises.

## 1. Prerequisites

`shellkeep deploy doctor` checks them; run it first and fix what it reports (it is read-only and safe on a live server).

- An Ubuntu or Debian server you operate as root.
- Docker Engine with the **Compose v2 plugin** (`docker compose`). `bootstrap-vps.sh` never installs Docker; it prints the apt commands and stops.
- git, curl and Node.js 20 or later, to build the CLI. The bootstrap script installs Node when it is missing (it asks first).
- The GitHub CLI `gh`, logged in, when the repository is private: `install` and `update` clone and fetch with it. The bootstrap script installs it and runs the login.
- The external `devnet` Docker network. `install` creates it; `doctor` reports its absence as a warning.
- A shared reverse proxy under `/opt/infra/proxy`. If this is the first application on the box, `install --bootstrap-proxy` creates it; otherwise it reuses the existing one. A host nginx works too (`--proxy-mode host`).
- A DNS A record for the domain pointing at this server **before** `install`: a failed certificate issuance spends Let's Encrypt rate-limit budget.
- An external PostgreSQL server you hold credentials for. The stack ships no database. The database itself may be missing: `--create-database` creates it.
- Google OAuth credentials whose redirect URI is `https://<domain>/api/auth/google/callback`.
- Outbound SSH from the server to the machines users will connect to (the `ssh-egress` doctor check proves it when `SSH_EGRESS_TEST_HOST` is set).

## 2. A fresh server

```bash
curl -fsSLo bootstrap-vps.sh https://raw.githubusercontent.com/marinoscar/shellkeep/main/apps/cli/bootstrap-vps.sh
bash bootstrap-vps.sh            # --repo defaults to marinoscar/shellkeep; a fork passes its own
```

Six printed steps: preconditions, `gh` (the one interactive step is its login), Node.js, the CLI checkout, the deploy folder, then `shellkeep deploy doctor` and the menu. The CLI is built from `/opt/infra/cli/shellkeep` with the repository's own `install.sh` and its shim goes to `/usr/local/bin/shellkeep`. That checkout is deliberately separate from the deployment's own clone (`/opt/infra/apps/shellkeep/repo`): the running CLI never rebuilds itself in the middle of a deploy. Options: `--ref <branch>`, `--yes` (install Node without asking), `--no-tui` (print the next command instead of the menu), `--update`, `--dry-run` (prints every command, runs none, probes nothing). Re-running is a no-op. Exit codes: 0 done, 1 a step failed, 2 usage.

Without the script, `install.sh` alone installs the CLI: `curl -fsSL https://raw.githubusercontent.com/marinoscar/shellkeep/main/install.sh | bash`.

## 3. Install

Run from `/opt/infra/cli/shellkeep` (or any checkout of the repository: the repository and ref to deploy default to that checkout's `origin` and the remote's default branch).

```bash
shellkeep deploy doctor --domain app.example.test
shellkeep deploy install --domain app.example.test
```

The wizard asks for the database, the OAuth client and the administrator, and generates the secrets. It builds the images, migrates, seeds, starts the stack, waits for health, issues the certificate, publishes the vhost, schedules renewal and verifies that sign-in redirects to Google with your client. ShellKeep serves on loopback **8323**: the platform's own `--port` default is 3535, so `shellkeep` adds `--port 8323` to `install`, `doctor` and `status` when you pass none (`apps/cli/src/extensions/default-port.ts`).

Unattended: `--non-interactive --answers-file <file>` (a `KEY=value` file; repeat `--answer KEY=value`). The wizard cannot generate the secrets without a prompt, so supply `JWT_SECRET`, `COOKIE_SECRET` and `SECRETS_ENCRYPTION_KEY` yourself. `.github/e2e/answers.env` is a worked example (placeholders only).

After the install, sign in once as `INITIAL_ADMIN_EMAIL` and add the other users to the allowlist before anyone else tries.

## 4. The database role

Row-level security does not apply to a superuser, so the API must connect as an ordinary role that owns the tables. If the login you give the wizard is a superuser, `install` creates `<app>_app` (`shellkeep_app`, or `--app-db-user`), saves its generated password in `.env` only, and `--show-credentials` prints it once. Unattended, give the consents: `--provision-app-role`, and `--transfer-ownership` for an existing database, with `--admin-user <login>` and the password in `SHELLKEEP_DB_ADMIN_PASSWORD` (never a flag). `--skip-role-provisioning` creates nothing and requires an ordinary `POSTGRES_USER`; `--allow-superuser` keeps the superuser and turns tenant isolation **off**. The operator SQL is `apps/api/prisma/sql/create-app-role.sql`.

## 5. Updating: the CLI first, then the app

Two things are installed, each with its own update command; `deploy update` never touches the CLI. A new revision can need a newer CLI, so update the CLI first.

| What | Where | Updated by |
|---|---|---|
| The CLI | `/opt/infra/cli/shellkeep` | `git -C /opt/infra/cli/shellkeep pull --ff-only`, then `bash /opt/infra/cli/shellkeep/apps/cli/bootstrap-vps.sh --update` |
| The application | `/opt/infra/apps/shellkeep/repo` | `shellkeep deploy update` |

```bash
shellkeep --version
shellkeep deploy update --check          # what an update would bring; changes nothing
shellkeep deploy update
```

`--check [--json]` fetches the recorded ref (or `--ref`) into the deployment's clone and prints `current`, `latest`, `commitsBehind`, the newest commits and `checkedAt`. It exits 0 whether or not there is anything to apply. An update with nothing to apply exits 0 and rebuilds nothing, so it is safe from cron.

**The version step.** A real update (and install) patch-bumps the version in `apps/api`, `apps/web` and `packages/shared` (never the CLI), writes it to `APP_VERSION` in `.env`, commits the bump and **pushes it to the repository**. A server without push access to the repository cannot do that: pass **`--no-version-bump`** to deploy the current version with no write, no commit, no push, or `--app-version <x.y.z>` to choose one. `--maintenance` serves a 503 from before the build until just after the restart.

The seed re-runs on every update (idempotent); it is how a release's new permissions reach an existing deployment. There is no automatic roll-back: on failure the previous revision and the command to redeploy it are printed.

## 6. Adopting a server installed by the old scripts

Servers installed with `infra/deploy/install-shellkeep.sh` and `update.sh` (removed) have a `repo/` checkout, a `.env`, a `compose.yml`, a vhost `/opt/infra/proxy/nginx/conf.d/shellkeep.conf` and no state file. Adoption is **`deploy update`**, not `install` (which refuses an existing deployment). The procedure, with the `SECRETS_ENCRYPTION_KEY` and database role consents it needs, is in [apps/cli/README.md#adopting-an-existing-install](../../apps/cli/README.md#adopting-an-existing-install): back up the database first, run `shellkeep deploy update --root /opt/infra/apps/shellkeep --no-version-bump`, then remove the old vhost **after** it succeeded.

## 7. Certificates and renewal

The proxy owns the certificate; the CLI drives it.

```bash
shellkeep deploy certs                   # report, change nothing
shellkeep deploy certs --renew           # renew only inside the 30-day window
shellkeep deploy certs --renew --force   # renew now (spends rate-limit budget)
```

`install` and `update` schedule renewal themselves unless something already renews the certificates on the host; `--skip-renewal` opts out. `--staging` uses Let's Encrypt staging while you work out the setup (its certificates are not browser-trusted). `uninstall` never removes the certificate (five duplicates per week is the limit) nor the renewal entry.

## 8. Layout and secrets

```
/opt/infra/apps/shellkeep/
  repo/                          the deployment's own clone
  repo/infra/compose/.env        the environment file, 0600, git-ignored
  logs/                          the run journal (newest ten runs, 0600, secrets redacted)
  deploy-info/info.json          what the API reads about itself (not secret)
  .appctl-deploy.json            the deploy record, 0600 (a name fixed by the platform)
```

A server adopted from the old scripts keeps its `.env` at the app folder's root; the platform reads either location.

> **`SECRETS_ENCRYPTION_KEY` decrypts every stored SSH credential** (server-profile passwords and keys, and everything else in the encrypted store). Replace it, or let a deploy generate a new one, and all of them become permanently unreadable, with no error until someone connects. Keep a copy somewhere that survives the server. A blank answer never overwrites the value on disk.

## 9. Logs

```bash
docker logs -f --tail 100 shellkeep-api-1     # also shellkeep-web-1, shellkeep-nginx-1
```

Containers are named `<app>-<service>-1` (the compose project is the deployment's name). The deploy journal for each run is under `logs/`. The VPS stack runs no `stack-agent` container (`app.vps.no-stack-agent.compose.yml`); the admin UI's telemetry redeploy action has no agent to call.

## 10. Uninstalling

```bash
shellkeep deploy uninstall --dry-run                       # what would go and what stays
shellkeep deploy uninstall --confirm shellkeep             # --confirm takes the deployment's name
```

This CLI adds two safeguards the platform's command lacks. A real uninstall requires `--confirm <name>` (the deployment's own name; dry runs and `--help` are unaffected). Before anything is removed, `.env` is copied to `/opt/infra/apps/shellkeep.env.<timestamp>.bak` (mode 0600), because it holds `SECRETS_ENCRYPTION_KEY`; keep that copy if you will ever restore the database. `uninstall` removes the containers and volumes, the clone, the vhost, the logs, the environment file and the record. It always keeps the shared network, the shared proxy, the certificate and the renewal entry. The database and storage objects stay unless you pass `--drop-database` or `--purge-storage` and type that resource's own name (`--confirm-database`, `--confirm-bucket`).

## 11. The terminal WebSocket through the host proxy

The inner nginx forwards `/api/terminal/ws` correctly (the e2e workflow proves it: `101`, then the gateway's `auth_fail` for an unauthenticated socket). Through the **host** proxy the platform still needs a change, marinoscar/EnterpriseAppBase#1222 (fix in progress): until it ships, `/api/terminal/ws` does not work through the host proxy even though the deploy itself succeeds. Check from outside with `curl --http1.1 -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://app.example.test/api/terminal/ws` (expect `101 Switching Protocols`).

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `doctor` exits 6 | A required check failed and nothing was changed. Read the report, fix it, re-run |
| `uninstall` exits 2 asking for `--confirm` | By design: pass the deployment's name, after `--dry-run` |
| `update --check` says "No deployment record" | The deployment has no `.appctl-deploy.json` yet (an adopted server). Run `deploy update` once, or pass `--root` |
| `update --check` says it cannot fetch | The clone's `origin` is private and `gh` is logged out; run `gh auth login` and `gh auth setup-git` |
| The update fails at "version" or on a push | The server cannot push the version bump. Use `--no-version-bump` |
| `Several deployments are installed` | Pass `--name` (or `--root`), or run from inside the deployment |
| The app answers on 3535 | The deployment was installed with the platform's default; set `APP_BIND_PORT=8323` in `.env` and update, or pass `--port 8323` to `install` |
| The terminal drops after about a minute behind the host proxy | The proxy buffers or times out the WebSocket; see section 11 and [ssl-nginx-setup.md](../ssl-nginx-setup.md) |
| `docker compose` not found | The v1 binary is installed; install the Compose v2 plugin |
| Every stored server profile asks for its credentials again | `SECRETS_ENCRYPTION_KEY` changed; restore it from the `.env` backup |
