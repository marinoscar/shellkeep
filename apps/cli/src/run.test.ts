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
});
