// =============================================================================
// `runbooks.user_data.purge`: a user's runbooks (issue #69)
// =============================================================================
//
// Enqueued by `user.data.purge` (subject `user:<userId>`) for the `runbooks` category, through the
// `delegate` hint of the `Runbook` model (`app-registrations/user-data.ts`). `owner_user_id` is the
// AUTHOR; ownership is decided by `owner_group_id`:
//
//   - no owning group: the runbook is the user's. It goes with its versions (cascade), the grants on it
//     and the pending jobs about it;
//   - an owning group: the runbook stays with the group. Only the author link is nulled
//     (`owner_user_id`), so nothing of the user is left on it. The versions stay (immutable history).
//
// EXTENSION POINT (the runbook engine, #62): runs, run targets, steps, log chunks, command executions and
// approvals arrive with that PR. Their keep-or-delete decisions and their storage objects (artifacts and
// log bundles) are added here, in this transaction, and in `app-registrations/user-data.ts`: runs the user
// started on a group-owned runbook are kept with their actor id nulled.
//
// `runbooks` is an `org` table under forced row-level security: the work runs on the bypass client of the
// user-data slice (reason `purge`) with an explicit owner filter, never an organization-wide read.
//
// IDEMPOTENT. SERVER-ONLY, permanently. LOGGING: ids and counts only; a runbook name or definition never
// reaches a log line.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { deleteGrantsForResources } from '@marinoscar/platform-api/sharing';
import { USER_DATA_DB, type UserDataDbPort } from '@marinoscar/platform-api/user-data';

import { RUNBOOK_RESOURCE } from '../../app-registrations/sharing';
import { RUNBOOKS_USER_DATA_PURGE_JOB_TYPE, runbooksUserDataPurgePayloadSchema } from './runbooks-purge.job-type';

/** What one run did (counts only). */
export interface RunbooksPurgeResult {
  runbooks: number;
  keptWithGroup: number;
  grants: number;
  cancelledJobs: number;
}

@Injectable()
export class RunbooksUserDataPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOKS_USER_DATA_PURGE_JOB_TYPE;
  readonly label = 'Runbook deletion';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(RunbooksUserDataPurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const parsed = runbooksUserDataPurgePayloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new Error(`${this.type} job ${job.id}: payload must carry { userId (uuid) }`);
    const result = await this.purge(parsed.data.userId);
    this.logger.log(
      `${this.type} job ${job.id}: ${result.runbooks} runbook(s) deleted, ${result.keptWithGroup} kept with their group, ${result.grants} grant(s) deleted, ${result.cancelledJobs} job(s) cancelled`,
    );
  }

  /** Deletes the runbooks only the user owns; detaches the author from the ones a group owns. */
  async purge(userId: string): Promise<RunbooksPurgeResult> {
    return this.db.runAsSystem('purge', async (tx) => {
      const own: { id: string }[] = await tx.runbook.findMany({ where: { ownerUserId: userId, ownerGroupId: null }, select: { id: true } });
      const ids = own.map((runbook) => runbook.id);
      let grants = 0;
      let cancelled = 0;
      let deleted = 0;
      if (ids.length > 0) {
        cancelled = (await tx.job.deleteMany({ where: { status: 'pending', subjectId: { in: ids } } })).count;
        grants = await deleteGrantsForResources(tx, RUNBOOK_RESOURCE, ids);
        deleted = (await tx.runbook.deleteMany({ where: { id: { in: ids } } })).count;
      }
      const kept = await tx.runbook.updateMany({ where: { ownerUserId: userId, ownerGroupId: { not: null } }, data: { ownerUserId: null } });
      return { runbooks: deleted, keptWithGroup: kept.count as number, grants, cancelledJobs: cancelled };
    });
  }
}
