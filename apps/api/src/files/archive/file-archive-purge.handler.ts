// =============================================================================
// `files.archive.purge` (issue #158): the 24-hour expiry of folder archives
// =============================================================================
//
// A SYSTEM job (`orgId: null`) queued hourly by `FileArchiveTask`, an enqueue-only `@Cron`. It selects archives whose
// `expires_at` has passed across organizations (bypass client, registered reason `files-archive-purge`),
// deletes their objects from storage and then their rows. Objects first, rows after: a failed object delete
// leaves the row so the next pass retries; a row whose delete failed is skipped for the rest of this job.
// Bounded batches; idempotent, so at-least-once delivery is safe. A pending or running row past its expiry is
// a job that was lost: its object (if any) goes too. SERVER-ONLY (bypass client).
//
// ORPHAN SWEEP. Account deletion and a factory reset delete `file_archives` rows (cascade) without their objects.
// After the expiry pass the job lists the keys under `file-archives/` (the DRIVER's `listKeys`, through the
// `ARCHIVE_OBJECT_LISTER` port: `StorageProvider` itself cannot list) and deletes every object whose archive id
// (the third key segment) has no row. It examines at most `ORPHAN_SCAN_LIMIT` keys per run and remembers where it
// stopped (in memory: the API is a single instance), so a big backlog spreads over runs and the listing wraps to
// the start when it ends. An object younger than an hour (its `created-at` metadata, written at upload) is left
// alone, so a build the sweep cannot see is never raced; an object with no such metadata is treated as old. A
// deployment whose driver cannot list skips the sweep.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER, deleteStorageKeys, type StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import {
  ARCHIVE_CREATED_AT_METADATA,
  FILES_ARCHIVE_PURGE_JOB_TYPE,
  FILES_ARCHIVE_PURGE_REASON,
  FILE_ARCHIVES_KEY_PREFIX,
  ORPHAN_BATCH,
  ORPHAN_MIN_AGE_MS,
  ORPHAN_SCAN_LIMIT,
} from './archive.constants';
import { ARCHIVE_OBJECT_LISTER, type ArchiveObjectLister } from './archive-object-lister';

const BATCH = 200;
const MAX_BATCHES = 50;

@Injectable()
export class FileArchivePurgeHandler implements JobHandler, OnModuleInit {
  readonly type = FILES_ARCHIVE_PURGE_JOB_TYPE;
  readonly label = 'Purge expired folder archives';
  readonly profile = { maxRuntimeMs: 10 * 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(FileArchivePurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly system: PrismaSystemService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(ARCHIVE_OBJECT_LISTER) private readonly lister: ArchiveObjectLister,
  ) {}

  /** Where the last orphan sweep stopped (a key), or null to start from the beginning. In memory. */
  private cursor: string | null = null;

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const purged = await this.purgeExpired(new Date());
    if (purged > 0) this.logger.log(`files.archive.purge: ${purged} expired archive(s) deleted`);
    try {
      const orphans = await this.sweepOrphans(new Date());
      if (orphans > 0) this.logger.log(`files.archive.purge: ${orphans} orphan object(s) deleted`);
    } catch (error) {
      // The expiry pass is the job; a listing that fails is retried by the next run.
      this.logger.warn(`files.archive.purge: orphan sweep failed (${error instanceof Error ? error.name : 'error'})`);
    }
  }

