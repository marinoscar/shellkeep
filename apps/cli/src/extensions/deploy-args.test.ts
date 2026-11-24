import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planDeployArgs, type DeployPlan } from './deploy-args.js';

const NOW = new Date('2026-11-24T10:20:30.456Z');

let work: string;
let appsRoot: string;

function install(name: string): void {
  const dir = join(appsRoot, name);
  mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
  writeFileSync(join(dir, '.env'), 'SECRETS_ENCRYPTION_KEY=abc\n');
}

const plan = (argv: string[]): DeployPlan => planDeployArgs(argv, { cli: 'shellkeep', cwd: work, now: () => NOW });
const run = (argv: string[]): Extract<DeployPlan, { kind: 'run' }> => {
  const result = plan(argv);
  if (result.kind !== 'run') throw new Error(`expected run, got ${result.kind}`);
  return result;
};
const refusal = (argv: string[]): string => {
  const result = plan(argv);
  if (result.kind !== 'refuse') throw new Error('expected refuse');
  return result.message;
};

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'deploy-args-'));
  appsRoot = join(work, 'apps');
  mkdirSync(appsRoot, { recursive: true });
  install('shellkeep');
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('everything but uninstall', () => {
  it('passes other commands, help and version through untouched', () => {
    for (const argv of [
      ['deploy', 'status', '--json'],
      ['deploy', 'update', '--force'],
      ['servers', 'list'],
      ['--help'],
      ['deploy', 'uninstall', '--help'],
      ['deploy', 'uninstall', '-h'],
      ['--version'],
    ]) {
      expect(run(argv)).toEqual({ kind: 'run', argv, notes: [], before: [] });
    }
  });
});

describe('deploy uninstall names the deployment before it removes it', () => {
  const uninstall = (...extra: string[]): string[] => ['deploy', 'uninstall', '--apps-root', appsRoot, ...extra];

  it('refuses a real uninstall that does not type the deployment name', () => {
    const message = refusal(uninstall());

    expect(message).toContain('pass --confirm shellkeep');
    expect(message).toContain('--dry-run');
  });

  it('refuses a wrong name', () => {
    expect(refusal(uninstall('--confirm', 'other'))).toContain('Expected "shellkeep"');
    expect(refusal(uninstall('--confirm=other'))).toContain('Expected "shellkeep"');
  });

  it('accepts the right name (both spellings) and removes --confirm before the platform parses', () => {
    expect(run(uninstall('--confirm', 'shellkeep', '--json')).argv).toEqual(uninstall('--json'));
    expect(run(uninstall('--confirm=shellkeep')).argv).toEqual(uninstall());
  });

  it('a dry run needs no confirmation and takes no backup', () => {
    const result = run(uninstall('--dry-run'));

    expect(result.argv).toEqual(uninstall('--dry-run'));
    expect(result.before).toEqual([]);
  });

  it('a dry run that still passes --confirm loses the flag the platform does not know', () => {
    expect(run(uninstall('--dry-run', '--confirm', 'whatever')).argv).toEqual(uninstall('--dry-run'));
  });

  it('compares with the deployment --name selects, not with the sole one', () => {
    install('second');

    expect(refusal(uninstall('--confirm', 'shellkeep', '--name', 'second'))).toContain('Expected "second"');
    expect(run(uninstall('--confirm', 'second', '--name', 'second')).before).toHaveLength(1);
  });

  it('refuses on ambiguity rather than choosing one', () => {
    install('second');

    expect(refusal(uninstall('--confirm', 'shellkeep'))).toContain('Pass --name');
  });

  it('refuses when nothing is installed', () => {
    rmSync(join(appsRoot, 'shellkeep'), { recursive: true });

    expect(refusal(uninstall('--confirm', 'shellkeep'))).toContain('No deployment found');
  });

  it('backs .env up beside the deployment before anything is removed (deferred work, mode 0600)', () => {
    const result = run(uninstall('--confirm', 'shellkeep'));
    // Planning alone writes nothing: the backup is work the caller runs first.
    expect(readdirSync(appsRoot)).toEqual(['shellkeep']);

    const line = result.before[0]?.();

    expect(readdirSync(appsRoot).sort()).toEqual(['shellkeep', 'shellkeep.env.2026-11-24T10-20-30-456Z.bak']);
    expect(line).toContain('before it is removed');
    expect(line).toContain('mode 0600');
  });
});

describe('deploy update --check', () => {
  it('is answered here, with the deployment selectors and --ref', () => {
    expect(plan(['deploy', 'update', '--check', '--json', '--name', 'x', '--ref=v1', '--apps-root', '/a'])).toEqual({
      kind: 'update-check',
      selector: { root: undefined, name: 'x', appsRoot: '/a' },
      ref: 'v1',
      json: true,
    });
    expect(plan(['deploy', 'update', '--check'])).toMatchObject({ kind: 'update-check', json: false });
  });

  it('does not intercept an update without --check, or --check on another command', () => {
    expect(plan(['deploy', 'update', '--force']).kind).toBe('run');
    expect(plan(['deploy', 'status', '--check']).kind).toBe('run');
  });

  it('leaves help alone even with --check', () => {
    expect(plan(['deploy', 'update', '--check', '--help']).kind).toBe('run');
  });
});
