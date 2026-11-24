// =============================================================================
// SshConnectionFactory over a mocked ssh2 `Client` (issue #60)
// =============================================================================
//
// The mock behaves like ssh2 where it matters here: `connect()` calls the config's
// `hostVerifier(key, verify)` first; ONLY a `verify(true)` lets it go on to
// authenticate (counted in `auth.attempts`) and emit `ready`; a `verify(false)` ends
// the connection with an error and never authenticates. So `auth.attempts === 0`
// in a refusal row proves no password or key handshake was attempted.
// =============================================================================

import { EventEmitter } from 'node:events';
import { Client } from 'ssh2';

import { algorithmOf, fingerprintOf } from './host-key';
import { HostKeyError } from './host-key.error';
import { HOST_KEY_POLICIES, type HostKeyPolicy } from './host-key-policy';
import { SshConnectionFactory } from './ssh-connection.factory';
import type { DecryptedServerProfile } from './ssh-profile';

jest.mock('ssh2');

const KEY_A = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from('key-a-body')]);
const KEY_B = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from('key-b-body')]);
const FP_A = fingerprintOf(KEY_A);
const FP_B = fingerprintOf(KEY_B);

const PROFILE: DecryptedServerProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  orgId: '33333333-3333-4333-8333-333333333333',
  hostname: 'server-a.example.test',
  port: 22,
  username: 'admin',
  authMethod: 'password',
  password: 'FAKE-PASSWORD-for-tests',
  fingerprint: null,
};

interface Harness {
  factory: SshConnectionFactory;
  /** The key the mocked server presents. */
  serverKey: { current: Buffer };
  auth: { attempts: number };
  configs: any[];
  prisma: { serverProfile: { updateMany: jest.Mock; findFirst: jest.Mock } };
  audit: jest.Mock;
  metrics: jest.Mock;
  clients: any[];
}

