// =============================================================================
// ShellKeep's webhook events (issue #54)
// =============================================================================
//
// What this proves, with invented placeholders only (`Server A`, `receiver.example.test`):
//
//   1. the three events are in the catalog with permanent keys, the owner's audience and the
//      permission the issue names, and every example validates against its own schema;
//   2. no payload field is secret-shaped, and the schemas are strict (an extra field, such as
//      terminal output, fails validation so nothing is sent);
//   3. every emit follows the write that raised it (an ordered log of statements and emits),
//      for create, terminate, batch terminate and the reaper (`reaped`), and a failing webhook
//      never fails or rolls back the action;
//   4. over the real webhooks services (in-memory ports): a Viewer-owned endpoint receives
//      `terminal.session.created` for its OWN sessions only, the delivery is signed and the
//      signature verifies with `verifyWebhookSignature`, and the body carries no secret.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { findWebhookEvent } from '@marinoscar/platform-api/webhooks';
import {
  KIT_ORG_ID,
  KIT_USER_A,
  KIT_USER_B,
  createWebhooksTestKit,
  makeWebhookOwner,
} from '@marinoscar/platform-api/webhooks/testing';
import { verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { SessionsService } from '../../src/terminal/sessions.service';
import { SessionReapHandler, type ReapedSession } from '../../src/terminal/jobs/session-reap.handler';
import { TerminalWebhooksService } from '../../src/terminal/webhooks/terminal-webhooks.service';
import {
  TERMINAL_WEBHOOK_EVENTS,
  hostKeyChangedDataSchema,
  sessionCreatedDataSchema,
  sessionTerminatedDataSchema,
} from '../../src/terminal/webhooks/terminal.webhook-events';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID_2 = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-23T12:00:00.000Z');

/** Field names that would carry a secret, terminal content or a host: none may appear in a payload. */
const SECRET_SHAPED = /secret|password|passphrase|private|token|credential|key(?!.*fingerprint)|output|command|stdin|stdout|hostname|host\b|username|user\b|address/i;

function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

describe('ShellKeep webhook events: the catalog and the payload schemas', () => {
  it.each([
    [TERMINAL_WEBHOOK_EVENTS.SESSION_CREATED, 'terminal.session.created', 'sessions:read'],
    [TERMINAL_WEBHOOK_EVENTS.SESSION_TERMINATED, 'terminal.session.terminated', 'sessions:read'],
    [TERMINAL_WEBHOOK_EVENTS.HOST_KEY_CHANGED, 'server_profile.host_key_changed', 'servers:read'],
  ])('registers %s for the owner with its permission', (key, expectedKey, permission) => {
    expect(key).toBe(expectedKey); // permanent
    const event = findWebhookEvent(key);
    expect(event).toBeDefined();
    expect(event).toMatchObject({ audience: 'user', permission, source: 'terminal' });
    // The example the catalog serves is a valid payload.
    expect(event!.payloadSchema.safeParse(event!.example).success).toBe(true);
  });

  it('carries ids, names and times only: no field of any payload is secret-shaped', () => {
    for (const schema of [sessionCreatedDataSchema, sessionTerminatedDataSchema, hostKeyChangedDataSchema]) {
      for (const field of shapeKeys(schema)) expect(field).not.toMatch(SECRET_SHAPED);
    }
    expect(shapeKeys(sessionCreatedDataSchema)).toEqual(['sessionId', 'serverProfileId', 'serverProfileName', 'createdAt']);
    expect(shapeKeys(sessionTerminatedDataSchema)).toEqual(['sessionId', 'serverProfileId', 'reason', 'terminatedAt']);
    expect(shapeKeys(hostKeyChangedDataSchema)).toEqual([
      'serverProfileId',
      'previousFingerprint',
      'presentedFingerprint',
      'detectedAt',
    ]);
  });

  it('is strict: an extra field (terminal output, a hostname, a key) fails validation, so nothing is sent', () => {
    const created = findWebhookEvent(TERMINAL_WEBHOOK_EVENTS.SESSION_CREATED)!.example as object;
    expect(sessionCreatedDataSchema.safeParse({ ...created, output: 'ls -la' }).success).toBe(false);
    expect(sessionCreatedDataSchema.safeParse({ ...created, hostname: 'server-a.example.test' }).success).toBe(false);
    const changed = findWebhookEvent(TERMINAL_WEBHOOK_EVENTS.HOST_KEY_CHANGED)!.example as object;
    expect(hostKeyChangedDataSchema.safeParse({ ...changed, privateKey: 'x' }).success).toBe(false);
  });

  it('accepts only the three termination reasons', () => {
    const base = findWebhookEvent(TERMINAL_WEBHOOK_EVENTS.SESSION_TERMINATED)!.example as Record<string, unknown>;
    for (const reason of ['user', 'reaped', 'batch']) expect(sessionTerminatedDataSchema.safeParse({ ...base, reason }).success).toBe(true);
    expect(sessionTerminatedDataSchema.safeParse({ ...base, reason: 'crashed' }).success).toBe(false);
  });
});

describe('ShellKeep webhook events: raised after the write commits', () => {
  /** One ordered log: every statement of the action and every webhook emit. */
  function harness(options: { emitThrows?: boolean } = {}) {
    const log: string[] = [];
    const emitted: Array<{ key: string; data: Record<string, unknown>; ctx: Record<string, unknown> }> = [];
    const webhooks = {
      emit: jest.fn(async (key: string, data: Record<string, unknown>, ctx: Record<string, unknown>) => {
        log.push(`emit:${key}:${String(data.reason ?? '')}`.replace(/:$/, ''));
        emitted.push({ key, data, ctx });
        if (options.emitThrows) throw new Error('webhooks down');
        return { matched: 0, queued: 0, eventId: 'e' };
      }),
    };
    const terminalWebhooks = new TerminalWebhooksService(webhooks as never);
    const row = (id: string) => ({
      id,
      userId: KIT_USER_A,
      orgId: KIT_ORG_ID,
      serverProfileId: PROFILE_ID,
      name: 'Session',
      status: 'terminated',
      terminatedAt: NOW,
      createdAt: NOW,
      serverProfile: { name: 'Server A', hostname: 'server-a.example.test', port: 22, username: 'sk', color: null },
    });
    const prisma = {
      serverProfile: {
        findFirst: jest.fn(async () => {
          log.push('read:profile');
          return { id: PROFILE_ID, name: 'Server A' };
        }),
      },
      terminalSession: {
        create: jest.fn(async () => {
          log.push('write:create');
          return row(SESSION_ID);
        }),
        findFirst: jest.fn(async () => {
          log.push('read:session');
          return row(SESSION_ID);
        }),
        findMany: jest.fn(async () => {
          log.push('read:targets');
          return [
            { id: SESSION_ID, serverProfileId: PROFILE_ID },
            { id: SESSION_ID_2, serverProfileId: PROFILE_ID },
          ];
        }),
        update: jest.fn(async () => {
          log.push('write:terminate');
          return row(SESSION_ID);
        }),
        updateMany: jest.fn(async () => {
          log.push('write:terminate-many');
          return { count: 2 };
        }),
        updateManyAndReturn: jest.fn(async () => {
          log.push('write:reap');
          return [reaped(SESSION_ID), reaped(SESSION_ID_2)];
        }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      $transaction: jest.fn(async () => {
        log.push('$transaction');
      }),
    };
    const audit = { record: jest.fn(async () => { log.push('audit'); }) };
    const sessions = new SessionsService(prisma as never, audit as never, terminalWebhooks, { require: jest.fn(async () => ({ allowed: true })) } as never, { enrich: async (p: unknown) => p } as never, { terminateSession: jest.fn(async () => undefined) } as never);
    return { log, emitted, prisma, sessions, terminalWebhooks, webhooks };
  }

  const scope = { userId: KIT_USER_A, orgId: KIT_ORG_ID };
  /** The caller as the guard hands it over (#71: a session is created on a server the caller may connect to). */
  const principal = { kind: 'user', userId: KIT_USER_A, email: 'person-a@example.test', credential: 'session', roles: [], permissions: ['sessions:write'], activeOrgId: KIT_ORG_ID } as never;
  function reaped(id: string): ReapedSession {
    return { id, userId: KIT_USER_A, orgId: KIT_ORG_ID, name: 'Session', serverProfileId: PROFILE_ID, lastActivityAt: NOW };
  }

  it('create: terminal.session.created follows the insert, with ids and the profile name only', async () => {
    const h = harness();
    await h.sessions.create(principal, { serverProfileId: PROFILE_ID } as never);

    expect(h.log.indexOf('emit:terminal.session.created')).toBeGreaterThan(h.log.indexOf('write:create'));
    expect(h.log).not.toContain('$transaction');
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].data).toEqual({
      sessionId: SESSION_ID,
      serverProfileId: PROFILE_ID,
      serverProfileName: 'Server A',
      createdAt: NOW.toISOString(),
    });
    expect(h.emitted[0].ctx).toMatchObject({ orgId: KIT_ORG_ID, userId: KIT_USER_A });
    expect(JSON.stringify(h.emitted[0].data)).not.toContain('server-a.example.test');
  });

  it('terminate: reason user, after the update', async () => {
    const h = harness();
    await h.sessions.terminate(SESSION_ID, scope);
    expect(h.log.indexOf('emit:terminal.session.terminated:user')).toBeGreaterThan(h.log.indexOf('write:terminate'));
    expect(h.emitted[0].data).toMatchObject({ sessionId: SESSION_ID, reason: 'user', terminatedAt: expect.any(String) });
  });

  it('batch terminate: one event per terminated session, reason batch, after the update', async () => {
    const h = harness();
    await h.sessions.batchTerminate([SESSION_ID, SESSION_ID_2], scope);
    const update = h.log.indexOf('write:terminate-many');
    const emits = h.log.filter((entry) => entry === 'emit:terminal.session.terminated:batch');
    expect(emits).toHaveLength(2);
    expect(h.log.indexOf('emit:terminal.session.terminated:batch')).toBeGreaterThan(update);
    expect(h.emitted.map((e) => e.data.sessionId)).toEqual([SESSION_ID, SESSION_ID_2]);
  });

  it('batch terminate: a session of another owner (not selected) raises nothing', async () => {
    const h = harness();
    h.prisma.terminalSession.findMany.mockResolvedValueOnce([]);
    await h.sessions.batchTerminate([SESSION_ID], scope);
    expect(h.emitted).toHaveLength(0);
  });

  it('the reaper: reason reaped, one per terminated session, after the updates and never inside a $transaction', async () => {
    const h = harness();
    const handler = new SessionReapHandler(
      { register: jest.fn() } as never,
      Object.assign(h.prisma, { serverProfile: { findMany: jest.fn(async () => [{ id: PROFILE_ID, name: 'Server A' }]) } }) as never,
      { getNamespace: async () => ({ detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 }) } as never,
      { notify: jest.fn(async () => undefined) } as never,
      h.terminalWebhooks,
      { terminateSession: jest.fn(async () => undefined) } as never,
    );
    await handler.process({} as never);

    const emits = h.log.filter((entry) => entry === 'emit:terminal.session.terminated:reaped');
    expect(emits).toHaveLength(2);
    expect(h.log.indexOf('emit:terminal.session.terminated:reaped')).toBeGreaterThan(h.log.indexOf('write:reap'));
    expect(h.log).not.toContain('$transaction');
  });

  it('the reaper closes the live connection of each terminated session and survives a failing close', async () => {
    const h = harness();
    const terminateSession = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const handler = new SessionReapHandler(
      { register: jest.fn() } as never,
      Object.assign(h.prisma, { serverProfile: { findMany: jest.fn(async () => [{ id: PROFILE_ID, name: 'Server A' }]) } }) as never,
      { getNamespace: async () => ({ detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 }) } as never,
      { notify: jest.fn(async () => undefined) } as never,
      h.terminalWebhooks,
      { terminateSession } as never,
    );
    await expect(handler.process({} as never)).resolves.toBeUndefined();
    expect(terminateSession).toHaveBeenCalledTimes(2);
  });

  it('a failing webhook never fails the action', async () => {
    const h = harness({ emitThrows: true });
    await expect(h.sessions.create(principal, { serverProfileId: PROFILE_ID } as never)).resolves.toBeDefined();
    await expect(h.sessions.terminate(SESSION_ID, scope)).resolves.toBeDefined();
    await expect(h.terminalWebhooks.hostKeyChanged(scope, { serverProfileId: PROFILE_ID, previousFingerprint: 'SHA256:a', presentedFingerprint: 'SHA256:b' })).resolves.toBeUndefined();
  });

  it('the host-key event carries both public fingerprints and the time, nothing else', async () => {
    const h = harness();
    await h.terminalWebhooks.hostKeyChanged(
      scope,
      { serverProfileId: PROFILE_ID, previousFingerprint: 'SHA256:previous', presentedFingerprint: 'SHA256:presented' },
      NOW,
    );
    expect(h.emitted[0].key).toBe('server_profile.host_key_changed');
    expect(h.emitted[0].data).toEqual({
      serverProfileId: PROFILE_ID,
      previousFingerprint: 'SHA256:previous',
      presentedFingerprint: 'SHA256:presented',
      detectedAt: NOW.toISOString(),
    });
  });
});

describe('ShellKeep webhook events: delivery over the real webhooks services', () => {
  const VIEWER_PERMISSIONS = ['webhooks:read', 'webhooks:write', 'sessions:read', 'servers:read'];
  const orgOwner = (id: string, permissions: string[]) => makeWebhookOwner({ id, orgId: KIT_ORG_ID, permissions });

  function setup() {
    const kit = createWebhooksTestKit();
    // What the `viewer` role holds: its own webhooks and read access to sessions and servers (no write).
    kit.repository.setOwner(orgOwner(KIT_USER_A, VIEWER_PERMISSIONS));
    kit.repository.setOwner(orgOwner(KIT_USER_B, VIEWER_PERMISSIONS));
    return { kit, terminal: new TerminalWebhooksService(kit.webhooks) };
  }

  const session = (id: string) => ({ id, serverProfileId: PROFILE_ID, createdAt: NOW });

  it('a Viewer-owned endpoint receives terminal.session.created for its own sessions only', async () => {
    const { kit, terminal } = setup();
    const mine = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['terminal.session.created'] });
    const theirs = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_B, eventKeys: ['terminal.session.created'] });

    await terminal.sessionCreated({ userId: KIT_USER_A, orgId: KIT_ORG_ID }, session(SESSION_ID), 'Server A');

    const deliveries = [...kit.repository.deliveries.values()];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].endpointId).toBe(mine.endpoint.id);

    await terminal.sessionCreated({ userId: KIT_USER_B, orgId: KIT_ORG_ID }, session(SESSION_ID_2), 'Server B');
    const byEndpoint = [...kit.repository.deliveries.values()].map((d) => d.endpointId).sort();
    expect(byEndpoint).toEqual([mine.endpoint.id, theirs.endpoint.id].sort());
    // Each owner's endpoint saw exactly its own session.
    for (const delivery of kit.repository.deliveries.values()) {
      const body = delivery.payload as { data: { sessionId: string } };
      expect(body.data.sessionId).toBe(delivery.endpointId === mine.endpoint.id ? SESSION_ID : SESSION_ID_2);
    }
  });

  it('an organization or deployment endpoint does not see a member terminal activity', async () => {
    const { kit, terminal } = setup();
    await kit.seedEndpoint({ scope: 'org', eventKeys: ['*'] });
    await kit.seedEndpoint({ scope: 'system', eventKeys: ['*'] });
    await terminal.sessionCreated({ userId: KIT_USER_A, orgId: KIT_ORG_ID }, session(SESSION_ID), 'Server A');
    expect(kit.repository.deliveries.size).toBe(0);
  });

  it('signs the delivery (verifies with verifyWebhookSignature) and carries no secret', async () => {
    const { kit, terminal } = setup();
    const { endpoint, secret } = await kit.seedEndpoint({
      scope: 'user',
      ownerUserId: KIT_USER_A,
      eventKeys: ['terminal.*'],
    });

    await terminal.sessionCreated({ userId: KIT_USER_A, orgId: KIT_ORG_ID }, session(SESSION_ID), 'Server A');
    await terminal.sessionTerminated({ userId: KIT_USER_A, orgId: KIT_ORG_ID }, session(SESSION_ID), 'user', NOW);
    const deliveries = [...kit.repository.deliveries.values()].filter((d) => d.endpointId === endpoint.id);
    expect(deliveries.map((d) => d.eventKey).sort()).toEqual(['terminal.session.created', 'terminal.session.terminated']);

    for (const delivery of deliveries) {
      await kit.runDeliveryJob(delivery.id);
    }
    expect(kit.receiver.requests).toHaveLength(2);
    for (const request of kit.receiver.requests) {
      const valid = await verifyWebhookSignature({
        secret,
        id: request.headers['webhook-id'],
        timestamp: request.headers['webhook-timestamp'],
        body: request.body,
        signatureHeader: request.headers['webhook-signature'],
      });
      expect(valid).toBe(true);
      // The signing secret never rides in the body or a header other than as a signature.
      expect(request.body).not.toContain(secret);
      expect(JSON.stringify(request.headers)).not.toContain(secret);
      expect(request.body).not.toMatch(/server-a\.example\.test|password|private_key|passphrase/i);
    }
    const body = JSON.parse(kit.receiver.requests.find((r) => r.body.includes('terminated'))!.body);
    expect(body).toMatchObject({ type: 'terminal.session.terminated', data: { sessionId: SESSION_ID, reason: 'user' } });
  });

  it('switches off an endpoint whose owner lost the permission instead of delivering', async () => {
    const { kit, terminal } = setup();
    kit.repository.setOwner(orgOwner(KIT_USER_A, []));
    const { endpoint } = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['terminal.session.created'] });
    await terminal.sessionCreated({ userId: KIT_USER_A, orgId: KIT_ORG_ID }, session(SESSION_ID), 'Server A');
    expect(kit.repository.deliveries.size).toBe(0);
    expect(kit.repository.endpoints.get(endpoint.id)).toMatchObject({ enabled: false });
  });
});