  /**
   * Deletes the objects under `file-archives/` that have no row, examining at most `ORPHAN_SCAN_LIMIT` keys after the
   * cursor. Returns how many objects it deleted.
   */
  async sweepOrphans(now: Date): Promise<number> {
    const prefix = `${FILE_ARCHIVES_KEY_PREFIX}/`;
    const keys = await this.lister.listKeys(prefix);
    if (!keys) {
      this.logger.log('files.archive.purge: the storage driver cannot list keys, orphan sweep skipped');
      return 0;
    }
    const resumeAfter = this.cursor;
    let scanned = 0;
    let deleted = 0;
    let batch: string[] = [];
    let exhausted = true;
    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      deleted += await this.deleteOrphans(batch, now);
      batch = [];
    };
    for await (const key of keys) {
      if (resumeAfter !== null && key <= resumeAfter) continue;
      if (scanned >= ORPHAN_SCAN_LIMIT) {
        exhausted = false;
        break;
      }
      scanned += 1;
      this.cursor = key;
      batch.push(key);
      if (batch.length >= ORPHAN_BATCH) await flush();
    }
    await flush();
    if (exhausted) this.cursor = null; // wrap around on the next run
    return deleted;
  }

  /** The keys of this batch whose archive has no row and that are old enough, deleted. */
  private async deleteOrphans(keys: string[], now: Date): Promise<number> {
    // `file-archives/<orgId>/<archiveId>/archive.tar.gz`
    const idOf = new Map<string, string>();
    for (const key of keys) {
      const parts = key.split('/');
      if (parts.length === 4 && /^[0-9a-f-]{36}$/i.test(parts[2] ?? '')) idOf.set(key, (parts[2] as string).toLowerCase());
    }
    if (idOf.size === 0) return 0;
    const ids = [...new Set(idOf.values())];
    const present = new Set<string>(
      (
        await this.system.runAsSystem(FILES_ARCHIVE_PURGE_REASON, (tx) =>
          tx.fileArchive.findMany({ where: { id: { in: ids } }, select: { id: true } }),
        )
      ).map((row: { id: string }) => row.id.toLowerCase()),
    );
    const doomed: string[] = [];
    for (const [key, id] of idOf) {
      if (present.has(id)) continue;
      const metadata = await this.storage.getMetadata(key).catch(() => null);
      const createdAt = Date.parse(metadata?.[ARCHIVE_CREATED_AT_METADATA] ?? '');
      if (Number.isFinite(createdAt) && now.getTime() - createdAt < ORPHAN_MIN_AGE_MS) continue;
      doomed.push(key);
    }
    if (doomed.length === 0) return 0;
    const { deleted, failed } = await deleteStorageKeys(this.storage, doomed);
    if (failed.length > 0) this.logger.warn(`files.archive.purge: ${failed.length} orphan object(s) not deleted (retried next run)`);
    return deleted.length;
  }

  /** Deletes every archive expired before `now`; returns how many rows went. */
  async purgeExpired(now: Date): Promise<number> {
    let total = 0;
    const skipped = new Set<string>();
    for (let pass = 0; pass < MAX_BATCHES; pass += 1) {
      const rows: { id: string; storageKey: string | null }[] = await this.system.runAsSystem(FILES_ARCHIVE_PURGE_REASON, (tx) =>
        tx.fileArchive.findMany({
          where: { expiresAt: { lt: now }, ...(skipped.size > 0 ? { id: { notIn: [...skipped] } } : {}) },
          select: { id: true, storageKey: true },
          orderBy: { expiresAt: 'asc' },
          take: BATCH,
        }),
      );
      if (rows.length === 0) break;
      const keys = rows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
      const { failed } = keys.length > 0 ? await deleteStorageKeys(this.storage, keys) : { failed: [] };
      const failedKeys = new Set<string>(failed.map((f) => f.key));
      const done: string[] = [];
      for (const row of rows) {
        if (row.storageKey && failedKeys.has(row.storageKey)) skipped.add(row.id);
        else done.push(row.id);
      }
      if (failedKeys.size > 0) this.logger.warn(`files.archive.purge: ${failedKeys.size} object(s) not deleted (retried next pass)`);
      if (done.length > 0) {
        await this.system.runAsSystem(FILES_ARCHIVE_PURGE_REASON, (tx) => tx.fileArchive.deleteMany({ where: { id: { in: done } } }));
        total += done.length;
      }
      if (rows.length < BATCH && skipped.size === 0) break;
    }
    return total;
  }
}
