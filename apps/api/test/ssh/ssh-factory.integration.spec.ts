// =============================================================================
// Host-key verification against a real ssh2 server (issue #60)
// =============================================================================
//
// The REAL `SshConnectionFactory` (and `ServerFactsService`, `SshService`) over an
// in-process `ssh2.Server` on 127.0.0.1 that records every authentication attempt.
// The server has TWO host keys over the test (it is replaced by another at the same
// port, as a rebuilt or intercepted host would be):
//
//   1. first connect            -> HOST_KEY_UNKNOWN, no authentication attempt
//   2. trust, connect again     -> OK
//   3. the server key is swapped -> HOST_KEY_MISMATCH on interactive, test and exec, and
//                                  `authAttempts` stays 0: no credential was ever sent
// =============================================================================

import { Logger } from '@nestjs/common';

import { HostKeyError } from '../../src/ssh/host-key.error';
import { ServerFactsService } from '../../src/ssh/server-facts.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import type { DecryptedServerProfile } from '../../src/ssh/ssh-profile';
import { SshService } from '../../src/terminal/ssh.service';
import { startScriptedSshServer, type ScriptedSshServer } from '../terminal/scripted-ssh-server';

const PASSWORD = 'FAKE-PASSWORD-integration-1234';
const PROFILE_ID = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';

/** The profile table of one row, with the `updateMany`/`findFirst` the factory uses. */
function profileTable(row: { fingerprint: string | null; hostKeyAlgorithm: string | null }) {
  return {
    row,
    serverProfile: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.fingerprint === null && row.fingerprint !== null) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findFirst: jest.fn(async () => ({ fingerprint: row.fingerprint })),
    },
  };
}