function harness(policy: HostKeyPolicy = 'tofu_prompt'): Harness {
  const serverKey = { current: KEY_A };
  const auth = { attempts: 0 };
  const configs: any[] = [];
  const clients: any[] = [];

  (Client as unknown as jest.Mock).mockImplementation(() => {
    const client = new EventEmitter() as any;
    client.end = jest.fn();
    client.destroy = jest.fn();
    client.connect = jest.fn((config: any) => {
      configs.push(config);
      process.nextTick(() => {
        config.hostVerifier(serverKey.current, (ok: boolean) => {
          if (!ok) return client.emit('error', new Error('Host denied (verification failed)'));
          auth.attempts += 1; // the userauth step: password / key / agent
          client.emit('ready');
        });
      });
    });
    clients.push(client);
    return client;
  });

  const prisma = {
    serverProfile: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const audit = jest.fn().mockResolvedValue(undefined);
  const metrics = jest.fn();
  const factory = new SshConnectionFactory(
    prisma as never,
    { record: audit } as never,
    { getNamespace: jest.fn().mockResolvedValue({ hostKeyPolicy: policy }) } as never,
    { add: metrics } as never,
  );
  return { factory, serverKey, auth, configs, prisma, audit, metrics, clients };
}

const open = (h: Harness, profile: Partial<DecryptedServerProfile>, purpose: 'interactive' | 'test' | 'exec', policy?: HostKeyPolicy) =>
  h.factory.open({ ...PROFILE, ...profile }, { purpose, hostKeyPolicy: policy });

beforeEach(() => jest.clearAllMocks());

describe('the policy table, one row each, for every purpose', () => {
  describe.each(['interactive', 'test', 'exec'] as const)('purpose %s', (purpose) => {
    it('equal fingerprint: connects and authenticates', async () => {
      const h = harness();
      const client = await open(h, { fingerprint: FP_A }, purpose);
      expect(client).toBe(h.clients[0]);
      expect(h.auth.attempts).toBe(1);
      expect(h.metrics).toHaveBeenCalledWith('sshHostKeyChecks', 1, { outcome: 'match' });
      expect(h.prisma.serverProfile.updateMany).not.toHaveBeenCalled();
    });

    it.each(['tofu_prompt', 'strict'] as const)('no fingerprint under %s: refuses HOST_KEY_UNKNOWN, sends no credential', async (policy) => {
      const h = harness();
      const failure = open(h, { fingerprint: null }, purpose, policy);

      await expect(failure).rejects.toBeInstanceOf(HostKeyError);
      await expect(failure).rejects.toMatchObject({
        code: 'HOST_KEY_UNKNOWN',
        presented: { fingerprint: FP_A, algorithm: algorithmOf(KEY_A) },
        expected: undefined,
        serverProfileId: PROFILE.id,
      });
      expect(h.auth.attempts).toBe(0);
      expect(h.configs).toHaveLength(1);
      expect(h.clients[0].end).toHaveBeenCalled();
      expect(h.metrics).toHaveBeenCalledWith('sshHostKeyChecks', 1, { outcome: 'unknown' });
      expect(h.prisma.serverProfile.updateMany).not.toHaveBeenCalled();
    });

    it('no fingerprint under tofu_auto: stores the presented key, connects, audits', async () => {
      const h = harness();
      await open(h, { fingerprint: null }, purpose, 'tofu_auto');

      expect(h.prisma.serverProfile.updateMany).toHaveBeenCalledWith({
        where: { id: PROFILE.id, userId: PROFILE.userId, orgId: PROFILE.orgId, fingerprint: null },
        data: {
          fingerprint: FP_A,
          hostKeyAlgorithm: 'ssh-ed25519',
          hostKeyTrustedAt: expect.any(Date),
          hostKeyTrustedBy: null,
        },
      });
      expect(h.audit).toHaveBeenCalledTimes(1);
      expect(h.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'server_profile.host_key_auto_trusted', actorUserId: null, targetId: PROFILE.id }),
      );
      expect(h.auth.attempts).toBe(1);
      expect(h.metrics).toHaveBeenCalledWith('sshHostKeyChecks', 1, { outcome: 'auto_trusted' });
    });

    it.each(HOST_KEY_POLICIES)('a different fingerprint under %s: ALWAYS refuses HOST_KEY_MISMATCH, sends no credential', async (policy) => {
      const h = harness();
      h.serverKey.current = KEY_B;
      const failure = open(h, { fingerprint: FP_A }, purpose, policy);

      await expect(failure).rejects.toMatchObject({
        code: 'HOST_KEY_MISMATCH',
        presented: { fingerprint: FP_B, algorithm: 'ssh-ed25519' },
        expected: FP_A,
      });
      expect(h.auth.attempts).toBe(0);
      expect(h.metrics).toHaveBeenCalledWith('sshHostKeyChecks', 1, { outcome: 'mismatch' });
      // Never stores over a trusted key, whatever the policy.
      expect(h.prisma.serverProfile.updateMany).not.toHaveBeenCalled();
      expect(h.audit).not.toHaveBeenCalled();
    });
  });

  it('tofu_auto that loses the race to another trust compares with the key stored meanwhile, never accepting blindly', async () => {
    const h = harness();
    h.prisma.serverProfile.updateMany.mockResolvedValue({ count: 0 });

    h.prisma.serverProfile.findFirst.mockResolvedValue({ fingerprint: FP_B });
    await expect(open(h, { fingerprint: null }, 'exec', 'tofu_auto')).rejects.toMatchObject({
      code: 'HOST_KEY_MISMATCH',
      expected: FP_B,
    });
    expect(h.auth.attempts).toBe(0);

    h.prisma.serverProfile.findFirst.mockResolvedValue({ fingerprint: FP_A });
    await expect(open(h, { fingerprint: null }, 'exec', 'tofu_auto')).resolves.toBeDefined();
  });

  it('refuses (and sends no credential) when the verification itself fails, e.g. the database is down', async () => {
    const h = harness();
    h.prisma.serverProfile.updateMany.mockRejectedValue(new Error('db down'));
    await expect(open(h, { fingerprint: null }, 'exec', 'tofu_auto')).rejects.toThrow();
    expect(h.auth.attempts).toBe(0);
  });
});

describe('the system policy', () => {
  it('reads ssh.hostKeyPolicy when the caller names none', async () => {
    const h = harness('tofu_auto');
    await h.factory.open({ ...PROFILE, fingerprint: null }, { purpose: 'test' });
    expect(h.prisma.serverProfile.updateMany).toHaveBeenCalled();
  });

  it('falls back to tofu_prompt, never to auto-trust, when the setting cannot be read', async () => {
    const h = harness();
    (h.factory as any).settings.getNamespace.mockRejectedValue(new Error('settings down'));
    await expect(h.factory.open({ ...PROFILE, fingerprint: null }, { purpose: 'test' })).rejects.toMatchObject({
      code: 'HOST_KEY_UNKNOWN',
    });
    expect(h.auth.attempts).toBe(0);
  });
});

describe('the connect config (the only builder)', () => {
  it('passes the verifier, the 10 s ready timeout and password credentials', async () => {
    const h = harness();
    await open(h, { fingerprint: FP_A }, 'interactive');
    expect(h.configs[0]).toMatchObject({
      host: PROFILE.hostname,
      port: 22,
      username: 'admin',
      password: PROFILE.password,
      readyTimeout: 10_000,
      hostVerifier: expect.any(Function),
    });
  });

  it('passes a private key with its passphrase', async () => {
    const h = harness();
    await open(h, { fingerprint: FP_A, authMethod: 'key', password: null, privateKey: 'FAKE-KEY', passphrase: 'FAKE-PASS' }, 'exec');
    expect(h.configs[0]).toMatchObject({ privateKey: 'FAKE-KEY', passphrase: 'FAKE-PASS' });
    expect(h.configs[0]).not.toHaveProperty('password');
  });

  it.each(['interactive', 'test', 'exec'] as const)('sets agent: SSH_AUTH_SOCK for agent auth on purpose %s', async (purpose) => {
    const previous = process.env.SSH_AUTH_SOCK;
    process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
    try {
      const h = harness();
      await open(h, { fingerprint: FP_A, authMethod: 'agent', password: null }, purpose);
      expect(h.configs[0].agent).toBe('/tmp/agent.sock');
      expect(h.configs[0]).not.toHaveProperty('password');
      expect(h.configs[0]).not.toHaveProperty('privateKey');
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = previous;
    }
  });

  it('shortens the ready timeout for a short deadline but never beyond 10 s', async () => {
    const h = harness();
    await h.factory.open({ ...PROFILE, fingerprint: FP_A }, { purpose: 'exec', readyTimeoutMs: 400 });
    await h.factory.open({ ...PROFILE, fingerprint: FP_A }, { purpose: 'exec', readyTimeoutMs: 60_000 });
    expect(h.configs.map((c) => c.readyTimeout)).toEqual([400, 10_000]);
  });
});

