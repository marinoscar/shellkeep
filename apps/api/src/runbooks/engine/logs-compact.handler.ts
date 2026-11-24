// =============================================================================
// `runbook.logs.compact` (issue #62): the reconcile sweep
// =============================================================================
//
// A SYSTEM job (`orgId: null`): it looks across organizations through the bypass client under the
// registered access reason `runbooks-reconcile`, and only to FIND work; every change is made inside the
// owning organization's scope (`runInOrg`). Each pass, in order:
//
//   1. LOST EXECUTORS. A target `running` (or `queued`) whose `runbook.target.run` job is no longer
//      pending or running, and that has been quiet for `GRACE_MS`, lost its executor: a `running` one
//      fails `EXECUTOR_LOST` (its running step too) and the run advances; a `queued` one (a resume that
//      raced the parking job's dedup) gets its job enqueued again.
//   2. STUCK RUNS. A run `running` with nothing in flight is advanced.
//   3. EXPIRED APPROVALS. Pending approvals past `expires_at` are decided `expired`.
//   4. ORPHAN LOG CHUNKS older than an hour (a segment that died before archiving) are moved to storage.
//
// Idempotent and bounded per pass, so the queue's at-least-once delivery is safe.
// =============================================================================

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, JobsService, type Job, type JobHandler, type JobsTx } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { PrismaSystemService } from '../../prisma/prisma-system.service';
import {
  FAILURE_CODES,
  ORPHAN_CHUNK_AGE_MS,
  RUNBOOKS_RECONCILE_REASON,
  RUNBOOK_JOB_REASON,
  RUNBOOK_LOGS_COMPACT_TYPE,
  RUNBOOK_RUN_TARGET_SUBJECT,
  RUNBOOK_TARGET_RUN_TYPE,
} from './engine.constants';
import { LogArchiveService } from './log-archive.service';
import { RunCoordinatorService } from './run-coordinator.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { RunbookApprovalsService } from './runbook-approvals.service';
import { assertTransition } from './state-machine';

/** A target must have been quiet this long before its job is judged lost (the job row may lag the target's). */
export const LOST_EXECUTOR_GRACE_MS = 2 * 60_000;
const BATCH = 200;

export interface CompactResult {
  lostExecutors: number;
  requeued: number;
  advancedRuns: number;
  expiredApprovals: number;
  archivedSteps: number;
}

