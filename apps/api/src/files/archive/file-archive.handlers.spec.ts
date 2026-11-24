// =============================================================================
// The folder archive jobs pass the platform's handler conformance (issue #158)
// =============================================================================
//
// `files.archive` holds an SSH connection and is SERVER-ONLY (no `nodeResultSchema`, no `persistNodeResult`);
// `files.archive.purge` deletes through the bypass client and is server-only too. The payload scenarios run
// twice through a fake queue over a database stub in which the archive does not exist: the second run must
// change nothing. The real flow is covered by `test/files/files-archive.integration.spec.ts`.
// =============================================================================

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { Test } from '@nestjs/testing';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { FILES_ARCHIVE_JOB_TYPE, FILES_ARCHIVE_PURGE_JOB_TYPE } from './archive.constants';
import { FileArchiveHandler } from './file-archive.handler';
import { FileArchivePurgeHandler } from './file-archive-purge.handler';
import { FileArchiveTask } from './file-archive.task';

const ARCHIVE = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b01';
const ORG = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b03';
const USER = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b04';
const PROFILE = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b05';

const empty = { findFirst: async () => null, findMany: async () => [], update: async () => ({}), deleteMany: async () => ({ count: 0 }) };
const tx = { $executeRaw: async () => 0, fileArchive: empty };
const stubPrisma: any = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx), $executeRaw: async () => 0, $connect: async () => undefined, $extends: () => undefined };
const none = new Proxy({}, { get: () => async () => undefined }) as never;

