import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// =============================================================================
// The root install.sh  (issue #72)
// =============================================================================
//
// `curl -fsSL .../install.sh | bash` installs the CLI from `main` into
// `$SHELLKEEP_HOME/cli` (`~/.shellkeep/cli` for a user, `/usr/local/lib/shellkeep/cli`
// for root) with a `shellkeep` shim in `$SHELLKEEP_BIN_DIR`. The install path
// clones, runs `npm install` and builds, so it is not run here; this suite pins
// what can be pinned offline: the script parses, the root-aware defaults, the
// help text, the uninstall (which must never touch config.json) and that no
// other product's name is left in it. The install path itself was exercised by
// hand with SHELLKEEP_SRC against a clean export of the repository.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = join(HERE, '..', '..', '..', 'install.sh');
const SOURCE = readFileSync(INSTALL_SH, 'utf8');

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'shellkeep-install-sh-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function bash(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', args, { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NO_COLOR: '1', ...env }, cwd: work });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('install.sh', () => {
  it('is valid bash', () => {
    expect(bash(['-n', INSTALL_SH], {}).status).toBe(0);
  });

  it('carries the ShellKeep identity and no other product or the old CLI name', () => {
    expect(SOURCE).toContain('https://github.com/marinoscar/shellkeep.git');
    expect(SOURCE).toContain('SHELLKEEP_HOME');
    expect(SOURCE).toContain('SHELLKEEP_BIN_DIR');
    expect(SOURCE).toContain('SHELLKEEP_SRC');
    expect(SOURCE).not.toMatch(/kvox|KVOX|appctl|APPCTL/);
  });

  it('installs the CLI workspace by path (its package name is "cli") into $SHELLKEEP_HOME/cli', () => {
    expect(SOURCE).toContain('CLI_DIR="$SHELLKEEP_HOME/cli"');
    expect(SOURCE).toContain('--workspace=apps/cli');
  });

  it('vendors the private @shellkeep/* workspace packages, since the install runs outside the monorepo', () => {
    expect(SOURCE).toContain('name.startsWith("@shellkeep/")');
    expect(SOURCE).toContain('file:./vendor/');
  });

  it('--help lists the SHELLKEEP_ variables and the defaults', () => {
    const { status, stdout } = bash([INSTALL_SH, '--help'], { HOME: work });
    expect(status).toBe(0);
    for (const name of ['SHELLKEEP_REPO', 'SHELLKEEP_REF', 'SHELLKEEP_HOME', 'SHELLKEEP_BIN_DIR', 'SHELLKEEP_SRC']) {
      expect(stdout).toContain(name);
    }
    expect(stdout).toContain('$HOME/.shellkeep');
  });
});

