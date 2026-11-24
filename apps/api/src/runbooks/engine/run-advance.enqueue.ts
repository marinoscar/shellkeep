import { Logger } from '@nestjs/common';
import type { JobsService } from '@marinoscar/platform-api/jobs';

import { RUNBOOK_JOB_REASON, RUNBOOK_RUN_ADVANCE_TYPE, RUNBOOK_RUN_SUBJECT } from './engine.constants';

const logger = new Logger('RunAdvanceEnqueue');

/** Queues one advance of a run. Deduplicated by subject; never throws (the next nudge or sweep retries). */
export async function enqueueRunAdvance(jobs: JobsService, orgId: string, runId: string): Promise<void> {
  try {
    await jobs.enqueue({
      type: RUNBOOK_RUN_ADVANCE_TYPE,
      reason: RUNBOOK_JOB_REASON,
      orgId,
      subjectType: RUNBOOK_RUN_SUBJECT,
      subjectId: runId,
      payload: { runId },
    });
  } catch (error) {
    logger.warn(`advance not queued: ${error instanceof Error ? error.name : 'error'}`);
  }
}
