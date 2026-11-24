// =============================================================================
// Terminal metrics (issue #53)
// =============================================================================
//
// Pins the contract of the `app.terminal.*` instruments:
//   - the gateway counts every authentication refusal with the right bounded `reason`;
//   - an SSH connect against a scripted ssh2 double records ONE duration sample whose only
//     attribute is `outcome`;
//   - the reaper counter skips a zero count;
//   - no registered metric carries an attribute that could identify a user, host, session or org.
// =============================================================================

import { EventEmitter } from 'node:events';
import { Client } from 'ssh2';

import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { fingerprintOf } from '../../src/ssh/host-key';
import { HostKeyError } from '../../src/ssh/host-key.error';
import { TerminalGateway } from '../../src/terminal/terminal.gateway';
import { TerminalMetricsService } from '../../src/terminal/telemetry/terminal-metrics.service';
import {
  TERMINAL_APP_METRICS,
  TERMINAL_SSH_CONNECT_DURATION_METRIC,
  TERMINAL_SESSIONS_REAPED_METRIC,
  TERMINAL_WS_AUTH_DENIED_METRIC,
} from '../../src/terminal/telemetry/terminal.metrics';
import { TERMINAL_METRIC_GROUP } from '../../src/terminal/telemetry/terminal.metric-group';
import type { DecryptedServerProfile } from '../../src/ssh/ssh-profile';

jest.mock('ssh2');

const KEY = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from('key-a-body')]);

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

function appMetrics() {
  return { add: jest.fn(), record: jest.fn() };
}