describe('SshConnectionFactory against a real ssh2 server', () => {
  let server: ScriptedSshServer;
  let table: ReturnType<typeof profileTable>;
  let factory: SshConnectionFactory;
  let facts: ServerFactsService;
  let ssh: SshService;
  let audit: jest.Mock;
  let policy: 'tofu_prompt' | 'tofu_auto' | 'strict';

  const profile = (): DecryptedServerProfile => ({
    id: PROFILE_ID,
    userId: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    orgId: '11111111-2222-4333-8444-555555555555',
    hostname: '127.0.0.1',
    port: server.port,
    username: server.username,
    authMethod: 'password',
    password: PASSWORD,
    fingerprint: table.row.fingerprint,
    hostKeyAlgorithm: table.row.hostKeyAlgorithm,
  });

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    server = await startScriptedSshServer({ password: PASSWORD });
    table = profileTable({ fingerprint: null, hostKeyAlgorithm: null });
    audit = jest.fn().mockResolvedValue(undefined);
    policy = 'tofu_prompt';
    const metrics = { add: jest.fn() };
    factory = new SshConnectionFactory(
      table as never,
      { record: audit } as never,
      { getNamespace: async () => ({ hostKeyPolicy: policy }) } as never,
      metrics as never,
    );
    facts = new ServerFactsService(factory, { serverProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as never);
    ssh = new SshService(factory);
  });

  afterEach(async () => {
    await server.close();
  });

  /** Replaces the server with another one (a different host key) at the same address. */
  async function swapServerKey(): Promise<ScriptedSshServer> {
    const port = server.port;
    await server.close();
    server = await startScriptedSshServer({ password: PASSWORD, port });
    return server;
  }

  it('walks the whole trust story: unknown, trust, connect, swap, mismatch on every path', async () => {
    const first = server.fingerprint;

    // 1. First connect: refused as unknown, before any credential.
    const unknown = await factory.open(profile(), { purpose: 'interactive' }).catch((e) => e);
    expect(unknown).toBeInstanceOf(HostKeyError);
    expect(unknown).toMatchObject({
      code: 'HOST_KEY_UNKNOWN',
      presented: { fingerprint: first, algorithm: 'ssh-ed25519' },
    });
    expect(server.authAttempts.count).toBe(0);

    // A scan reads the same key without authenticating.
    await expect(factory.scan(profile())).resolves.toEqual({ fingerprint: first, algorithm: 'ssh-ed25519' });
    expect(server.authAttempts.count).toBe(0);

    // 2. Trust it; the next connect works.
    table.row.fingerprint = first;
    table.row.hostKeyAlgorithm = 'ssh-ed25519';
    const client = await factory.open(profile(), { purpose: 'test' });
    client.end();
    expect(server.authAttempts.count).toBeGreaterThan(0);

    // 3. The key is swapped (a rebuilt host, or an interception).
    const swapped = await swapServerKey();
    expect(swapped.fingerprint).not.toBe(first);

    const interactive = await ssh.connect(profile(), 'sk-test', 80, 24).catch((e) => e);
    const test = await factory.open(profile(), { purpose: 'test' }).catch((e) => e);
    const exec = await ssh.execCommand(profile(), 'id').catch((e) => e);

    for (const failure of [interactive, test, exec]) {
      expect(failure).toBeInstanceOf(HostKeyError);
      expect(failure).toMatchObject({
        code: 'HOST_KEY_MISMATCH',
        presented: { fingerprint: swapped.fingerprint },
        expected: first,
      });
    }
    // NO credential was sent to the impostor, and no command ran.
    expect(swapped.authAttempts.count).toBe(0);
    expect(swapped.commands).toEqual([]);
    // The stored key was never overwritten.
    expect(table.row.fingerprint).toBe(first);
  });

  it('a mismatch is refused under tofu_auto too: automatic trust only ever fills an empty slot', async () => {
    policy = 'tofu_auto';
    table.row.fingerprint = server.fingerprint;
    table.row.hostKeyAlgorithm = 'ssh-ed25519';
    const swapped = await swapServerKey();

    await expect(factory.open(profile(), { purpose: 'exec' })).rejects.toMatchObject({ code: 'HOST_KEY_MISMATCH' });
    expect(swapped.authAttempts.count).toBe(0);
    expect(table.row.fingerprint).not.toBe(swapped.fingerprint);
  });

  it('tofu_auto trusts the first key, audits it once and connects; the next connect is a plain match', async () => {
    policy = 'tofu_auto';

    const client = await factory.open(profile(), { purpose: 'exec' });
    client.end();

    expect(table.row).toMatchObject({
      fingerprint: server.fingerprint,
      hostKeyAlgorithm: 'ssh-ed25519',
      hostKeyTrustedBy: null,
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'server_profile.host_key_auto_trusted' }));

    const again = await factory.open(profile(), { purpose: 'exec' });
    again.end();
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('exec returns stdout, stderr and the exit status without hiding a failure', async () => {
    table.row.fingerprint = server.fingerprint;
    server.reply = { stdout: 'hello\n', stderr: 'warning\n', exitCode: 7 };

    await expect(ssh.execCommand(profile(), 'whatever')).resolves.toMatchObject({
      stdout: 'hello\n',
      stderr: 'warning\n',
      exitCode: 7,
    });
    expect(server.commands).toEqual(['whatever']);
  });

  it('probes the facts over the factory once the key is trusted, and not before', async () => {
    server.reply = {
      stdout: 'Linux 6.1.0 x86_64\nID=debian\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12"\nSHELL=/bin/bash\nHAS=tmux\nHAS=apt-get\n',
      exitCode: 0,
    };

    await expect(facts.probe(profile())).rejects.toMatchObject({ code: 'HOST_KEY_UNKNOWN' });
    expect(server.commands).toEqual([]);

    table.row.fingerprint = server.fingerprint;
    await expect(facts.probe(profile())).resolves.toMatchObject({
      os: 'linux',
      distroId: 'debian',
      has: ['tmux', 'apt-get'],
      packageManager: 'apt',
    });
    expect(server.commands).toHaveLength(1);
  });

  it('never lets the secret reach a refusal message', async () => {
    const failure = await factory.open(profile(), { purpose: 'interactive' }).catch((e) => e);
    expect(String(failure.message)).not.toContain(PASSWORD);
    expect(JSON.stringify(failure)).not.toContain(PASSWORD);
  });
});