describe('scan', () => {
  it('captures the presented key and disconnects, with no credential in the config', async () => {
    const h = harness();
    h.serverKey.current = KEY_B;

    await expect(h.factory.scan(PROFILE)).resolves.toEqual({ fingerprint: FP_B, algorithm: 'ssh-ed25519' });

    expect(h.auth.attempts).toBe(0);
    expect(h.configs[0]).not.toHaveProperty('password');
    expect(h.configs[0]).not.toHaveProperty('privateKey');
    expect(h.configs[0]).not.toHaveProperty('passphrase');
    expect(h.configs[0]).not.toHaveProperty('agent');
    expect(JSON.stringify(h.configs[0])).not.toContain(PROFILE.password!);
    expect(h.clients[0].end).toHaveBeenCalled();
    // A scan is a look, not a check: nothing counted, nothing stored.
    expect(h.metrics).not.toHaveBeenCalled();
    expect(h.prisma.serverProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects with the connection error when no key was presented', async () => {
    const h = harness();
    (Client as unknown as jest.Mock).mockImplementation(() => {
      const client = new EventEmitter() as any;
      client.end = jest.fn();
      client.destroy = jest.fn();
      client.connect = jest.fn(() => process.nextTick(() => client.emit('error', new Error('connect ECONNREFUSED'))));
      return client;
    });
    await expect(h.factory.scan(PROFILE)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('exec', () => {
  it('opens purpose exec, runs the command, returns stdout, stderr, exit code and signal, and closes', async () => {
    const h = harness();
    const original = (Client as unknown as jest.Mock).getMockImplementation()!;
    (Client as unknown as jest.Mock).mockImplementation(() => {
      const client = original();
      client.exec = jest.fn((_cmd: string, cb: (e: Error | null, s: any) => void) => {
        const stream = new EventEmitter() as any;
        stream.stderr = new EventEmitter();
        cb(null, stream);
        process.nextTick(() => {
          stream.emit('data', Buffer.from('out'));
          stream.stderr.emit('data', Buffer.from('err'));
          stream.emit('close', 3, null);
        });
      });
      return client;
    });

    const result = await h.factory.exec({ ...PROFILE, fingerprint: FP_A }, 'false');

    expect(result).toEqual({ stdout: 'out', stderr: 'err', exitCode: 3, signal: null });
    expect(h.clients[0].end).toHaveBeenCalled();
  });

  it('refuses a mismatched host before running anything', async () => {
    const h = harness();
    h.serverKey.current = KEY_B;
    await expect(h.factory.exec({ ...PROFILE, fingerprint: FP_A }, 'id')).rejects.toMatchObject({ code: 'HOST_KEY_MISMATCH' });
    expect(h.auth.attempts).toBe(0);
  });

  it('times out and destroys the connection when the command never ends', async () => {
    const h = harness();
    const original = (Client as unknown as jest.Mock).getMockImplementation()!;
    (Client as unknown as jest.Mock).mockImplementation(() => {
      const client = original();
      client.exec = jest.fn(() => undefined);
      return client;
    });

    await expect(h.factory.exec({ ...PROFILE, fingerprint: FP_A }, 'sleep 99', { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    expect(h.clients[0].destroy).toHaveBeenCalled();
  });
});

describe('secrets', () => {
  it('never appear in the refusal, the log line or the audit event', async () => {
    const h = harness();
    h.serverKey.current = KEY_B;
    const warn = jest.spyOn((h.factory as any).logger, 'warn').mockImplementation(() => undefined);

    const failure = await open(h, { fingerprint: FP_A, password: 'FAKE-PASSWORD-for-tests' }, 'interactive').catch((e) => e);

    expect(JSON.stringify({ ...failure, message: failure.message })).not.toContain('FAKE-PASSWORD-for-tests');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(FP_A);
    expect(logged).toContain(FP_B);
    expect(logged).not.toContain('FAKE-PASSWORD-for-tests');
    expect(logged).toContain(PROFILE.id);
  });
});
