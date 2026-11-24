// =============================================================================
// The run coordinator (issue #62)
// =============================================================================
//
// `advance(tx, runId)` is the ONE place a run moves forward. It runs inside the caller's organization
// transaction (`JobScope.run` in a job, `runInOrg` in a route):
//
//   1. `SELECT ... FOR UPDATE` on the run row: two replicas advancing the same run take turns, so a
//      dispatch is never decided twice from the same snapshot;
//   2. `planAdvance` (pure, `run-plan.ts`) decides the changes from the run and its targets;
//   3. the changes are applied and every dispatch enqueues `runbook.target.run` THROUGH THE SAME
//      TRANSACTION (`JobsService.enqueueWithin`): a target is `queued` if and only if its job exists.
//
// It returns an `AdvanceOutcome` and publishes NOTHING: events, notifications and the in-process
// "run finished" event leave only after the transaction commits (`RunLifecycleService.afterCommit`),
// outside any `$transaction` (the notify-after-commit rule).
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { RlsTransactionClient } from '@marinoscar/platform-api/core';
import { JobsService, type JobsTx } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import type { RunStrategy } from '../schema/runbook-definition.schema';
import {
  CANARY_STEP_INDEX,
  RUNBOOK_JOB_REASON,
  RUNBOOK_RUN_TARGET_SUBJECT,
  RUNBOOK_TARGET_RUN_TYPE,
  FAILURE_CODES,
} from './engine.constants';
import { planAdvance, type PlanTarget } from './run-plan';
import type { RunCancelMessage, RunEvent } from './run-events';
import { RunbookSettingsService } from './runbook-settings.service';
import { assertTransition, type RunStatus, type TargetStatus } from './state-machine';

export type OrgTx = RlsTransactionClient<PrismaService>;

/** What a finished run tells the post-commit hooks. */
export interface FinishedRun {
  runId: string;
  orgId: string;
  status: RunStatus;
  trigger: string;
  initiatedBy: string | null;
  runbookId: string;
  version: number;
  targetsTotal: number;
  targetsSucceeded: number;
  targetsFailed: number;
  /** A dry run: no webhook, no in-process finished event, an in-app-only notification (#67). */
  dryRun: boolean;
}

/** An approval the advance created (to notify the approvers after the commit). */
export interface CreatedApproval {
  approvalId: string;
  runId: string;
  orgId: string;
  runbookId: string;
  version: number;
  stepName: string;
  targetsTotal: number;
  kind: 'gate' | 'step' | 'destructive_run';
}

export interface AdvanceOutcome {
  runId: string;
  events: RunEvent[];
  cancelRequests: RunCancelMessage[];
  finished: FinishedRun | null;
  approvals: CreatedApproval[];
  dispatched: number;
}

export const emptyOutcome = (runId: string): AdvanceOutcome => ({
  runId,
  events: [],
  cancelRequests: [],
  finished: null,
  approvals: [],
  dispatched: 0,
});

/** Merges the outcomes of several advances (a decision that advanced more than once). */
export function mergeOutcomes(runId: string, ...outcomes: AdvanceOutcome[]): AdvanceOutcome {
  const merged = emptyOutcome(runId);
  for (const o of outcomes) {
    merged.events.push(...o.events);
    merged.cancelRequests.push(...o.cancelRequests);
    merged.approvals.push(...o.approvals);
    merged.dispatched += o.dispatched;
    merged.finished = o.finished ?? merged.finished;
  }
  return merged;
}

@Injectable()
export class RunCoordinatorService {
  constructor(
    private readonly jobs: JobsService,
    private readonly settings: RunbookSettingsService,
  ) {}

