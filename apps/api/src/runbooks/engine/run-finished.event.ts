import { RUNBOOK_RUN_FINISHED_INTERNAL_EVENT } from './engine.constants';

/**
 * A run reached a final state. Emitted in-process AFTER the commit that finished it (`EventEmitter2`,
 * key {@link RUNBOOK_RUN_FINISHED_EVENT}); consumed by log collection (#63) and the schedules (#66). A
 * listener only enqueues or notifies (`on-event-no-io`): anything longer is a job of its own.
 */
export class RunbookRunFinished {
  constructor(
    readonly runId: string,
    readonly orgId: string,
    readonly runbookId: string,
    readonly version: number,
    /** `succeeded`, `failed`, `partially_failed`, `aborted` or `cancelled`. */
    readonly status: string,
    readonly trigger: string,
    readonly initiatedBy: string | null,
    readonly targetsTotal: number,
    readonly targetsSucceeded: number,
    readonly targetsFailed: number,
  ) {}
}

export const RUNBOOK_RUN_FINISHED_EVENT = RUNBOOK_RUN_FINISHED_INTERNAL_EVENT;
