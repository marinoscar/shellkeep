import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backupEnvFile, confirmationProblem, envBackupPath, timestampSlug } from './uninstall-guard.js';

const NOW = new Date('2026-11-24T10:20:30.456Z');

let work: string;
let deployRoot: string;
const deployment = (): { name: string; deployRoot: string; appsRoot: string } => ({
  name: 'shellkeep',
  deployRoot,
  appsRoot: work,
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'uninstall-guard-'));
  deployRoot = join(work, 'shellkeep');
  mkdirSync(deployRoot, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('backupEnvFile', () => {
  it('copies .env beside the deployment folder, mode 0600, byte for byte', () => {
    writeFileSync(join(deployRoot, '.env'), 'SECRETS_ENCRYPTION_KEY=abc\n', { mode: 0o644 });

    const backup = backupEnvFile(deployment(), NOW);

    expect(backup?.path).toBe(join(work, 'shellkeep.env.2026-11-24T10-20-30-456Z.bak'));
    expect(readFileSync(backup?.path as string, 'utf8')).toBe('SECRETS_ENCRYPTION_KEY=abc\n');
    expect(statSync(backup?.path as string).mode & 0o777).toBe(0o600);
    // The original is untouched, and no temp file is left behind.
    expect(readFileSync(join(deployRoot, '.env'), 'utf8')).toBe('SECRETS_ENCRYPTION_KEY=abc\n');
    expect(readdirSync(work).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('reads the environment file an older layout kept inside the checkout', () => {
    mkdirSync(join(deployRoot, 'repo', 'infra', 'compose'), { recursive: true });
    writeFileSync(join(deployRoot, 'repo', 'infra', 'compose', '.env'), 'OLD=1\n');

    const backup = backupEnvFile(deployment(), NOW);

    expect(backup?.source).toBe(join(deployRoot, 'repo', 'infra', 'compose', '.env'));
    expect(readFileSync(backup?.path as string, 'utf8')).toBe('OLD=1\n');
  });

  it('tightens the mode when a backup lands on an existing, looser file', () => {
    writeFileSync(join(deployRoot, '.env'), 'A=1\n');
    writeFileSync(envBackupPath(deployment(), NOW), 'stale', { mode: 0o644 });

    const backup = backupEnvFile(deployment(), NOW);

    expect(readFileSync(backup?.path as string, 'utf8')).toBe('A=1\n');
    expect(statSync(backup?.path as string).mode & 0o777).toBe(0o600);
  });

  it('answers undefined when there is no environment file', () => {
    expect(backupEnvFile(deployment(), NOW)).toBeUndefined();
  });
});

describe('confirmationProblem', () => {
  it('asks for the name when none was typed, and names it', () => {
    expect(confirmationProblem('shellkeep', 'shellkeep', undefined)).toContain('pass --confirm shellkeep');
    expect(confirmationProblem('shellkeep', 'shellkeep', '  ')).toContain('pass --confirm shellkeep');
  });

  it('refuses a different name and accepts the right one', () => {
    expect(confirmationProblem('shellkeep', 'shellkeep', 'other')).toContain('Expected "shellkeep"');
    expect(confirmationProblem('shellkeep', 'shellkeep', 'shellkeep')).toBeUndefined();
  });
});

describe('timestampSlug', () => {
  it('is filesystem-safe', () => {
    expect(timestampSlug(NOW)).toBe('2026-11-24T10-20-30-456Z');
  });
});