describe('gateway authentication refusals', () => {
  const open: Array<() => void> = [];
  afterEach(() => open.splice(0).forEach((close) => close()));

  function build(resolve: jest.Mock, refuses = false) {
    const metrics = appMetrics();
    const service = new TerminalMetricsService({} as never, undefined, metrics as never);
    const gateway = new TerminalGateway(
      { resolve } as never,
      {} as never,
      {} as never,
      {} as never,
      { refuses: jest.fn().mockResolvedValue(refuses) } as never,
      service,
    );
    const ws: any = Object.assign(new EventEmitter(), {
      readyState: 1,
      sent: [] as any[],
      send(data: string) {
        this.sent.push(JSON.parse(data));
      },
      close() {
        this.readyState = 3;
      },
      ping: jest.fn(),
    });
    gateway.handleConnection(ws);
    open.push(() => gateway.handleDisconnect(ws));
    return { gateway, ws, metrics };
  }

  const authenticate = async (ws: any) => {
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'any' })), false);
    await new Promise((r) => setTimeout(r, 20));
  };

  const principal = (permissions: string[]) => ({
    ok: true,
    principal: { userId: 'u', orgId: 'o', permissions, roles: ['viewer'], expiresAtMs: Date.now() + 60_000 },
  });

  it.each([
    ['a forged token', { ok: false, reason: 'invalid_token' }, 'invalid_token'],
    ['an expired token', { ok: false, reason: 'expired' }, 'expired'],
    ['an inactive user', { ok: false, reason: 'invalid_user' }, 'forbidden'],
  ])('%s counts auth_denied{reason=%s}', async (_label, result, reason) => {
    const { ws, metrics, gateway } = build(jest.fn().mockResolvedValue(result));
    await authenticate(ws);
    expect(metrics.add).toHaveBeenCalledTimes(1);
    expect(metrics.add).toHaveBeenCalledWith(TERMINAL_WS_AUTH_DENIED_METRIC, 1, { reason });
    expect(gateway.authenticatedCount()).toBe(0);
  });

  it('a principal without sessions:write is refused as forbidden', async () => {
    const { ws, metrics } = build(jest.fn().mockResolvedValue(principal(['sessions:read'])));
    await authenticate(ws);
    expect(metrics.add).toHaveBeenCalledWith(TERMINAL_WS_AUTH_DENIED_METRIC, 1, { reason: 'forbidden' });
  });

  it('a maintenance window refuses as maintenance', async () => {
    const { ws, metrics } = build(jest.fn().mockResolvedValue(principal(['sessions:write'])), true);
    await authenticate(ws);
    expect(metrics.add).toHaveBeenCalledWith(TERMINAL_WS_AUTH_DENIED_METRIC, 1, { reason: 'maintenance' });
  });

  it('an accepted authentication counts nothing and is one authenticated socket', async () => {
    const { ws, metrics, gateway } = build(jest.fn().mockResolvedValue(principal(['sessions:write'])));
    await authenticate(ws);
    expect(metrics.add).not.toHaveBeenCalled();
    expect(gateway.authenticatedCount()).toBe(1);
    gateway.handleDisconnect(ws);
    expect(gateway.authenticatedCount()).toBe(0);
  });

  it('an authentication timeout counts timeout', () => {
    jest.useFakeTimers();
    try {
      const { metrics } = build(jest.fn());
      jest.advanceTimersByTime(10 * 60_000);
      expect(metrics.add).toHaveBeenCalledWith(TERMINAL_WS_AUTH_DENIED_METRIC, 1, { reason: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SSH connect duration', () => {
  function build(behaviour: (client: any, config: any) => void) {
    (Client as unknown as jest.Mock).mockImplementation(() => {
      const client = new EventEmitter() as any;
      client.end = jest.fn();
      client.destroy = jest.fn();
      client.connect = jest.fn((config: any) => process.nextTick(() => behaviour(client, config)));
      return client;
    });
    const metrics = appMetrics();
    const factory = new SshConnectionFactory(
      { serverProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(null) } } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      { getNamespace: jest.fn().mockResolvedValue({ hostKeyPolicy: 'tofu_auto' }) } as never,
      metrics as never,
    );
    return { factory, metrics };
  }

  const open = (factory: SshConnectionFactory) => factory.open(PROFILE, { purpose: 'interactive' });
  const verified = (client: any, config: any) =>
    config.hostVerifier(KEY, (ok: boolean) =>
      ok ? client.emit('ready') : client.emit('error', new Error('Host denied (verification failed)')),
    );

  beforeEach(() => jest.clearAllMocks());

  it('records ok with only the outcome attribute', async () => {
    const { factory, metrics } = build(verified);
    await open(factory);
    expect(metrics.record).toHaveBeenCalledTimes(1);
    const [name, seconds, attributes] = metrics.record.mock.calls[0];
    expect(name).toBe(TERMINAL_SSH_CONNECT_DURATION_METRIC);
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(attributes).toEqual({ outcome: 'ok' });
  });

  it.each([
    ['auth_failed', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' })],
    ['timeout', Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' })],
    ['refused', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:22'), { code: 'ECONNREFUSED' })],
    ['error', new Error('something unexpected')],
  ])('classifies %s', async (outcome, error) => {
    const { factory, metrics } = build((client) => client.emit('error', error));
    await expect(open(factory)).rejects.toBeDefined();
    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record.mock.calls[0][2]).toEqual({ outcome });
  });

  it('classifies a changed host key as host_key_mismatch', async () => {
    const { factory, metrics } = build(verified);
    const failing = factory.open({ ...PROFILE, fingerprint: fingerprintOf(Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from('key-b-body')])) }, { purpose: 'interactive' });
    await expect(failing).rejects.toBeInstanceOf(HostKeyError);
    expect(metrics.record.mock.calls[0][2]).toEqual({ outcome: 'host_key_mismatch' });
  });

  it('never puts the host, profile or error text on the metric', async () => {
    const { factory, metrics } = build((client) => client.emit('error', new Error('boom server-a.example.test')));
    await expect(open(factory)).rejects.toBeDefined();
    expect(JSON.stringify(metrics.record.mock.calls)).not.toMatch(/server-a|1111|2222|3333|boom/);
  });
});

describe('reaper counter', () => {
  it('adds the count by action and skips zero', () => {
    const metrics = appMetrics();
    const service = new TerminalMetricsService({} as never, undefined, metrics as never);
    service.reaped('detached', 3);
    service.reaped('purged', 0);
    expect(metrics.add).toHaveBeenCalledTimes(1);
    expect(metrics.add).toHaveBeenCalledWith(TERMINAL_SESSIONS_REAPED_METRIC, 3, { action: 'detached' });
  });
});

describe('registered attributes', () => {
  const ALLOWED = new Set(['status', 'reason', 'outcome', 'action']);

  it('declares six metrics, every attribute a bounded enum from the allowed set', () => {
    expect(TERMINAL_APP_METRICS.map((m) => m.name).sort()).toEqual(
      [
        'app.terminal.sessions',
        'app.terminal.sessions.reaped',
        'app.terminal.ssh.connect.duration',
        'app.terminal.ssh.connections',
        'app.terminal.ws.auth_denied',
        'app.terminal.ws.connections',
      ].sort(),
    );
    for (const metric of TERMINAL_APP_METRICS) {
      for (const [name, spec] of Object.entries(metric.attributes ?? {})) {
        expect(ALLOWED.has(name)).toBe(true);
        expect((spec as { kind: string }).kind).toBe('enum');
      }
      expect(Object.keys(metric.attributes ?? {}).join(',')).not.toMatch(/user|host|session|org|profile|id/i);
    }
  });

  it('the dashboard group is the Terminal group', () => {
    expect(TERMINAL_METRIC_GROUP.id).toBe('terminal');
    expect(TERMINAL_METRIC_GROUP.label).toBe('Terminal');
  });
});
