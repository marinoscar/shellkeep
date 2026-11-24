import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { RUNBOOK_SCHEDULES_TICK_TYPE } from './schedules.constants';

/**
 * Every minute, queues the schedules tick (`runbook.schedules.tick`, a system job, skipped while one is
 * pending or running). It only decides that work is due and enqueues it; the handler fires the schedules.
 */
@Injectable()
export class RunbookSchedulesTask {
  private readonly logger = new Logger(RunbookSchedulesTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 * * * * *')
  async handleTick(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: RUNBOOK_SCHEDULES_TICK_TYPE,
      what: 'runbook schedules tick',
    });
  }
}