@Injectable()
export class LogsCompactHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_LOGS_COMPACT_TYPE;
  readonly label = 'Reconcile runbook runs and compact their logs';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 2 } as const;

  private readonly logger = new Logger(LogsCompactHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly system: PrismaSystemService,
    private readonly jobs: JobsService,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
    private readonly approvals: RunbookApprovalsService,
    private readonly archive: LogArchiveService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reconcile(new Date());
    this.logger.log(
      `reconcile: ${result.lostExecutors} lost, ${result.requeued} requeued, ${result.advancedRuns} advanced, ${result.expiredApprovals} expired, ${result.archivedSteps} archived`,
    );
  }

  async reconcile(now: Date): Promise<CompactResult> {
    const result: CompactResult = { lostExecutors: 0, requeued: 0, advancedRuns: 0, expiredApprovals: 0, archivedSteps: 0 };
    const quiet = new Date(now.getTime() - LOST_EXECUTOR_GRACE_MS);

    // Everything below is FOUND with the bypass client and CHANGED in the owning organization.
    const found = await this.system.runAsSystem(RUNBOOKS_RECONCILE_REASON, async (tx) => {
      const candidates = await tx.runbookRunTarget.findMany({
        where: { status: { in: ['running', 'queued'] }, updatedAt: { lt: quiet } },
        select: { id: true, orgId: true, runId: true, status: true, nextStepIndex: true },
        take: BATCH,
      });
      const active = candidates.length
        ? await tx.job.findMany({
            where: { subjectType: RUNBOOK_RUN_TARGET_SUBJECT, subjectId: { in: candidates.map((c) => c.id) }, status: { in: ['pending', 'running'] } },
            select: { subjectId: true },
          })
        : [];
      const stuckRuns = await tx.runbookRun.findMany({
        where: { status: 'running', finishedAt: null, updatedAt: { lt: quiet } },
        select: { id: true, orgId: true },
        take: BATCH,
      });
      const approvalOrgs = await tx.runbookApproval.findMany({
        where: { status: 'pending', expiresAt: { lt: now } },
        distinct: ['orgId'],
        select: { orgId: true },
        take: BATCH,
      });
      const orphans = await tx.runbookRunLogChunk.groupBy({
        by: ['orgId', 'runStepId'],
        where: { createdAt: { lt: new Date(now.getTime() - ORPHAN_CHUNK_AGE_MS) } },
        orderBy: { orgId: 'asc' },
        take: 100,
      });
      return { candidates, activeIds: new Set(active.map((a) => a.subjectId)), stuckRuns, approvalOrgs, orphans };
    });

    for (const target of found.candidates.filter((c) => !found.activeIds.has(c.id))) {
      try {
        if (target.status === 'queued') {
          await runInOrg(this.prisma, { orgId: target.orgId }, (tx) =>
            this.jobs.enqueueWithin(tx as unknown as JobsTx, {
              type: RUNBOOK_TARGET_RUN_TYPE,
              reason: RUNBOOK_JOB_REASON,
              orgId: target.orgId,
              subjectType: RUNBOOK_RUN_TARGET_SUBJECT,
              subjectId: target.id,
              payload: { runId: target.runId, targetId: target.id, fromStepIndex: target.nextStepIndex },
            }),
          );
          result.requeued += 1;
        } else {
          await this.failLost(target.orgId, target.runId, target.id, now);
          result.lostExecutors += 1;
        }
      } catch (error) {
        this.logger.warn(`reconcile of a target failed: ${error instanceof Error ? error.name : 'error'}`);
      }
    }

    for (const run of found.stuckRuns) {
      try {
        const outcome = await runInOrg(this.prisma, { orgId: run.orgId }, (tx) => this.coordinator.advance(tx, run.id, now));
        await this.lifecycle.afterCommit(outcome);
        result.advancedRuns += 1;
      } catch (error) {
        this.logger.warn(`reconcile of a run failed: ${error instanceof Error ? error.name : 'error'}`);
      }
    }

    for (const { orgId } of found.approvalOrgs) result.expiredApprovals += await this.approvals.expireDue(orgId, now);

    for (const orphan of found.orphans) {
      if (await this.archive.archiveStep(orphan.orgId, orphan.runStepId)) result.archivedSteps += 1;
    }
    return result;
  }

  /** Fails a `running` target whose job is gone: `EXECUTOR_LOST`; its running step too; then advance. */
  private async failLost(orgId: string, runId: string, targetId: string, now: Date): Promise<void> {
    const outcome = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const target = await tx.runbookRunTarget.findUnique({ where: { id: targetId }, select: { status: true } });
      if (target?.status === 'running') {
        assertTransition('target', 'running', 'failed');
        await tx.runbookRunTarget.update({
          where: { id: targetId },
          data: { status: 'failed', errorCode: FAILURE_CODES.EXECUTOR_LOST, errorMessage: 'The worker running this server was lost', finishedAt: now },
        });
        await tx.runbookRunStep.updateMany({
          where: { runTargetId: targetId, status: 'running' },
          data: { status: 'failed', errorCode: FAILURE_CODES.EXECUTOR_LOST, finishedAt: now },
        });
        await tx.runbookRunStep.updateMany({ where: { runTargetId: targetId, status: 'pending' }, data: { status: 'skipped', finishedAt: now } });
      }
      const advanced = await this.coordinator.advance(tx, runId, now);
      advanced.events.unshift({ type: 'target', runId, targetId, status: 'failed', errorCode: FAILURE_CODES.EXECUTOR_LOST });
      return advanced;
    });
    await this.lifecycle.afterCommit(outcome);
  }
}
