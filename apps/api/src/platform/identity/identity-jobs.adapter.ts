import { Injectable, type Logger } from '@nestjs/common';
import type { IdentityJobHandler, IdentityJobsPort } from '@marinoscar/platform-api/identity';
import {
  JobHandlerRegistry,
  JobsService,
  enqueueHousekeepingJob,
} from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Identity's `IDENTITY_JOBS`, on the platform queue (#49). The slice's two
 * housekeeping handlers (`auth.token.cleanup`, `auth.device-code.cleanup`, and the
 * OAuth server's when enabled) register into the platform `JobHandlerRegistry`,
 * and their enqueue-only crons queue through the shared housekeeping helper
 * (a system job, skipped while one is pending or running).
 */
@Injectable()
export class IdentityJobsAdapter implements IdentityJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: options.logger,
      type: options.type,
      what: options.what,
    });
  }

  registerHandler(handler: IdentityJobHandler): void {
    // Compiles only while an identity handler IS a platform job handler.
    this.registry.register(handler);
  }
}
