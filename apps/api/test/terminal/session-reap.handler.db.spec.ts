// =============================================================================
// `terminal.session.reap` over a real database (issue #49)
// =============================================================================
//
// Boots the handler's real dependencies (PrismaService, the platform settings slice)
// against the migrated and seeded database (POSTGRES_*), seeds sessions at each side
// of every threshold, and proves the three statements, the thresholds read from the
// `terminal` system settings, the idempotent re-run and the terminated ids. Rows it
// seeds carry a unique `@example.test` owner and are deleted at the end. Run with
// `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';

import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionReapHandler, TERMINAL_SESSION_REAP_TYPE } from '../../src/terminal/jobs/session-reap.handler';

const RUN = randomBytes(4).toString('hex');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('SessionReapHandler (real database)', () => {
  let prisma: PrismaService;
  let handler: SessionReapHandler;
  let thresholds = { detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 };
  const registered: unknown[] = [];
  const notify = jest.fn(async () => undefined);

  let orgId: string;
  let userId: string;
  let profileId: string;
  const now = new Date('2026-11-23T12:00:00Z');

  const ago = (ms: number) => new Date(now.getTime() - ms);

  async function seed(name: string, status: 'active' | 'detached' | 'terminated', lastActivityMs: number, terminatedMs?: number) {
    return prisma.terminalSession.create({
      data: {
        userId,
        orgId,
        serverProfileId: profileId,
        name: `${RUN}-${name}`,
        status,
        tmuxSessionId: `${RUN}-${name}`,
        lastActivityAt: ago(lastActivityMs),
        terminatedAt: terminatedMs === undefined ? null : ago(terminatedMs),
      },
    });
  }

  const statusOf = async (id: string) =>
    (await prisma.terminalSession.findUnique({ where: { id }, select: { status: true } }))?.status ?? 'deleted';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SessionReapHandler,
        PrismaService,
        { provide: JobHandlerRegistry, useValue: { register: (h: unknown) => registered.push(h) } },
        { provide: SystemSettingsService, useValue: { getNamespace: async () => thresholds } },
        { provide: NotificationsService, useValue: { notify } },
      ],
    }).compile();
    prisma = module.get(PrismaService);
    handler = module.get(SessionReapHandler);

    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { email: `reap-${RUN}@example.test`, providerDisplayName: 'Reap Test', isActive: true },
    });
    userId = user.id;
    const profile = await prisma.serverProfile.create({
      data: {
        userId,
        orgId,
        name: `${RUN}-profile`,
        hostname: 'localhost',
        port: 22,
        username: 'tester',
        authMethod: 'password',
      },
    });
    profileId = profile.id;
  });

  afterAll(async () => {
    await prisma.terminalSession.deleteMany({ where: { userId } });
    await prisma.serverProfile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('declares a permanent type, a label and its profile, and is server-only', () => {
    expect(handler.type).toBe('terminal.session.reap');
    expect(TERMINAL_SESSION_REAP_TYPE).toBe('terminal.session.reap');
    expect(handler.label).toBe('Reap idle terminal sessions');
    expect(handler.profile).toEqual({ maxRuntimeMs: 120_000, maxAttempts: 3 });
    expect((handler as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((handler as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
    handler.onModuleInit();
    expect(registered).toContain(handler);
  });

  it('applies each statement exactly at its boundary, with the default thresholds', async () => {
    thresholds = { detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 };
    const freshActive = await seed('fresh-active', 'active', 59 * MINUTE);
    const exactActive = await seed('exact-active', 'active', 60 * MINUTE);
    const staleActive = await seed('stale-active', 'active', 61 * MINUTE);
    const freshDetached = await seed('fresh-detached', 'detached', 11 * HOUR);
    const staleDetached = await seed('stale-detached', 'detached', 13 * HOUR);
    const recentTerminated = await seed('recent-terminated', 'terminated', 20 * DAY, 2 * DAY);
    const oldTerminated = await seed('old-terminated', 'terminated', 20 * DAY, 4 * DAY);

    const result = await handler.reap(now);

    expect(await statusOf(freshActive.id)).toBe('active');
    // A cutoff is strict: idle for exactly the threshold is not yet stale.
    expect(await statusOf(exactActive.id)).toBe('active');
    expect(await statusOf(staleActive.id)).toBe('detached');
    expect(await statusOf(freshDetached.id)).toBe('detached');
    expect(await statusOf(staleDetached.id)).toBe('terminated');
    expect(await statusOf(recentTerminated.id)).toBe('terminated');
    expect(await statusOf(oldTerminated.id)).toBe('deleted');

    const terminated = await prisma.terminalSession.findUniqueOrThrow({ where: { id: staleDetached.id } });
    expect(terminated.terminatedAt?.getTime()).toBe(now.getTime());

    // The ids a notification needs, for the session this pass terminated.
    expect(result.terminatedSessions).toContainEqual(
      expect.objectContaining({
        id: staleDetached.id,
        userId,
        orgId,
        name: `${RUN}-stale-detached`,
        serverProfileId: profileId,
        lastActivityAt: staleDetached.lastActivityAt,
      }),
    );
    expect(result.terminatedSessions.map((row) => row.id)).not.toContain(freshDetached.id);
    expect(result.detached).toBeGreaterThanOrEqual(1);
    expect(result.terminated).toBe(result.terminatedSessions.length);
    expect(result.purged).toBeGreaterThanOrEqual(1);
  });

  it('runs the three statements in order within one pass: a long-idle active session detaches, then terminates', async () => {
    const longIdle = await seed('long-idle-active', 'active', 20 * HOUR);

    const result = await handler.reap(now);

    expect(await statusOf(longIdle.id)).toBe('terminated');
    expect(result.terminatedSessions.map((row) => row.id)).toContain(longIdle.id);
  });

  it('is idempotent: a second pass over the same state changes nothing', async () => {
    const first = await handler.reap(now);
    const second = await handler.reap(now);

    expect(second).toEqual({ detached: 0, terminated: 0, purged: 0, terminatedSessions: [] });
    expect(first.terminated).toBe(first.terminatedSessions.length);
  });

  it('reads the thresholds from the settings on every run', async () => {
    const idle = await seed('settings-active', 'active', 10 * MINUTE);

    thresholds = { ...thresholds, detachAfterMinutes: 30 };
    await handler.reap(now);
    expect(await statusOf(idle.id)).toBe('active');

    thresholds = { ...thresholds, detachAfterMinutes: 5 };
    const result = await handler.reap(now);
    expect(await statusOf(idle.id)).toBe('detached');
    expect(result.detached).toBeGreaterThanOrEqual(1);

    thresholds = { ...thresholds, terminateDetachedAfterHours: 1, detachAfterMinutes: 60 };
    const later = new Date(now.getTime() + 2 * HOUR);
    const terminatedPass = await handler.reap(later);
    expect(await statusOf(idle.id)).toBe('terminated');
    expect(terminatedPass.terminatedSessions.map((row) => row.id)).toContain(idle.id);

    thresholds = { ...thresholds, purgeTerminatedAfterDays: 1 };
    const muchLater = new Date(later.getTime() + 2 * DAY);
    await handler.reap(muchLater);
    expect(await statusOf(idle.id)).toBe('deleted');
  });

  it('process() runs a pass and returns nothing', async () => {
    await expect(handler.process({ id: 'job-1' } as never)).resolves.toBeUndefined();
  });

  it('process() sends one terminal.session_reaped per owner, naming the session and its profile', async () => {
    thresholds = { detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 };
    notify.mockClear();
    const first = await seed('notify-a', 'detached', 40 * HOUR);
    const second = await seed('notify-b', 'detached', 60 * HOUR);
    // process() measures from the real clock: a session idle 40 and 60 hours before `now`
    // is idle even longer by then, so both are past the 12 hour limit.
    await handler.process({ id: 'job-2' } as never);

    const calls = notify.mock.calls as unknown as Array<[string, string, { sessions: Array<{ name: string; serverName: string }>; moreCount: number }]>;
    const mine = calls.filter(([, owner]) => owner === userId);
    expect(mine).toHaveLength(1);
    const [event, , data] = mine[0];
    expect(event).toBe('terminal.session_reaped');
    expect(data.sessions.map((line) => line.name).sort()).toEqual([`${RUN}-notify-a`, `${RUN}-notify-b`].sort());
    expect(data.sessions.every((line) => line.serverName === `${RUN}-profile`)).toBe(true);
    expect(await statusOf(first.id)).toBe('terminated');
    expect(await statusOf(second.id)).toBe('terminated');
  });
});