const archiveHandler = () => new FileArchiveHandler(new JobHandlerRegistry(), stubPrisma, none, none, none, none, none, none, none);
const purgeHandler = () =>
  new FileArchivePurgeHandler(new JobHandlerRegistry(), { runAsSystem: async (_reason: string, fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never, none, none);

describeJobHandlerConformance(FILES_ARCHIVE_JOB_TYPE, archiveHandler, {
  payloads: [
    {
      name: 'an archive that does not exist is a no-op',
      payload: { archiveId: ARCHIVE, orgId: ORG, userId: USER, serverProfileId: PROFILE, path: '/srv/data' },
      subjectType: 'file_archive',
      subjectId: ARCHIVE,
      orgId: ORG,
      reason: 'files_archive',
    },
  ],
});

describeJobHandlerConformance(FILES_ARCHIVE_PURGE_JOB_TYPE, purgeHandler, {
  payloads: [{ name: 'a pass with nothing expired changes nothing', payload: null, orgId: null, reason: 'files_archive' }],
});

describe('node eligibility of the archive jobs', () => {
  it('keeps both server-only, permanently', () => {
    const registry = new JobHandlerRegistry();
    const archive = new FileArchiveHandler(registry, stubPrisma, none, none, none, none, none, none, none);
    const purge = new FileArchivePurgeHandler(registry, none, none, none);
    registry.register(archive);
    registry.register(purge);
    expect(registry.serverOnlyTypes()).toEqual(expect.arrayContaining([FILES_ARCHIVE_JOB_TYPE, FILES_ARCHIVE_PURGE_JOB_TYPE]));
    expect(archive).not.toHaveProperty('nodeResultSchema');
    expect(archive).not.toHaveProperty('persistNodeResult');
    expect(archive).not.toHaveProperty('nodeSecretBroker');
    expect(archive.profile).toEqual({ maxRuntimeMs: 30 * 60_000, maxAttempts: 1 });
  });

  it('rejects a payload that names a relative path (never a shell-ish string)', async () => {
    const handler = archiveHandler();
    await expect(
      handler.process({ id: 'j', orgId: ORG, payload: { archiveId: ARCHIVE, orgId: ORG, userId: USER, serverProfileId: PROFILE, path: 'relative' } } as never),
    ).rejects.toThrow();
  });
});

describe('FileArchivePurgeHandler (expiry)', () => {
  const NOW = new Date('2026-11-25T12:00:00Z');

  function build(rows: { id: string; storageKey: string | null }[], failKeys: string[] = []) {
    const store = [...rows];
    const deletedKeys: string[] = [];
    const system = {
      runAsSystem: async (_reason: string, fn: (t: unknown) => Promise<unknown>) =>
        fn({
          fileArchive: {
            findMany: async ({ where }: any) => store.filter((r) => !(where.id?.notIn ?? []).includes(r.id)).slice(0, 200),
            deleteMany: async ({ where }: any) => {
              for (const id of where.id.in) store.splice(store.findIndex((r) => r.id === id), 1);
              return { count: where.id.in.length };
            },
          },
        }),
    };
    const storage = {
      deleteMany: async (keys: string[]) => ({
        deleted: keys.filter((k) => !failKeys.includes(k)),
        failed: keys.filter((k) => failKeys.includes(k)).map((key) => ({ key, message: 'denied' })),
      }),
      delete: async (key: string) => {
        if (failKeys.includes(key)) throw new Error('denied');
        deletedKeys.push(key);
      },
    };
    const handler = new FileArchivePurgeHandler(new JobHandlerRegistry(), system as never, storage as never, none);
    return { handler, store, deletedKeys };
  }

  it('deletes expired rows (with and without an object)', async () => {
    const { handler, store } = build([
      { id: 'a', storageKey: 'file-archives/o/a/archive.tar.gz' },
      { id: 'b', storageKey: null },
    ]);
    expect(await handler.purgeExpired(NOW)).toBe(2);
    expect(store).toHaveLength(0);
  });

  it('keeps the row of an object it could not delete, and deletes the rest', async () => {
    const { handler, store } = build(
      [
        { id: 'a', storageKey: 'k-a' },
        { id: 'b', storageKey: 'k-b' },
      ],
      ['k-a'],
    );
    expect(await handler.purgeExpired(NOW)).toBe(1);
    expect(store.map((r) => r.id)).toEqual(['a']);
  });

  it('selects only archives whose expires_at passed', async () => {
    let seen: any;
    const system = { runAsSystem: async (_r: string, fn: any) => fn({ fileArchive: { findMany: async (args: any) => ((seen = args), []), deleteMany: async () => ({ count: 0 }) } }) };
    await new FileArchivePurgeHandler(new JobHandlerRegistry(), system as never, none, none).purgeExpired(NOW);
    expect(seen.where.expiresAt).toEqual({ lt: NOW });
  });
});

describe('FileArchivePurgeHandler (orphan objects)', () => {
  const NOW = new Date('2026-11-25T12:00:00Z');
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const keyOf = (n: number) => `file-archives/11111111-2222-4333-8444-555555555555/${id(n)}/archive.tar.gz`;

  function build(options: { keys: string[]; rows: number[]; createdAt?: Record<string, string>; noList?: boolean }) {
    const deleted: string[] = [];
    const queries: string[][] = [];
    const system = {
      runAsSystem: async (_r: string, fn: any) =>
        fn({
          fileArchive: {
            findMany: async ({ where }: any) => {
              if (where.id?.in) {
                queries.push(where.id.in);
                return where.id.in.filter((i: string) => options.rows.some((n) => id(n) === i)).map((i: string) => ({ id: i }));
              }
              return [];
            },
            deleteMany: async () => ({ count: 0 }),
          },
        }),
    };
    const storage = {
      getMetadata: async (key: string) => (options.createdAt?.[key] ? { 'created-at': options.createdAt[key] } : null),
      deleteMany: async (keys: string[]) => (deleted.push(...keys), { deleted: keys, failed: [] }),
      delete: async (key: string) => void deleted.push(key),
    };
    const listed: string[] = [];
    const lister = {
      listKeys: async (prefix: string) =>
        options.noList
          ? null
          : (async function* () {
              expect(prefix).toBe('file-archives/');
              for (const key of options.keys) {
                listed.push(key);
                yield key;
              }
            })(),
    };
    const handler = new FileArchivePurgeHandler(new JobHandlerRegistry(), system as never, storage as never, lister as never);
    return { handler, deleted, queries, listed };
  }

  it('deletes objects whose archive has no row and keeps the ones that have one', async () => {
    const { handler, deleted } = build({ keys: [keyOf(1), keyOf(2), keyOf(3)], rows: [2] });
    expect(await handler.sweepOrphans(NOW)).toBe(2);
    expect(deleted.sort()).toEqual([keyOf(1), keyOf(3)]);
  });

  it('leaves an orphan younger than one hour, and treats one with no age as old', async () => {
    const { handler, deleted } = build({
      keys: [keyOf(1), keyOf(2), keyOf(3)],
      rows: [],
      createdAt: { [keyOf(1)]: '2026-11-25T11:30:00Z', [keyOf(2)]: '2026-11-25T10:59:00Z' },
    });
    expect(await handler.sweepOrphans(NOW)).toBe(2);
    expect(deleted.sort()).toEqual([keyOf(2), keyOf(3)]);
  });

  it('ignores keys that are not an archive object', async () => {
    const { handler, deleted, queries } = build({ keys: ['file-archives/stray.txt', 'file-archives/a/b/c/d'], rows: [] });
    expect(await handler.sweepOrphans(NOW)).toBe(0);
    expect(deleted).toEqual([]);
    expect(queries).toEqual([]);
  });

  it('checks the table in bounded batches', async () => {
    const keys = Array.from({ length: 450 }, (_, i) => keyOf(i + 1));
    const { handler, queries } = build({ keys, rows: [] });
    await handler.sweepOrphans(NOW);
    expect(queries.map((q) => q.length)).toEqual([200, 200, 50]);
  });

  it('examines a bounded number of keys per run and resumes after the last one, then wraps', async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => keyOf(i + 1)).sort();
    const { handler, deleted } = build({ keys, rows: [] });
    expect(await handler.sweepOrphans(NOW)).toBe(2000);
    expect(deleted).toHaveLength(2000);
    // The second run continues where the first stopped and reaches the end.
    expect(await handler.sweepOrphans(NOW)).toBe(500);
    expect(new Set(deleted).size).toBe(2500);
    // The listing is exhausted: the next run starts from the beginning again.
    const again = await handler.sweepOrphans(NOW);
    expect(again).toBe(2000);
  });

  it('skips the sweep when the storage driver cannot list', async () => {
    const { handler, deleted } = build({ keys: [keyOf(1)], rows: [], noList: true });
    expect(await handler.sweepOrphans(NOW)).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('never fails the expiry job when the listing fails', async () => {
    const system = { runAsSystem: async (_r: string, fn: any) => fn({ fileArchive: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) } }) };
    const lister = { listKeys: async () => { throw new Error('boom'); } };
    const handler = new FileArchivePurgeHandler(new JobHandlerRegistry(), system as never, none, lister as never);
    await expect(handler.process({ id: 'j' } as never)).resolves.toBeUndefined();
  });
});

describe('FileArchiveTask (enqueue-only cron)', () => {
  it('keeps its hourly schedule and enqueues one system purge job without touching archives', async () => {
    const jobs = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue(null) }, fileArchive: { findMany: jest.fn(), deleteMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [FileArchiveTask, { provide: JobsService, useValue: jobs }, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const task = moduleRef.get(FileArchiveTask);
    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', FileArchiveTask.prototype.handleExpiry).cronTime).toBe('0 17 * * * *');

    await task.handleExpiry();
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: FILES_ARCHIVE_PURGE_JOB_TYPE, orgId: null }));
    for (const method of Object.values(prisma.fileArchive)) expect(method).not.toHaveBeenCalled();

    jobs.enqueue.mockClear();
    prisma.job.findFirst.mockResolvedValue({ id: 'running' });
    await task.handleExpiry();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
