import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { githubRawManifest, type CreateCliOptions } from '@marinoscar/platform-cli';
import { APP_NAME, CLI_NAME, REPO_SLUG } from '@shellkeep/shared';

import { dockerNetworkCheck } from './extensions/docker-network.check.js';
import { SHELLKEEP_ENV_SPEC } from './extensions/env-spec.js';
import { sshEgressCheck } from './extensions/ssh-egress.check.js';
import { tmuxCheck } from './extensions/tmux.check.js';

// =============================================================================
// ShellKeep's CLI, composed on the platform engine  (issue #72)
// =============================================================================
//
// `createCli()` with this file's options. Every platform command (`init`,
// `login`, `api`, `config`, `node`, `deploy`), the TUI, the deploy pipeline and
// the worker-node engine are `@marinoscar/platform-cli`'s; this app adds only
// what the platform does not have:
//
//   - `servers` and `sessions`: commands over the API (`extraCommands`, one
//     file each under src/commands/), plus their TUI screens (`tuiScreens`);
//   - the metadata of the `.env.example` keys that are ShellKeep's own
//     (`envSpecFragments`) and help for the platform's `APP_BIND_PORT`;
//   - deploy checks: `docker-network-devnet`, `tmux-on-api-image`, `ssh-egress`;
//   - the unbuffered, long-timeout locations the VPS host proxy needs for the
//     terminal WebSocket and the streaming routes (`proxy.streamPaths`);
//   - the manifests the deploy version step versions, never this package;
//   - the start-up "newer CLI available" notice.
//
// The binary name, the config directory (`~/.shellkeep`), the environment
// prefix (`SHELLKEEP_`) and the systemd unit all derive from `CLI_NAME`
// (`cliName` in packages/shared/identity.json). The deploy state file
// (`.appctl-deploy.json`) and the proxy sentinel are the platform's fixed
// literals on purpose: a server deployed by any version of this CLI keeps being
// read.
//
// `nodeExecutors` is empty: no ShellKeep job type is node-eligible yet (it
// would carry `nodeResultSchema` and `persistNodeResult`; the session reaper,
// `terminal.session.reap`, writes as it goes and needs the database). The
// runbook engine's job types may add executors when they declare themselves
// eligible.
// =============================================================================

/**
 * The package version, read at runtime from `apps/cli/package.json`, the only
 * place it lives.
 *
 * Not `import pkg from '../package.json'`: that widens tsc's root, emits
 * `dist/src/*.js` and breaks the `bin` path. Both `src/app.ts` (tsx, vitest)
 * and `dist/app.js` (the built CLI) sit one directory below the package root,
 * so `../package.json` resolves in both; nothing here may move into a
 * subdirectory without revisiting that.
 *
 * It feeds `--version`, the User-Agent of every request and the
 * `appctlVersion` field of a deployment's state file.
 */
export function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    // An unusual install is not a reason to refuse to run: a placeholder
    // version beats a stack trace at startup.
  }
  return '0.0.0-unknown';
}

/**
 * Routes the VPS host proxy must stream (no buffering, long timeout): the same
 * routes `infra/nginx/app.d/locations/` gives the inner nginx.
 *
 *   - `/api/terminal/ws`: the terminal WebSocket (`terminal-ws.conf`);
 *   - `/api/runbook-runs`: the runbook run log streams (`runbook-streams.conf`);
 *   - `/api/ai/terminal`: the terminal AI assistant streams (`ai-terminal-streams.conf`).
 *
 * NO TRAILING SLASH. nginx answers a request for a proxied prefix location's
 * URI without its trailing slash with a 301 to the slash form, which turns
 * `GET /api/runbook-runs?limit=20` into `/api/runbook-runs/?limit=20`; the API
 * reads that as a different route. The platform matches a location by PREFIX,
 * so the bare prefix still covers `/:id/logs/stream`.
 */
export const APP_STREAM_PATHS: readonly string[] = ['/api/terminal/ws', '/api/runbook-runs', '/api/ai/terminal'];

/**
 * The manifests the deploy version step writes the release version into.
 *
 * The CLI keeps its OWN version (`apps/cli/package.json`, recorded as
 * `appctlVersion` in deploy state and in the User-Agent), so `apps/cli` is
 * deliberately absent. The first entry is the version source.
 */
export const APP_VERSIONED_MANIFESTS: readonly string[] = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

/**
 * The one-liner that updates an installed CLI: the installer, re-run from `main`.
 * Derived from `REPO_SLUG` so a renamed fork points at its own `install.sh`.
 */
export const APP_UPGRADE_HINT = `curl -fsSL https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh | bash`;

/**
 * Where the start-up update notice reads the newest CLI version.
 *
 * `apps/cli/package.json` on `main` is the file `install.sh` installs from, so it
 * is exactly the version a re-run of the installer produces. The platform
 * prints the notice at most once a day, on stderr, and stays silent in CI,
 * without a TTY, with `--json`, and with `SHELLKEEP_NO_UPDATE_CHECK=1`.
 */
export const APP_UPDATE_NOTICE: NonNullable<CreateCliOptions['updateNotice']> = {
  latestVersion: githubRawManifest({ repo: REPO_SLUG, ref: 'main', path: 'apps/cli/package.json' }),
  upgradeHint: APP_UPGRADE_HINT,
};

export const APP_CLI_OPTIONS: CreateCliOptions = {
  identity: {
    name: CLI_NAME,
    displayName: `${APP_NAME} CLI`,
    productName: APP_NAME,
    repoSlug: REPO_SLUG,
  },
  version: readVersion(),
  nodeExecutors: [],
  envSpecFragments: [SHELLKEEP_ENV_SPEC],
  envAnnotations: {
    APP_BIND_PORT: {
      help: 'The loopback port the stack binds to behind the host reverse proxy. ShellKeep deployments use 8323.',
    },
  },
  deployChecks: [dockerNetworkCheck, tmuxCheck, sshEgressCheck],
  proxy: { streamPaths: APP_STREAM_PATHS },
  deploy: { versionedManifests: APP_VERSIONED_MANIFESTS },
  updateNotice: APP_UPDATE_NOTICE,
};
