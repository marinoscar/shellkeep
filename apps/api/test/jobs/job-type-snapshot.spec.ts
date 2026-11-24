// =============================================================================
// JOB TYPE STRINGS ARE PERMANENT (issue #49): ShellKeep's snapshot
// =============================================================================
//
// A `Job.type` is written into every row the queue holds. Once rows of a type
// exist, renaming or dropping the string strands them: no handler claims the
// pending ones and the Jobs page can no longer label the history. So the set of
// types the booted app registers is pinned here, with each type's display label
// (a `readonly label` on the handler):
//
//   - a type that DISAPPEARS fails with "job type strings are permanent";
//   - a NEW type fails until it is added below (a deliberate, reviewed step);
//   - a label that changes fails, so the Jobs page keeps showing what operators
//     know (`typeLabel` in GET /api/admin/jobs, asserted over HTTP).
//
// Labels may legitimately change; update the entry in the same pull request.
// Types may not.
// =============================================================================

import request from 'supertest';
import { JobHandlerRegistry, jobTypeLabel } from '@marinoscar/platform-api/jobs';

import { createTestApp, closeTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';

/** Every job type the booted app registers, with its display label. */
const REGISTERED_JOB_TYPES: Readonly<Record<string, string>> = {
  // ShellKeep's own (#49): the session reaper, queued by an enqueue-only cron.
  'terminal.session.reap': 'Reap idle terminal sessions',
  // The jobs slice: its own housekeeping.
  'job.history.purge': 'Job history purge',
  'audit.events.purge': 'Audit log purge',
  // The nodes slice: the fleet sweep, prune and event purge.
  'nodes.fleet.sweep': 'Fleet sweep',
  'nodes.fleet.prune': 'Fleet prune',
  'nodes.node_events_purge': 'Node events purge',
  // The identity slice: expired credential cleanup. The OAuth server's types register only
  // when that server is enabled, which ShellKeep does not do.
  'auth.token.cleanup': 'Token cleanup',
  'device-auth.code.cleanup': 'Device code cleanup',
  // The storage slice (#50): stale-upload sweep, post-upload processing, provider migration.
  'storage.cleanup.stale-uploads': 'Stale upload cleanup',
  'storage.migrate_object': 'Storage migration (copy object)',
  'storage.migrate_plan': 'Storage migration (plan)',
  'storage.object.process': 'Object processing',
  // The notifications slice (#51): the admin broadcast fan-out and the two retention purges.
  'admin.broadcast.start': 'Broadcast start',
  'admin.broadcast.chunk': 'Broadcast delivery',
  'notifications.inbox.purge': 'Notification inbox purge',
  'notifications.deliveries.purge': 'Delivery log purge',
  // The db-backup slice (#52): the backup run, its sweep, the restore and the displaced database's cleanup.
  'db.backup.run': 'Database backup',
  'db.backup.sweep': 'Backup sweep',
  'db.restore.run': 'Database restore',
  'db.restore.old-db-drop': 'Restore cleanup',
  // The AI slice (#55): background runs, the catalogue and key rechecks and the two retention purges.
  // Every ai.* type is server-only (no node ever holds a provider key).
  'ai.response.run': 'AI background response',
  'ai.image.generate': 'AI image generation',
  'ai.audio.transcribe': 'AI audio transcription',
  'ai.audio.speech': 'AI speech synthesis',
  'ai.catalog.refresh': 'AI model catalog refresh',
  'ai.keys.recheck': 'AI key recheck',
  'ai.runs.purge': 'AI run purge',
  'ai.usage.purge': 'AI usage purge',
};

/** Types registered without a label of their own, shown as the type string. */
const UNLABELLED_JOB_TYPES: readonly string[] = [];

describe('job type strings are permanent (#49)', () => {
  let context: TestContext;
  let registered: Set<string>;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    registered = new Set(context.app.get(JobHandlerRegistry).types());
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('registers the terminal reaper', () => {
    expect(registered.has('terminal.session.reap')).toBe(true);
  });

  it('still registers every job type it ever registered', () => {
    const expected = [...Object.keys(REGISTERED_JOB_TYPES), ...UNLABELLED_JOB_TYPES];
    const missing = expected.filter((type) => !registered.has(type));

    if (missing.length > 0) {
      throw new Error(
        `Job type strings are permanent: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer registered. ` +
          'Rows of a type outlive its handler; keep the type string (and a handler for it), or retire it with a ' +
          'migration plan, never by renaming.',
      );
    }
  });

  it('lists every registered type here, so a new one is a reviewed addition', () => {
    const known = new Set([...Object.keys(REGISTERED_JOB_TYPES), ...UNLABELLED_JOB_TYPES]);
    const unlisted = [...registered].filter((type) => !known.has(type)).sort();

    expect(unlisted).toEqual([]);
  });

  it('keeps every label, read from the handlers themselves', () => {
    const labels = Object.fromEntries(Object.keys(REGISTERED_JOB_TYPES).map((type) => [type, jobTypeLabel(type)]));

    expect(labels).toEqual(REGISTERED_JOB_TYPES);
    for (const type of UNLABELLED_JOB_TYPES) expect(jobTypeLabel(type)).toBe(type);
  });

  it('serves the same typeLabel for every type in GET /api/admin/jobs', async () => {
    resetPrismaMock();
    setupBaseMocks();
    const prisma = context.prismaMock;
    const types = Object.keys(REGISTERED_JOB_TYPES);
    prisma.job.findMany.mockResolvedValue(
      types.map((type, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        type,
        subjectType: null,
        subjectId: null,
        dedupKey: null,
        status: 'succeeded',
        reason: 'backfill',
        priority: 0,
        providerKey: null,
        modelVersion: null,
        attempts: 1,
        lastError: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        startedAt: null,
        finishedAt: null,
        scheduledFor: null,
        rateLimitedAt: null,
        rateLimitHits: 0,
        claimedByNodeId: null,
        leaseExpiresAt: null,
        executor: null,
        orgId: null,
      })),
    );
    prisma.job.count.mockResolvedValue(types.length);
    const admin = await createMockAdminUser(context);

    const response = await request(context.app.getHttpServer())
      .get('/api/admin/jobs?pageSize=100')
      .set(authHeader(admin.accessToken))
      .expect(200);

    const served = Object.fromEntries(
      (response.body.data.items as Array<{ type: string; typeLabel: string }>).map((item) => [item.type, item.typeLabel]),
    );
    expect(served).toEqual(REGISTERED_JOB_TYPES);
  });
});
