// =============================================================================
// A runbook job settled: nudge the run (issue #62)
// =============================================================================
//
// `@OnEvent(JOB_SETTLED_EVENT)`, filtered to `runbook.*` run jobs. It ONLY ENQUEUES a `runbook.run.advance`
// for the run named in the job's payload (no download, no upload, no work: `on-event-no-io`); the advance
// handler does the work. A job that failed or was lost leaves its target to the reconcile sweep, and the
// advance this queues is the nudge that dispatches whatever the settled job freed.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JOB_SETTLED_EVENT, JobsService, type JobSettledEvent } from '@marinoscar/platform-api/jobs';

import { RUNBOOK_RUN_START_TYPE, RUNBOOK_TARGET_RUN_TYPE } from './engine.constants';
import { enqueueRunAdvance } from './run-advance.enqueue';

@Injectable()
export class RunbookJobSettledListener {
  constructor(private readonly jobs: JobsService) {}

  @OnEvent(JOB_SETTLED_EVENT)
  handle(event: JobSettledEvent): void {
    if (event.type !== RUNBOOK_RUN_START_TYPE && event.type !== RUNBOOK_TARGET_RUN_TYPE) return;
    const orgId = event.job.orgId;
    const runId = (event.job.payload as { runId?: unknown } | null)?.runId;
    if (!orgId || typeof runId !== 'string') return;
    void enqueueRunAdvance(this.jobs, orgId, runId);
  }
}
