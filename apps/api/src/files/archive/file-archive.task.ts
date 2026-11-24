import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { FILES_ARCHIVE_PURGE_JOB_TYPE } from './archive.constants';

/**
 * Hourly, queues the expiry sweep of folder archives. It only decides that work is due and enqueues it (a system
 * job, skipped while one is pending or running); `FileArchivePurgeHandler` does the work.
 */
@Injectable()
export class FileArchiveTask {
  private readonly logger = new Logger(FileArchiveTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 17 * * * *')
  async handleExpiry(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: FILES_ARCHIVE_PURGE_JOB_TYPE,
      what: 'folder archive expiry',
    });
  }
}
