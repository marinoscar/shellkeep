import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { RUNBOOK_LOGS_COMPACT_TYPE } from './engine.constants';

/**
 * Every minute, queues the reconcile sweep (`runbook.logs.compact`, a system job, skipped while one is
 * pending or running). It only decides that work is due and enqueues it; the handler does the work.
 */
@Injectable()
export class RunbookReconcileTask {
  private readonly logger = new Logger(RunbookReconcileTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 * * * * *')
  async handleReconcile(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: RUNBOOK_LOGS_COMPACT_TYPE,
      what: 'runbook reconcile',
    });
  }
}