  async advance(tx: OrgTx, runId: string, now: Date = new Date()): Promise<AdvanceOutcome> {
    const outcome = emptyOutcome(runId);

    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM runbook_runs WHERE id = ${runId}::uuid FOR UPDATE`;
    if (locked.length === 0) return outcome;

    const run = await tx.runbookRun.findUnique({ where: { id: runId } });
    if (!run) return outcome;

    const targetRows = await tx.runbookRunTarget.findMany({
      where: { runId },
      select: { id: true, position: true, batchIndex: true, status: true, nextStepIndex: true },
      orderBy: { position: 'asc' },
    });
    const canary = await tx.runbookApproval.findUnique({
      where: { runId_stepIndex_scopeKey: { runId, stepIndex: CANARY_STEP_INDEX, scopeKey: 'run' } },
      select: { status: true },
    });

    const strategy = run.strategy as unknown as RunStrategy;
    const targets: PlanTarget[] = targetRows.map((t) => ({
      id: t.id,
      position: t.position,
      batchIndex: t.batchIndex,
      status: t.status as TargetStatus,
    }));
    const plan = planAdvance({
      runStatus: run.status as RunStatus,
      finished: run.finishedAt !== null,
      strategy,
      targets,
      canaryApproved: canary?.status === 'approved',
    });

    const targetEvent = (id: string, status: TargetStatus, errorCode?: string): void => {
      outcome.events.push({ type: 'target', runId, targetId: id, status, errorCode: errorCode ?? null });
    };

    // Cancelled before they ever started.
    if (plan.cancelPending.length > 0) {
      assertTransition('target', 'pending', 'cancelled');
      await tx.runbookRunTarget.updateMany({
        where: { runId, id: { in: plan.cancelPending }, status: 'pending' },
        data: { status: 'cancelled', errorCode: FAILURE_CODES.CANCELLED, finishedAt: now },
      });
      plan.cancelPending.forEach((id) => targetEvent(id, 'cancelled', FAILURE_CODES.CANCELLED));
    }

    // Parked targets have no job: cancel them directly, with their waiting step and approvals.
    if (plan.cancelWaiting.length > 0) {
      assertTransition('target', 'waiting', 'cancelled');
      await tx.runbookRunTarget.updateMany({
        where: { runId, id: { in: plan.cancelWaiting }, status: 'waiting' },
        data: { status: 'cancelled', errorCode: FAILURE_CODES.CANCELLED, finishedAt: now },
      });
      await tx.runbookRunStep.updateMany({
        where: { runId, runTargetId: { in: plan.cancelWaiting }, status: { in: ['waiting_approval', 'running'] } },
        data: { status: 'cancelled', errorCode: FAILURE_CODES.CANCELLED, finishedAt: now },
      });
      plan.cancelWaiting.forEach((id) => targetEvent(id, 'cancelled', FAILURE_CODES.CANCELLED));
    }

    if (plan.requestCancel.length > 0) {
      await tx.runbookRunTarget.updateMany({
        where: { runId, id: { in: plan.requestCancel }, cancelRequestedAt: null },
        data: { cancelRequestedAt: now },
      });
      plan.requestCancel.forEach((targetId) => outcome.cancelRequests.push({ runId, targetId }));
    }

    if (plan.dispatch.length > 0) {
      assertTransition('target', 'pending', 'queued');
      const fromStep = new Map(targetRows.map((t) => [t.id, t.nextStepIndex]));
      await tx.runbookRunTarget.updateMany({ where: { runId, id: { in: plan.dispatch }, status: 'pending' }, data: { status: 'queued' } });
      for (const targetId of plan.dispatch) {
        await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: RUNBOOK_TARGET_RUN_TYPE,
          reason: RUNBOOK_JOB_REASON,
          orgId: run.orgId,
          subjectType: RUNBOOK_RUN_TARGET_SUBJECT,
          subjectId: targetId,
          payload: { runId, targetId, fromStepIndex: fromStep.get(targetId) ?? 0 },
        });
        targetEvent(targetId, 'queued');
      }
      outcome.dispatched = plan.dispatch.length;
    }

    const newStatus = (plan.runStatus ?? run.status) as RunStatus;
    if (plan.runStatus) assertTransition('run', run.status, plan.runStatus);

    if (plan.createCanaryGate) {
      const { approvals } = await this.settings.effective(run.orgId);
      const created = await tx.runbookApproval.createMany({
        data: [
          {
            orgId: run.orgId,
            runId,
            runTargetId: null,
            scopeKey: 'run',
            scope: 'run',
            kind: 'gate',
            stepIndex: CANARY_STEP_INDEX,
            stepName: 'Canary check',
            message: 'The first batch has finished. Approve to continue with the remaining servers.',
            expiresAt: new Date(now.getTime() + approvals.defaultExpirySec * 1000),
          },
        ],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        const approval = await tx.runbookApproval.findUnique({
          where: { runId_stepIndex_scopeKey: { runId, stepIndex: CANARY_STEP_INDEX, scopeKey: 'run' } },
          select: { id: true },
        });
        if (approval) {
          outcome.events.push({ type: 'approval', runId, approvalId: approval.id, status: 'pending', scope: 'run', kind: 'gate' });
          outcome.approvals.push({
            approvalId: approval.id,
            runId,
            orgId: run.orgId,
            runbookId: run.runbookId,
            version: run.version,
            stepName: 'Canary check',
            targetsTotal: targetRows.length,
            kind: 'gate',
          });
        }
      }
    }

    if (plan.runStatus || plan.finish) {
      // A run that ends does not leave an approval open (a decision on it would be meaningless).
      if (plan.finish) {
        await tx.runbookApproval.updateMany({
          where: { runId, status: 'pending' },
          data: { status: 'expired', decidedAt: now, comment: 'The run ended before this was decided' },
        });
      }
      await tx.runbookRun.update({
        where: { id: runId },
        data: { status: newStatus, ...(plan.finish ? { finishedAt: now } : {}) },
      });
      outcome.events.push({ type: 'run', runId, status: newStatus, finishedAt: plan.finish ? now.toISOString() : null });
    }

    if (plan.finish) {
      const counts = await tx.runbookRunTarget.groupBy({ by: ['status'], where: { runId }, _count: { _all: true } });
      const count = (s: string): number => counts.find((c) => c.status === s)?._count._all ?? 0;
      outcome.finished = {
        runId,
        orgId: run.orgId,
        status: newStatus,
        trigger: run.trigger,
        initiatedBy: run.initiatedBy,
        runbookId: run.runbookId,
        version: run.version,
        targetsTotal: counts.reduce((sum, c) => sum + c._count._all, 0),
        targetsSucceeded: count('succeeded'),
        targetsFailed: count('failed'),
        dryRun: run.dryRun,
      };
    }
    return outcome;
  }
}
