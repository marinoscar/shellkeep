// =============================================================================
// `runbooks.user_data.purge`: a user's runbooks, their runs and the logs of those runs (issue #69)
// =============================================================================
//
// Enqueued by `user.data.purge` (subject `user:<userId>`) for the `runbooks` category, through the
// `delegate` hint of the `Runbook` model (`app-registrations/user-data.ts`). `owner_user_id` is the
// AUTHOR; ownership is decided by `owner_group_id`:
//
//   - no owning group: the runbook is the user's. Its versions, runs, run targets, steps, log chunks,
//     command audit rows and approvals go with it (every one of those keys cascades from the runbook),
//     and so do the grants on it, the pending queue jobs about its runs and the step logs in object storage;
//   - an owning group: the runbook stays with the group, and so do its runs. Only the author link
//     (`owner_user_id`) is nulled, so nothing of the user is left on it. Its versions stay (immutable history).
//
// EVERY run the user started on a runbook that stays (a group's, or another member's) is kept as
// organization history with its actor id nulled (`initiated_by`), and so is every approval they decided
// (`decided_by`): the same detach the foreign keys perform when a user ROW goes, done here because a data
// purge keeps the user row.
//
// STEP LOGS. A step's output is concatenated into object storage when the step ends and only its KEY is
// recorded (`runbook_run_steps.log_storage_key`): there is no `storage_objects` row, so the platform's
// `storageObjectColumns` (which names object IDS) cannot reach it. This job collects the keys first and
// deletes the bytes BEFORE the rows: a provider failure throws, the rows are still there, and the queue's
// retry finds the keys again; a key that is already gone is not an error.
//
// `runbooks` and its run tables are `org` tables under forced row-level security: the work runs on the
// bypass client of the user-data slice (reason `purge`) with an explicit owner filter, never an
// organization-wide read.
//
// NOT DELETED: `runbook_command_executions` rows that name a deleted SERVER profile (the column is a plain
// id, no key) belong to runs of runbooks that stay; they are audit history with a redacted preview.
//
// IDEMPOTENT. SERVER-ONLY, permanently. LOGGING: ids and counts only; a runbook name, definition, command
// or log line never reaches a log line.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { deleteGrantsForResources } from '@marinoscar/platform-api/sharing';
import { STORAGE_PROVIDER, deleteStorageKeys, type StorageProvider } from '@marinoscar/platform-api/storage';
import { USER_DATA_DB, type UserDataDbPort } from '@marinoscar/platform-api/user-data';

import { RUNBOOK_RESOURCE } from '../../app-registrations/sharing';
import { RUNBOOK_RUN_SUBJECT, RUNBOOK_RUN_TARGET_SUBJECT } from '../engine/engine.constants';
import { RUNBOOKS_USER_DATA_PURGE_JOB_TYPE, runbooksUserDataPurgePayloadSchema } from './runbooks-purge.job-type';

/** What one run did (counts only). */
export interface RunbooksPurgeResult {
  runbooks: number;
  keptWithGroup: number;
  grants: number;
  cancelledJobs: number;
  /** Step log objects deleted from storage. */
  logObjects: number;
  /** Runs and approvals of runbooks that stay, detached from the user. */
  runsDetached: number;
  approvalsDetached: number;
}

/** Keys per storage call and ids per `IN` list. */
const CHUNK = 500;

@Injectable()
export class RunbooksUserDataPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOKS_USER_DATA_PURGE_JOB_TYPE;
  readonly label = 'Runbook deletion';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(RunbooksUserDataPurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const parsed = runbooksUserDataPurgePayloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new Error(`${this.type} job ${job.id}: payload must carry { userId (uuid) }`);
    const result = await this.purge(parsed.data.userId);
    this.logger.log(
      `${this.type} job ${job.id}: ${result.runbooks} runbook(s) deleted, ${result.keptWithGroup} kept with their group, ${result.grants} grant(s) and ${result.logObjects} log object(s) deleted, ${result.cancelledJobs} job(s) cancelled, ${result.runsDetached} run(s) and ${result.approvalsDetached} approval(s) detached`,
    );
  }

  /** Deletes the runbooks only the user owns (with their runs and logs); detaches the user from everything that stays. */
  async purge(userId: string): Promise<RunbooksPurgeResult> {
    // 1. What goes, and the step logs it owns in object storage.
    const { ids, logKeys } = await this.db.runAsSystem('purge', async (tx) => {
      const own: { id: string }[] = await tx.runbook.findMany({ where: { ownerUserId: userId, ownerGroupId: null }, select: { id: true } });
      const runbookIds = own.map((runbook) => runbook.id);
      const keys: string[] = [];
      for (const part of chunks(runbookIds)) {
        const steps: { logStorageKey: string | null }[] = await tx.runbookRunStep.findMany({
          where: { logStorageKey: { not: null }, run: { runbookId: { in: part } } },
          select: { logStorageKey: true },
        });
        for (const step of steps) if (step.logStorageKey) keys.push(step.logStorageKey);
      }
      return { ids: runbookIds, logKeys: keys };
    });

    // 2. The bytes, BEFORE the rows (see the header): a failure throws and the retry starts over.
    let logObjects = 0;
    for (const part of chunks(logKeys)) {
      const { failed } = await deleteStorageKeys(this.storage, part);
      if (failed.length > 0) throw new Error(`${this.type}: ${failed.length} step log object(s) could not be deleted from storage`);
      logObjects += part.length;
    }

    // 3. The rows, the grants, the pending jobs and the detaches, in one transaction.
    const rows = await this.db.runAsSystem('purge', async (tx) => {
      let grants = 0;
      let cancelled = 0;
      let deleted = 0;
      for (const part of chunks(ids)) {
        const runs: { id: string }[] = await tx.runbookRun.findMany({ where: { runbookId: { in: part } }, select: { id: true } });
        const targets: { id: string }[] = await tx.runbookRunTarget.findMany({ where: { runId: { in: runs.map((run) => run.id) } }, select: { id: true } });
        cancelled += (
          await tx.job.deleteMany({
            where: {
              status: 'pending',
              OR: [
                { subjectType: RUNBOOK_RUN_SUBJECT, subjectId: { in: runs.map((run) => run.id) } },
                { subjectType: RUNBOOK_RUN_TARGET_SUBJECT, subjectId: { in: targets.map((target) => target.id) } },
                { subjectId: { in: part } },
              ],
            },
          })
        ).count;
        grants += await deleteGrantsForResources(tx, RUNBOOK_RESOURCE, part);
        deleted += (await tx.runbook.deleteMany({ where: { id: { in: part } } })).count;
      }
      const kept = await tx.runbook.updateMany({ where: { ownerUserId: userId, ownerGroupId: { not: null } }, data: { ownerUserId: null } });
      const runs = await tx.runbookRun.updateMany({ where: { initiatedBy: userId }, data: { initiatedBy: null } });
      const approvals = await tx.runbookApproval.updateMany({ where: { decidedBy: userId }, data: { decidedBy: null } });
      return { runbooks: deleted, keptWithGroup: kept.count as number, grants, cancelledJobs: cancelled, runsDetached: runs.count as number, approvalsDetached: approvals.count as number };
    });
    return { ...rows, logObjects };
  }
}

/** Splits `items` into lists of at most {@link CHUNK}. */
function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}
