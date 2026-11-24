// =============================================================================
// `runbook.run.advance` (issue #62)
// =============================================================================
//
// Calls the coordinator for one run. Enqueued when a run job settles (`RunbookJobSettledListener`) and by
// the reconcile sweep. Deduplicated by subject (`runbook_run` + run id): a second nudge while one is
// pending collapses onto it, and `JobsService.enqueue` swallows that conflict.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { z } from 'zod';

import { RUNBOOK_RUN_ADVANCE_TYPE } from './engine.constants';
import { RunCoordinatorService, type OrgTx } from './run-coordinator.service';
import { RunLifecycleService } from './run-lifecycle.service';

const PAYLOAD = z.object({ runId: z.string().uuid() });

@Injectable()
export class RunAdvanceHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_RUN_ADVANCE_TYPE;
  readonly label = 'Advance a runbook run';
  readonly profile = { maxRuntimeMs: 60_000, maxAttempts: 5 } as const;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly jobScope: JobScope,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const { runId } = PAYLOAD.parse(job.payload);
    const outcome = await this.jobScope.run<Awaited<ReturnType<RunCoordinatorService['advance']>>, OrgTx>(job, (tx) =>
      this.coordinator.advance(tx, runId),
    );
    await this.lifecycle.afterCommit(outcome);
  }
}
