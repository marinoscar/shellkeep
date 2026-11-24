import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from './app.js';
import { loadCredentials } from './credentials.js';

let home: string;
let restore: () => void;

function writeConfig(body: unknown): void {
  mkdirSync(join(home, '.shellkeep'), { recursive: true });
  writeFileSync(join(home, '.shellkeep', 'config.json'), typeof body === 'string' ? body : JSON.stringify(body));
}

beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
  home = mkdtempSync(join(tmpdir(), 'shellkeep-credentials-'));
});

afterEach(() => {
  restore();
  rmSync(home, { recursive: true, force: true });
});

describe('loadCredentials', () => {
  it('reads the server URL and token that login stored in ~/.shellkeep/config.json', () => {
    writeConfig({ serverUrl: 'https://app.example.test', token: 'pat_stored' });

    expect(loadCredentials({ home, env: {} })).toEqual({ serverUrl: 'https://app.example.test', token: 'pat_stored' });
  });

  it('lets SHELLKEEP_SERVER_URL and SHELLKEEP_TOKEN win, field by field', () => {
    writeConfig({ serverUrl: 'https://file.example.test', token: 'pat_file' });

    expect(loadCredentials({ home, env: { SHELLKEEP_TOKEN: 'pat_env' } })).toEqual({
      serverUrl: 'https://file.example.test',
      token: 'pat_env',
    });
    expect(loadCredentials({ home: join(home, 'none'), env: { SHELLKEEP_SERVER_URL: 'https://env.example.test', SHELLKEEP_TOKEN: 'pat_env' } })).toEqual({
      serverUrl: 'https://env.example.test',
      token: 'pat_env',
    });
  });

  it('is an auth error (exit 5) when nobody is logged in, naming the remedy but no secret', () => {
    expect(() => loadCredentials({ home, env: {} })).toThrow(/shellkeep login/);
    try {
      loadCredentials({ home, env: {} });
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(5);
    }
  });

  it('reports a corrupt file without echoing its content', () => {
    writeConfig('{ "token": "pat_leaky" ');

    expect(() => loadCredentials({ home, env: {} })).toThrow(/not valid JSON/);
    try {
      loadCredentials({ home, env: {} });
    } catch (error) {
      expect((error as Error).message).not.toContain('pat_leaky');
    }
  });
});
