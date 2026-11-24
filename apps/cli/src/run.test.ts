import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCli } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApp } from './run.js';
import { requestAttach, takePendingAttach } from './tui/pending-attach.js';

vi.mock('./commands/sessions-attach.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./commands/sessions-attach.js')>()),
  runAttachBridge: vi.fn(async () => 4),
}));

const { runAttachBridge } = await import('./commands/sessions-attach.js');

let stdout = '';
let stderr = '';

beforeEach(() => {
  resetCliForTests();
  stdout = '';
  stderr = '';
  vi.mocked(runAttachBridge).mockClear();
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => ((stderr += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  takePendingAttach();
  resetCliForTests();
});

describe('runApp', () => {
  it('prints the app version and the platform version for --version, exit 0', async () => {
    expect(await runApp(['--version'])).toBe(0);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+ \(platform 0\.1\.0-next\.\d+\)\n$/);
  });

  it('lists the platform commands and the ShellKeep ones for --help', async () => {
    expect(await runApp(['--help'])).toBe(0);
    for (const name of ['init', 'login', 'api', 'config', 'node', 'deploy', 'servers', 'sessions']) {
      expect(stdout).toMatch(new RegExp(`^  ${name}\\b`, 'm'));
    }
  });

  it('returns the usage exit code for an unknown command, never calling process.exit', async () => {
    expect(await runApp(['nope'])).toBe(2);
  });

  it('prints a failed build as one line with the platform exit code', async () => {
    const failing = (() => {
      throw new Error('broken composition');
    }) as unknown as typeof createCli;

    const code = await runApp(['--help'], { createCli: failing, stderr: { write: (text) => ((stderr += text), true) } });

    expect(code).toBe(1);
    expect(stderr).toBe('shellkeep: broken composition\n');
  });

  it('runs the bridge the TUI queued, after the menu returned, and returns its exit code', async () => {
    requestAttach('5a1e6c0e-6b0e-4d52-9d6e-1f5d0f6f3a11');

    const code = await runApp(['--help']);

    expect(runAttachBridge).toHaveBeenCalledWith({ sessionId: '5a1e6c0e-6b0e-4d52-9d6e-1f5d0f6f3a11' });
    expect(code).toBe(4);
    expect(takePendingAttach()).toBeUndefined();
  });

  it('runs no bridge when nothing was queued', async () => {
    await runApp(['--help']);

    expect(runAttachBridge).not.toHaveBeenCalled();
  });

  describe('the default loopback port (#149)', () => {
    /** What the platform CLI is asked to run, for one invocation. */
    async function handedOver(argv: string[]): Promise<string[]> {
      let seen: string[] = [];
      const fake = (() => ({
        run: async (args: string[]) => {
          seen = args;
          return 0;
        },
      })) as unknown as typeof createCli;
      await runApp(argv, { createCli: fake });
      return seen;
    }

    it('adds --port 8323 to deploy install, doctor and status', async () => {
      expect(await handedOver(['deploy', 'install', '--domain', 'app.example.test'])).toEqual([
        'deploy',
        'install',
        '--port',
        '8323',
        '--domain',
        'app.example.test',
      ]);
      expect(await handedOver(['deploy', 'doctor'])).toEqual(['deploy', 'doctor', '--port', '8323']);
      expect(await handedOver(['deploy', 'status', '--json'])).toEqual(['deploy', 'status', '--port', '8323', '--json']);
    });

    it('keeps an explicit --port (both spellings) and leaves other commands untouched', async () => {
      expect(await handedOver(['deploy', 'install', '--port', '9000'])).toEqual(['deploy', 'install', '--port', '9000']);
      expect(await handedOver(['deploy', 'install', '--port=9000'])).toEqual(['deploy', 'install', '--port=9000']);
      expect(await handedOver(['deploy', 'update'])).toEqual(['deploy', 'update']);
      expect(await handedOver(['servers', 'list'])).toEqual(['servers', 'list']);
    });
  });

  describe('the uninstall guard (#150)', () => {
    let apps: string;
    let fakeRuns: string[][];
    const fake = (() => ({
      run: async (args: string[]) => {
        fakeRuns.push(args);
        return 0;
      },
    })) as unknown as typeof createCli;

    beforeEach(() => {
      apps = mkdtempSync(join(tmpdir(), 'run-uninstall-'));
      mkdirSync(join(apps, 'shellkeep', 'repo', '.git'), { recursive: true });
      writeFileSync(join(apps, 'shellkeep', '.env'), 'SECRETS_ENCRYPTION_KEY=abc\n');
      fakeRuns = [];
    });
    afterEach(() => rmSync(apps, { recursive: true, force: true }));

    it('refuses an unconfirmed uninstall with the usage code and never builds a run', async () => {
      const code = await runApp(['deploy', 'uninstall', '--apps-root', apps], { createCli: fake });

      expect(code).toBe(2);
      expect(fakeRuns).toEqual([]);
      expect(stderr).toContain('--confirm shellkeep');
    });

    it('backs up .env, then hands the platform an argv without --confirm', async () => {
      const argv = ['deploy', 'uninstall', '--apps-root', apps, '--confirm', 'shellkeep'];

      expect(await runApp(argv, { createCli: fake, now: () => new Date('2026-11-24T10:20:30.456Z') })).toBe(0);

      expect(fakeRuns).toEqual([['deploy', 'uninstall', '--apps-root', apps]]);
      expect(readFileSync(join(apps, 'shellkeep.env.2026-11-24T10-20-30-456Z.bak'), 'utf8')).toBe(
        'SECRETS_ENCRYPTION_KEY=abc\n',
      );
      expect(stderr).toContain('before it is removed');
    });

    it('leaves a dry run alone: no backup, no refusal', async () => {
      expect(await runApp(['deploy', 'uninstall', '--apps-root', apps, '--dry-run'], { createCli: fake })).toBe(0);

      expect(readdirSync(apps)).toEqual(['shellkeep']);
      expect(fakeRuns).toHaveLength(1);
    });
  });
});
