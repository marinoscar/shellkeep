import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { TERMINAL_SESSION_REAP_TYPE } from '../jobs/session-reap.handler';

/**
 * Every five minutes, queues the session reaper. It only decides that work is
 * due and enqueues it (a system job, skipped while one is pending or running);
 * `SessionReapHandler` does the work. `PrismaService` is the helper's read-only
 * "already in flight?" port, not a data access of this task.
 */
@Injectable()
export class SessionCleanupTask {
  private readonly logger = new Logger(SessionCleanupTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 */5 * * * *')
  async handleCleanup(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: TERMINAL_SESSION_REAP_TYPE,
      what: 'terminal session reap',
    });
  }
}