describe('install.sh defaults', () => {
  /** Runs just the root-aware defaults block with `id -u` stubbed. */
  function defaults(uid: number, home: string, overrides: Record<string, string> = {}): { home: string; binDir: string } {
    const start = SOURCE.indexOf('if [[ "$(id -u)" -eq 0 ]]; then');
    const end = SOURCE.indexOf('\nfi\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const fakeBin = join(work, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, 'id'), '#!/bin/sh\necho "$FAKE_UID"\n');
    chmodSync(join(fakeBin, 'id'), 0o755);
    const script = join(work, 'defaults.sh');
    writeFileSync(
      script,
      `set -euo pipefail\n${SOURCE.slice(start, end + 4)}\nprintf 'HOME=%s\\nBIN=%s\\n' "$SHELLKEEP_HOME" "$SHELLKEEP_BIN_DIR"\n`,
    );
    const { status, stdout, stderr } = bash([script], {
      PATH: `${fakeBin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: home,
      FAKE_UID: String(uid),
      ...overrides,
    });
    if (status !== 0) throw new Error(`defaults block failed: ${stderr}`);
    return { home: /HOME=(.*)/.exec(stdout)?.[1] ?? '', binDir: /BIN=(.*)/.exec(stdout)?.[1] ?? '' };
  }

  it('gives root the system locations and a user the home ones', () => {
    expect(defaults(0, '/root')).toEqual({ home: '/usr/local/lib/shellkeep', binDir: '/usr/local/bin' });
    expect(defaults(1000, '/home/user')).toEqual({ home: '/home/user/.shellkeep', binDir: '/home/user/.local/bin' });
  });

  it('lets an explicit SHELLKEEP_HOME or SHELLKEEP_BIN_DIR win on both branches', () => {
    expect(defaults(0, '/root', { SHELLKEEP_HOME: '/srv/sk', SHELLKEEP_BIN_DIR: '/srv/bin' })).toEqual({ home: '/srv/sk', binDir: '/srv/bin' });
    expect(defaults(1000, '/home/user', { SHELLKEEP_HOME: '/srv/sk', SHELLKEEP_BIN_DIR: '/srv/bin' })).toEqual({ home: '/srv/sk', binDir: '/srv/bin' });
  });
});

describe('install.sh --uninstall', () => {
  it('removes the CLI directory and the shim and leaves config.json alone', () => {
    const home = join(work, 'home');
    const bin = join(work, 'bin');
    mkdirSync(join(home, 'cli'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, 'cli', 'package.json'), '{}');
    writeFileSync(join(home, 'config.json'), '{"token":"pat_example"}');
    writeFileSync(join(bin, 'shellkeep'), '#!/bin/sh\n');

    const { status, stdout } = bash([INSTALL_SH, '--uninstall'], { HOME: work, SHELLKEEP_HOME: home, SHELLKEEP_BIN_DIR: bin });

    expect(status).toBe(0);
    expect(stdout).toContain('shellkeep CLI uninstalled');
    expect(existsSync(join(home, 'cli'))).toBe(false);
    expect(existsSync(join(bin, 'shellkeep'))).toBe(false);
    expect(readFileSync(join(home, 'config.json'), 'utf8')).toBe('{"token":"pat_example"}');
  });
});

// =============================================================================
// Template bundling and version verification  (issue #150, ported from KVox)
// =============================================================================
//
// The two blocks below are pulled out of the real install.sh and run against
// real git repositories and a stub shim, so the tests follow the script rather
// than a copy of it.
//
// WHAT IS TRUE ON @marinoscar/platform-cli 0.1.0-next.39: install.sh still copies
// infra/compose/.env.example to $CLI_DIR/template/ and records its origin in
// source.json, but nothing in the engine reads that copy any more (the wizard
// reads the cloned repository's generated .env.example; see the last test).
// The block is kept because it is harmless and an older engine reads it; the
// tests pin what it does, not a consumer.
// =============================================================================

const TEMPLATE_START_MARKER = 'TEMPLATE_SRC="$TMP_DIR/infra/compose/.env.example"';

function extractTemplateBlock(): string {
  const source = readFileSync(INSTALL_SH, 'utf8');
  const start = source.indexOf(TEMPLATE_START_MARKER);
  if (start === -1) {
    throw new Error(
      `install.sh no longer contains the expected "${TEMPLATE_START_MARKER}" line — ` +
        'the template-bundling block this test pins may have moved or been removed.',
    );
  }
  const closeMarker = '\nfi\n';
  const closeIdx = source.indexOf(closeMarker, start);
  if (closeIdx === -1) {
    throw new Error(
      'install.sh: could not find the closing (unindented) "fi" for the template-bundling block.',
    );
  }
  const end = closeIdx + closeMarker.length;
  return source.slice(start, end);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  }).trim();
}

/** A real git repository at a fresh temp directory, with one commit. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'install-sh-tmpdir-'));
  createdDirs.push(dir);
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'first');
  return dir;
}

function writeEnvExample(repoDir: string, contents = 'DATABASE_URL=postgres://placeholder\n'): void {
  const dir = join(repoDir, 'infra', 'compose');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.env.example'), contents);
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface TemplateBlockEnv {
  tmpDir: string;
  cliDir: string;
  shellkeepRepo: string;
  shellkeepRef: string;
  shellkeepSrc?: string;
}

interface TemplateBlockRun {
  stdout: string;
  status: number | null;
}

function runTemplateBlock(vars: TemplateBlockEnv): TemplateBlockRun {
  const workDir = mkdtempSync(join(tmpdir(), 'install-sh-template-run-'));
  createdDirs.push(workDir);

  const block = extractTemplateBlock();
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'err()  { printf "ERR: %s\\n" "$1"; }',
    'warn() { printf "WARN: %s\\n" "$1"; }',
    'ok()   { printf "OK: %s\\n" "$1"; }',
    block,
  ].join('\n');
  const scriptPath = join(workDir, 'run.sh');
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);

  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    TMP_DIR: vars.tmpDir,
    CLI_DIR: vars.cliDir,
    SHELLKEEP_REPO: vars.shellkeepRepo,
    SHELLKEEP_REF: vars.shellkeepRef,
    SHELLKEEP_SRC: vars.shellkeepSrc ?? '',
  };

  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env,
    cwd: workDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  return { stdout: result.stdout, status: result.status };
}

function readSourceJson(cliDir: string): { repoUrl: string; ref: string } {
  return JSON.parse(readFileSync(join(cliDir, 'template', 'source.json'), 'utf8')) as {
    repoUrl: string;
    ref: string;
  };
}

describe('install.sh bundles infra/compose/.env.example into $CLI_DIR/template (#150)', () => {
  it('copies the template and records $SHELLKEEP_REPO/$SHELLKEEP_REF for an ordinary clone (no SHELLKEEP_SRC)', () => {
    const tmpDir = makeRepo();
    git(tmpDir, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git');
    writeEnvExample(tmpDir, 'KEY=value\n');
    const cliDir = mkdtempSync(join(tmpdir(), 'install-sh-appdir-'));
    createdDirs.push(cliDir);

    const { stdout, status } = runTemplateBlock({
      tmpDir,
      cliDir,
      shellkeepRepo: 'https://github.com/example-owner/example-repo.git',
      shellkeepRef: 'v2.0.0',
    });

    expect(status).toBe(0);
    expect(readFileSync(join(cliDir, 'template', '.env.example'), 'utf8')).toBe('KEY=value\n');
    expect(readSourceJson(cliDir)).toEqual({
      repoUrl: 'https://github.com/example-owner/example-repo.git',
      ref: 'v2.0.0',
    });
    expect(stdout).toContain(
      'OK: Bundled the environment template from https://github.com/example-owner/example-repo.git',
    );
  });

  it('a SHELLKEEP_SRC install records the REAL origin URL, not the temp directory it was copied through', () => {
    // Simulates `SHELLKEEP_SRC=/path/to/checkout bash install.sh`: install.sh
    // copies SHELLKEEP_SRC into $TMP_DIR before this block runs, so $TMP_DIR is a
    // real git checkout whose origin is the operator's actual fork — never
    // the throwaway temp path. Recording that path instead would make the
    // bundled template useless to `bundledTemplateMatches` on every future
    // run, since the temp directory is deleted before install.sh exits.
    const tmpDir = makeRepo();
    git(tmpDir, 'remote', 'add', 'origin', 'https://github.com/kappa/widgets.git');
    git(tmpDir, 'checkout', '--quiet', '-b', 'feature-x');
    writeEnvExample(tmpDir);
    const cliDir = mkdtempSync(join(tmpdir(), 'install-sh-appdir-'));
    createdDirs.push(cliDir);

    runTemplateBlock({
      tmpDir,
      cliDir,
      // Deliberately a DIFFERENT repo than the real origin above: if this
      // value leaked into source.json instead of the real origin, this
      // assertion would catch it immediately.
      shellkeepRepo: 'https://github.com/should-not-be-used/anything.git',
      shellkeepRef: 'main',
      shellkeepSrc: '/some/local/checkout',
    });

    expect(readSourceJson(cliDir)).toEqual({
      repoUrl: 'https://github.com/kappa/widgets.git',
      ref: 'feature-x',
    });
  });

  it('falls back to $SHELLKEEP_REPO when the source tree is not a git checkout at all', () => {
    // `git -C "$TMP_DIR" remote get-url origin` fails outright (no .git),
    // guarded by `|| true`, so SRC_REPO_URL stays empty and the explicit
    // fallback (`[[ -n "$SRC_REPO_URL" ]] || SRC_REPO_URL="$SHELLKEEP_REPO"`) is
    // what the recorded value actually comes from.
    const tmpDir = mkdtempSync(join(tmpdir(), 'install-sh-plain-src-'));
    createdDirs.push(tmpDir);
    writeEnvExample(tmpDir);
    const cliDir = mkdtempSync(join(tmpdir(), 'install-sh-appdir-'));
    createdDirs.push(cliDir);

    runTemplateBlock({
      tmpDir,
      cliDir,
      shellkeepRepo: 'https://github.com/fallback-owner/fallback-repo.git',
      shellkeepRef: 'main',
      shellkeepSrc: '/some/local/checkout',
    });

    expect(readSourceJson(cliDir)).toEqual({
      repoUrl: 'https://github.com/fallback-owner/fallback-repo.git',
      ref: '',
    });
  });

  it('records an empty ref for a SHELLKEEP_SRC checkout in detached HEAD, never the literal "HEAD"', () => {
    const tmpDir = makeRepo();
    git(tmpDir, 'remote', 'add', 'origin', 'https://github.com/kappa/widgets.git');
    const sha = git(tmpDir, 'rev-parse', 'HEAD');
    git(tmpDir, 'checkout', '--quiet', '--detach', sha);
    writeEnvExample(tmpDir);
    const cliDir = mkdtempSync(join(tmpdir(), 'install-sh-appdir-'));
    createdDirs.push(cliDir);

    runTemplateBlock({
      tmpDir,
      cliDir,
      shellkeepRepo: 'https://github.com/kappa/widgets.git',
      shellkeepRef: 'main',
      shellkeepSrc: '/some/local/checkout',
    });

    expect(readSourceJson(cliDir).ref).toBe('');
  });

  it('warns rather than failing when the source has no infra/compose/.env.example, and creates no template/ dir', () => {
    const tmpDir = makeRepo();
    git(tmpDir, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git');
    // Deliberately no writeEnvExample() call: the source tree has no template.
    const cliDir = mkdtempSync(join(tmpdir(), 'install-sh-appdir-'));
    createdDirs.push(cliDir);

    const { stdout, status } = runTemplateBlock({
      tmpDir,
      cliDir,
      shellkeepRepo: 'https://github.com/example-owner/example-repo.git',
      shellkeepRef: 'main',
    });

    expect(status).toBe(0);
    expect(stdout).toContain(
      'WARN: No infra/compose/.env.example in the source; the wizard will read it from the remote',
    );
    expect(existsSync(join(cliDir, 'template'))).toBe(false);
  });
});

// =============================================================================
// install.sh reads the version from the first word of `--version` (issue #150)
// =============================================================================
//
// The CLI is the platform engine since #482, and its `--version` prints
// `<cli version> (platform <engine version>)`. install.sh compares the installed
// binary's version with the one it just built from `package.json`; comparing the
// whole line would report a "Version mismatch" after every install. The line is
// pulled out of the real install.sh and run against a stub shim, so the test
// follows the script rather than a copy of it.
// =============================================================================
describe('install.sh version verification (#150)', () => {
  function installedVersionLine(): string {
    const line = readFileSync(INSTALL_SH, 'utf8')
      .split('\n')
      .find((candidate) => candidate.startsWith('INSTALLED_VERSION="$("$BIN_SHIM" --version'));
    if (line === undefined) {
      throw new Error('install.sh no longer has the INSTALLED_VERSION line this test pins.');
    }
    return line;
  }

  function installedVersionFor(shimOutput: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'install-sh-shim-'));
    createdDirs.push(dir);
    const shim = join(dir, 'shim');
    writeFileSync(shim, `#!/usr/bin/env bash\nprintf '%s\\n' '${shimOutput}'\n`, { mode: 0o755 });

    return execFileSync('bash', ['-c', `BIN_SHIM='${shim}'\n${installedVersionLine()}\nprintf '%s' "$INSTALLED_VERSION"`], {
      encoding: 'utf8',
    });
  }

  it('takes only the CLI version from the platform engine format', () => {
    expect(installedVersionFor('1.10.0 (platform 0.1.0-next.5)')).toBe('1.10.0');
  });

  it('still reads a bare version', () => {
    expect(installedVersionFor('1.9.0')).toBe('1.9.0');
  });
});

describe('the engine no longer reads the bundled template', () => {
  it('has no consumer of template/source.json in @marinoscar/platform-cli', () => {
    const dist = join(HERE, '..', '..', '..', 'node_modules', '@marinoscar', 'platform-cli', 'dist');
    const found = spawnSync('grep', ['-rl', '--include=*.js', 'source\\.json', dist], { encoding: 'utf8' });
    expect(found.status).toBe(1); // grep: 1 means no match
    expect(found.stdout).toBe('');
  });
});
