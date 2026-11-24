import { spawnSync } from 'node:child_process';
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
