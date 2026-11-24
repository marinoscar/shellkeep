import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { fakeDeps, programWith } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { CommandExit } from './exit.js';
import { listServers } from './servers-list.js';
import { hostKeyStatusOf, testServer } from './servers-test.js';
import { serversCommand } from './servers.js';

const PROFILE = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Staging web',
  hostname: 'web.example.test',
  port: 22,
  username: 'deploy',
  authMethod: 'key',
  tags: ['staging', 'web'],
  color: 'info',
  aiOutputSharing: true,
  hasPassword: false,
  hasPrivateKey: true,
  hasPassphrase: true,
  fingerprint: 'SHA256:abc',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyTrustedAt: '2026-10-01T00:00:00.000Z',
  facts: { os: 'linux' },
  factsProbedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const OTHER = { ...PROFILE, id: '33333333-3333-4333-8333-333333333333', name: 'Prod db', tags: ['prod'], fingerprint: null };

let restore: () => void;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
});
afterEach(() => restore());

describe('servers list', () => {
  it('reads every page of GET /server-profiles', async () => {
    const { deps, calls } = fakeDeps((call) => {
      const page = (call.options as { query: { page: number } }).query.page;
      return { items: [page === 1 ? PROFILE : OTHER], total: 2, page, pageSize: 1, totalPages: 2 };
    });

    const rows = await listServers(deps, undefined);

    expect(rows.map((row) => row.name)).toEqual(['Staging web', 'Prod db']);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /server-profiles', 'GET /server-profiles']);
    expect(calls.map((call) => (call.options as { query: { page: number; pageSize: number } }).query)).toEqual([
      { page: 1, pageSize: 100 },
      { page: 2, pageSize: 100 },
    ]);
  });

  it('filters by tag, case-insensitively', async () => {
    const { deps } = fakeDeps(() => ({ items: [PROFILE, OTHER], total: 2, page: 1, pageSize: 100, totalPages: 1 }));

    expect((await listServers(deps, 'STAGING')).map((row) => row.name)).toEqual(['Staging web']);
    expect(await listServers(deps, 'nope')).toEqual([]);
  });

  it('--json carries no credential field, whatever the response holds', async () => {
    const { deps, out } = fakeDeps(() => ({
      items: [{ ...PROFILE, password: 'leaked', privateKey: 'leaked', passphrase: 'leaked', secret: 'leaked', token: 'leaked' }],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    }));
    const program = programWith((root) => serversCommand(deps)(root));

    await program.parseAsync(['servers', 'list', '--json'], { from: 'user' });

    const text = out();
    expect(text).not.toContain('leaked');
    for (const field of ['password', 'privateKey', 'passphrase', 'hasPassword', 'hasPrivateKey', 'hasPassphrase', 'secret', 'token', 'facts']) {
      expect(text.toLowerCase()).not.toContain(`"${field.toLowerCase()}"`);
    }
    const [row] = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ id: PROFILE.id, name: 'Staging web', hostname: 'web.example.test', tags: ['staging', 'web'], hostKeyTrusted: true });
  });

  it('prints a table by default and a plain line when there is nothing', async () => {
    const full = fakeDeps(() => ({ items: [PROFILE], total: 1, page: 1, pageSize: 100, totalPages: 1 }));
    await programWith((root) => serversCommand(full.deps)(root)).parseAsync(['servers', 'list'], { from: 'user' });
    expect(full.out()).toContain('Staging web');
    expect(full.out()).toContain('deploy');
    expect(full.out()).toContain('web.example.test:22');
    expect(full.out()).toContain('trusted');

    const empty = fakeDeps(() => ({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }));
    await programWith((root) => serversCommand(empty.deps)(root)).parseAsync(['servers', 'list'], { from: 'user' });
    expect(empty.out()).toBe('No server profiles.\n');
  });
});

describe('servers test', () => {
  it('maps response codes to the host-key status', () => {
    expect(hostKeyStatusOf({ success: true })).toBe('trusted');
    expect(hostKeyStatusOf({ success: false, code: 'HOST_KEY_UNKNOWN' })).toBe('unknown');
    expect(hostKeyStatusOf({ success: false, code: 'HOST_KEY_MISMATCH' })).toBe('mismatch');
    expect(hostKeyStatusOf({ success: false, error: 'timeout' })).toBe('not-checked');
  });

  it('POSTs the test route and measures the latency', async () => {
    const { deps, calls } = fakeDeps(() => ({ success: true }));
    const times = [1000, 1042];

    const report = await testServer(deps, PROFILE.id, () => times.shift() ?? 0);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /server-profiles/${PROFILE.id}/test`]);
    expect(report).toEqual({
      id: PROFILE.id,
      success: true,
      latencyMs: 42,
      hostKey: { status: 'trusted', presentedFingerprint: null },
      error: null,
      code: null,
    });
  });

  it('prints latency and host-key status and exits 0 on success', async () => {
    const { deps, out } = fakeDeps(() => ({ success: true }));

    await programWith((root) => serversCommand(deps)(root)).parseAsync(['servers', 'test', PROFILE.id], { from: 'user' });

    expect(out()).toMatch(/^OK {2}latency \d+ ms {2}host key: trusted\n$/);
  });

  it('exits 1 with the host-key detail when the key is unknown', async () => {
    const { deps, out } = fakeDeps(() => ({
      success: false,
      error: 'Host key not trusted',
      code: 'HOST_KEY_UNKNOWN',
      presented: { fingerprint: 'SHA256:new', algorithm: 'ssh-ed25519' },
    }));
    const program = programWith((root) => serversCommand(deps)(root));

    const failure = await program.parseAsync(['servers', 'test', PROFILE.id], { from: 'user' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CommandExit);
    expect((failure as CommandExit).exitCode).toBe(1);
    expect(out()).toContain('FAILED');
    expect(out()).toContain('host key: unknown');
    expect(out()).toContain('presented key: SHA256:new');
    expect(out()).toContain('error: Host key not trusted');
  });

  it('--json prints the report and still exits 1 on failure', async () => {
    const { deps, out } = fakeDeps(() => ({ success: false, error: 'connect ETIMEDOUT' }));
    const program = programWith((root) => serversCommand(deps)(root));

    const failure = await program.parseAsync(['servers', 'test', PROFILE.id, '--json'], { from: 'user' }).catch((error: unknown) => error);

    expect((failure as CommandExit).exitCode).toBe(1);
    expect(JSON.parse(out())).toMatchObject({ success: false, error: 'connect ETIMEDOUT', hostKey: { status: 'not-checked' } });
  });
});
