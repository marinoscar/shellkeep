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
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER, deleteStorageKeys, type StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { FILES_ARCHIVE_PURGE_JOB_TYPE, FILES_ARCHIVE_PURGE_REASON } from './archive.constants';

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
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const purged = await this.purgeExpired(new Date());
    if (purged > 0) this.logger.log(`files.archive.purge: ${purged} expired archive(s) deleted`);
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
