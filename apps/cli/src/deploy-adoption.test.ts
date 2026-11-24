import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEPLOY_STATE_FILENAME } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApp } from './run.js';

// =============================================================================
// Adopting an install made by infra/deploy/install-shellkeep.sh  (issue #72)
// =============================================================================
//
// `infra/deploy/*.sh` are gone; `shellkeep deploy update --root
// /opt/infra/apps/shellkeep` adopts what they left: the `repo/` checkout and a
// `.env` (which names APP_BIND_PORT=8323). `deploy install` refuses that layout
// (#149). The platform writes `.appctl-deploy.json`, a literal it fixes.
//
// This fixture is the shape the scripts left (no state file at all) and proves
// the read-only side of the cutover: the existing layout is recognised, its
// port is read from the existing `.env`, and nothing is written by looking.
// What it cannot prove is a full `deploy update` against a
// running stack (Docker, a database and a proxy); the procedure is in
// apps/cli/README.md, "Adopting an existing install", and the full cutover is #84.
// =============================================================================

let work: string;
let appsRoot: string;
let root: string;
let stdout: string;
let stderr: string;
let dockerLog: string;
let fetchCalls: string[];

// `deploy status` is the platform's own command and `createCli` registers it
// with no injection seam, so it runs the real `docker compose ps` (through
// `PATH`) and the real `fetch` (through `globalThis`) against localhost. On a
// machine with Docker that is a daemon round trip plus three 10 s-timeout
// probes, which is slower than vitest's 5 s per test. These two stand-ins make
// the fixture's truth ("nothing is running") the only thing the test depends on:
// a `docker` that reports no containers and records each call, and a `fetch`
// that is refused the way a closed port is.
function installFakeDocker(dir: string): void {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  dockerLog = join(dir, 'docker-calls.log');
  const script = join(bin, 'docker');
  writeFileSync(script, `#!/bin/sh\necho "$@" >> '${dockerLog}'\nexit 0\n`);
  chmodSync(script, 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`);
}

function installRefusingFetch(): void {
  fetchCalls = [];
  vi.stubGlobal('fetch', async (url: unknown) => {
    fetchCalls.push(String(url));
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  });
}

beforeEach(() => {
  resetCliForTests();
  work = mkdtempSync(join(tmpdir(), 'shellkeep-adopt-'));
  installFakeDocker(work);
  installRefusingFetch();
  appsRoot = join(work, 'apps');
  root = join(appsRoot, 'shellkeep');
  mkdirSync(join(root, 'repo', '.git'), { recursive: true });
  mkdirSync(join(root, 'repo', 'infra', 'compose'), { recursive: true });
  writeFileSync(join(root, 'repo', 'infra', 'compose', '.env.example'), 'APP_BIND_PORT=3535\n');
  // What an operator has after the scripts, plus the one line adoption asks for.
  writeFileSync(join(root, '.env'), 'COMPOSE_PROJECT_NAME=shellkeep\nAPP_BIND_PORT=8323\nPOSTGRES_DB=shellkeep\n', { mode: 0o600 });

  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => ((stderr += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(work, { recursive: true, force: true });
  resetCliForTests();
});

describe('an install made by the old scripts', () => {
  it('the state file the deploy writes is the platform literal .appctl-deploy.json', () => {
    expect(DEPLOY_STATE_FILENAME).toBe('.appctl-deploy.json');
  });

  it('deploy list recognises the existing layout and reads 8323 from its .env', async () => {
    const code = await runApp(['deploy', 'list', '--apps-root', appsRoot, '--json']);

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as { deployments: Array<Record<string, unknown>> };
    expect(out.deployments).toHaveLength(1);
    expect(out.deployments[0]).toMatchObject({
      name: 'shellkeep',
      deployRoot: root,
      bindPort: 8323,
      source: 'inferred',
    });
  });

  it('looking writes nothing: no state file appears and .env is untouched', async () => {
    const env = readFileSync(join(root, '.env'), 'utf8');

    await runApp(['deploy', 'list', '--apps-root', appsRoot, '--json']);
    await runApp(['deploy', 'status', '--root', root, '--json']);

    expect(existsSync(join(root, DEPLOY_STATE_FILENAME))).toBe(false);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(env);
  });

  it('deploy status reports the stack as not running (nothing is up in the fixture) with a non-zero exit', async () => {
    const code = await runApp(['deploy', 'status', '--root', root, '--json']);

    expect(code).not.toBe(0);
    expect(JSON.parse(stdout.split('\n')[0] as string)).toMatchObject({ healthy: false });
    expect(stderr).toContain('not healthy');
    // Hermetic: the probes went to the stand-ins, and only they.
    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(readFileSync(dockerLog, 'utf8')).toContain('compose');
  });
});

describe('after the first deploy', () => {
  it('a deployment with a state file is read from its record', async () => {
    writeFileSync(
      join(root, DEPLOY_STATE_FILENAME),
      `${JSON.stringify(
        {
          version: 2,
          repoUrl: 'https://github.com/example-org/example-repo.git',
          ref: 'main',
          commitSha: '0123456789abcdef0123456789abcdef01234567',
          domain: 'app.example.test',
          bindPort: 8323,
          deployRoot: root,
          name: 'shellkeep',
          appsRoot,
          proxyRoot: join(work, 'proxy'),
          proxyContainer: 'proxy-nginx',
          envPath: join(root, '.env'),
          installedAt: '2026-11-01T10:00:00.000Z',
          lastDeployedAt: '2026-11-01T10:00:00.000Z',
          lastAttemptAt: '2026-11-01T10:00:00.000Z',
          lastCommand: 'install',
          lastOutcome: 'success',
          appctlVersion: '0.1.0',
          completedSteps: [],
        },
        null,
        2,
      )}\n`,
    );
    const before = readFileSync(join(root, DEPLOY_STATE_FILENAME), 'utf8');

    const code = await runApp(['deploy', 'list', '--apps-root', appsRoot, '--json']);

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as { deployments: Array<Record<string, unknown>> };
    expect(out.deployments[0]).toMatchObject({ name: 'shellkeep', bindPort: 8323, domain: 'app.example.test', source: 'record' });
    expect(readFileSync(join(root, DEPLOY_STATE_FILENAME), 'utf8')).toBe(before);
  });
});

// A `git` that never touches a network or a repository: it answers the few
// questions `deploy update` asks of the checkout (its origin, its revision) and
// records every call, so a test can say what was and was not run.
function installFakeGit(dir: string): string {
  const log = join(dir, 'git-calls.log');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const script = [
    '#!/bin/sh',
    `echo "$@" >> '${log}'`,
    'case "$*" in',
    '  *"remote get-url"*|*"remote.origin.url"*) echo https://example.test/org/repo.git;;',
    `  *rev-parse*) echo ${sha};;`,
    `  *ls-remote*) printf '${sha}\\tHEAD\\n';;`,
    'esac',
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'bin', 'git'), script, { mode: 0o755 });
  return log;
}

describe('adoption is `deploy update`, not `deploy install` (#149)', () => {
  it('install refuses the old scripts\' layout, names update, and writes nothing', async () => {
    const env = readFileSync(join(root, '.env'), 'utf8');

    const code = await runApp(['deploy', 'install', '--root', root, '--domain', 'app.example.test', '--non-interactive']);

    expect(code).toBe(2);
    expect(stderr).toContain('A deployment already exists');
    expect(stderr).toContain('no deployment record');
    expect(stderr).toContain('shellkeep deploy update');
    expect(existsSync(join(root, DEPLOY_STATE_FILENAME))).toBe(false);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(env);
    // Refused before anything was built or started.
    const calls = existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8') : '';
    expect(calls).not.toMatch(/compose .*(build|up)/);
  });

  it('update takes the same layout: it is the adoption entry, and it works on the existing checkout', async () => {
    const gitLog = installFakeGit(work);
    const env = readFileSync(join(root, '.env'), 'utf8');

    const code = await runApp([
      'deploy',
      'update',
      '--root',
      root,
      '--non-interactive',
      '--no-version-bump',
      '--skip-proxy',
    ]);

    expect(code, stderr).toBe(0);
    expect(stderr).not.toContain('A deployment already exists');
    expect(stderr).not.toMatch(/no deployment|nothing installed/i);
    // It ran the pipeline over repo/ (fetched the origin) instead of refusing.
    expect(stderr).toContain('Look for a new revision');
    expect(readFileSync(gitLog, 'utf8')).toContain('fetch --tags --force --prune origin');
    // The environment the operator kept is not rewritten by an update with nothing to deploy.
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(env);
  });
});
