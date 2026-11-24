// =============================================================================
// Approvals: the inbox, decisions and expiry (issue #62)
// =============================================================================
//
// An approval is a row of `runbook_approvals`: a step's `approval_gate` (scope `run`: ONE row for the whole
// run, scope `target`: one per target) or the canary pause (`kind: gate`, step -1). A decision is ONE
// transaction: the approval row, the parked targets and their steps, and the coordinator's `advance`.
//
//   approve  step gate   each parked target: step `waiting_approval` -> `succeeded`, target `waiting` ->
//                        `queued` at `gateIndex + 1`, and a `runbook.target.run` job each (through the
//                        same transaction); then `advance`
//            canary      the paused run -> `running`; `advance` releases the rest
//   reject   step gate   each parked target fails `APPROVAL_REJECTED`; then `advance`
//   (expiry) as reject, with `APPROVAL_EXPIRED`; the reconcile job calls it for rows past `expires_at`
//            canary      the run aborts (its pending targets are cancelled by `advance`)
//
// SELF-APPROVAL: the person who started the run may not decide its approvals unless
// `runbooks.approvals.allowSelfApproval` is on (`403 RUNBOOK_SELF_APPROVAL`). Reading the inbox needs
// `runbooks:read`; deciding needs `runbooks:approve`.
// =============================================================================

import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { JobsService, type JobsTx } from '@marinoscar/platform-api/jobs';

import { recordAudit } from '../../common/audit/record-audit';
import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { RunbooksService } from '../runbooks.service';
import { EngineMetricsService } from './engine-metrics.service';
import {
  CANARY_STEP_INDEX,
  FAILURE_CODES,
  RUNBOOK_JOB_REASON,
  RUNBOOK_RUN_TARGET_SUBJECT,
  RUNBOOK_TARGET_RUN_TYPE,
} from './engine.constants';
import { RUNBOOK_RUN_ERROR_CODES } from './engine.error-codes';
import { RunCoordinatorService, mergeOutcomes, type AdvanceOutcome, type OrgTx } from './run-coordinator.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { RunbookSettingsService } from './runbook-settings.service';
import { assertTransition } from './state-machine';

export type ApprovalOutcome = 'approved' | 'rejected' | 'expired';

export interface ApprovalView {
  id: string;
  runId: string;
  runTargetId: string | null;
  scope: string;
  kind: string;
  stepIndex: number;
  stepName: string;
  message: string;
  status: string;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
  createdAt: Date;
  runbookName: string | null;
  runbookVersion: number;
  initiatedBy: string | null;
}

@Injectable()
export class RunbookApprovalsService {
  private readonly logger = new Logger(RunbookApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
    private readonly settings: RunbookSettingsService,
    private readonly metrics: EngineMetricsService,
    private readonly runbooks: RunbooksService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  /**
   * The inbox: `status` defaults to `pending`; newest first. Only approvals of runs the caller may see
   * (they started it, or may read its runbook): a private runbook's approvals are not an inbox leak.
   */
  async list(principal: Principal, query: { status?: string; page: number; pageSize: number }) {
    const scope = this.scopeOf(principal);
    const status = query.status ?? 'pending';
    return runInOrg(this.prisma, scope, async (tx) => {
      const readable = await this.runbooks.readableWhere(tx, principal);
      const where = {
        orgId: scope.orgId,
        run: { OR: [{ initiatedBy: principal.userId }, { runbook: readable }] },
        ...(status === 'all' ? {} : { status }),
      };
      const [total, rows] = await Promise.all([
        tx.runbookApproval.count({ where }),
        tx.runbookApproval.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { run: { select: { version: true, initiatedBy: true, runbook: { select: { name: true } } } } },
        }),
      ]);
      const items: ApprovalView[] = rows.map((r) => ({
        id: r.id,
        runId: r.runId,
        runTargetId: r.runTargetId,
        scope: r.scope,
        kind: r.kind,
        stepIndex: r.stepIndex,
        stepName: r.stepName,
        message: r.message,
        status: r.status,
        expiresAt: r.expiresAt,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
        comment: r.comment,
        createdAt: r.createdAt,
        runbookName: r.run.runbook.name,
        runbookVersion: r.run.version,
        initiatedBy: r.run.initiatedBy,
      }));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** A person's decision. */
  async decide(principal: Principal, approvalId: string, decision: 'approve' | 'reject', comment?: string): Promise<{ id: string; status: string }> {
    const scope = this.scopeOf(principal);
    const outcome: ApprovalOutcome = decision === 'approve' ? 'approved' : 'rejected';
    const { settings } = { settings: await this.settings.effective(scope.orgId) };

    const result = await runInOrg(this.prisma, scope, async (tx) => {
      const approval = await tx.runbookApproval.findFirst({ where: { id: approvalId, orgId: scope.orgId } });
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.status !== 'pending') {
        throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.APPROVAL_NOT_PENDING, message: 'This approval was already decided or has expired' }, 409);
      }
      const run = await tx.runbookRun.findFirst({ where: { id: approval.runId, orgId: scope.orgId }, select: { initiatedBy: true, runbookId: true } });
      if (!run) throw new NotFoundException('Approval not found');
      if (run.initiatedBy !== scope.userId && !(await this.runbooks.can(principal, run.runbookId, 'read'))) {
        throw new NotFoundException('Approval not found');
      }
      if (run?.initiatedBy === scope.userId && !settings.approvals.allowSelfApproval) {
        throw new ForbiddenException({
          code: RUNBOOK_RUN_ERROR_CODES.SELF_APPROVAL,
          message: 'The person who started a run cannot approve it',
        });
      }
      const outcomeRows = await this.apply(tx, approval, outcome, scope.userId, comment ?? null, new Date());
      return { approval, outcomeRows };
    });

    this.metrics.approval(result.approval.kind, outcome);
    await recordAudit(this.auditSink, this.logger, {
      action: 'runbook_approval.decided',
      actorUserId: scope.userId,
      targetType: 'runbook_approval',
      targetId: approvalId,
      meta: { decision: outcome, kind: result.approval.kind, runId: result.approval.runId, stepIndex: result.approval.stepIndex },
    });
    await this.lifecycle.afterCommit(result.outcomeRows);
    return { id: approvalId, status: outcome };
  }

  /**
   * Resumes a paused (canary) run: an approval decision on its gate. The caller checked `runbooks:approve`.
   */
  async resume(principal: Principal, runId: string): Promise<{ id: string; status: string }> {
    const scope = this.scopeOf(principal);
    const gate = await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookApproval.findUnique({
        where: { runId_stepIndex_scopeKey: { runId, stepIndex: CANARY_STEP_INDEX, scopeKey: 'run' } },
        select: { id: true, status: true },
      }),
    );
    if (!gate) throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: 'The run is not waiting at a canary check' }, 409);
    return this.decide(principal, gate.id, 'approve');
  }

  /** Expires every pending approval past its `expires_at` (one organization). Returns how many. */
  async expireDue(orgId: string, now: Date = new Date()): Promise<number> {
    const due = await runInOrg(this.prisma, { orgId }, (tx) =>
      tx.runbookApproval.findMany({ where: { orgId, status: 'pending', expiresAt: { lt: now } }, select: { id: true }, take: 100 }),
    );
    let count = 0;
    for (const { id } of due) {
      try {
        const done = await runInOrg(this.prisma, { orgId }, async (tx) => {
          const approval = await tx.runbookApproval.findFirst({ where: { id, status: 'pending' } });
          if (!approval) return null;
          return { approval, rows: await this.apply(tx, approval, 'expired', null, 'Expired', now) };
        });
        if (!done) continue;
        count += 1;
        this.metrics.approval(done.approval.kind, 'expired');
        await recordAudit(this.auditSink, this.logger, {
          action: 'runbook_approval.decided',
          actorUserId: null,
          targetType: 'runbook_approval',
          targetId: id,
          meta: { decision: 'expired', kind: done.approval.kind, runId: done.approval.runId, stepIndex: done.approval.stepIndex },
        });
        await this.lifecycle.afterCommit(done.rows);
      } catch (error) {
        this.logger.warn(`approval expiry failed: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
    return count;
  }

  /** The state change of one decision, inside the caller's transaction. */
  private async apply(
    tx: OrgTx,
    approval: { id: string; runId: string; orgId: string; runTargetId: string | null; scope: string; kind: string; stepIndex: number },
    outcome: ApprovalOutcome,
    decidedBy: string | null,
    comment: string | null,
    now: Date,
  ): Promise<AdvanceOutcome> {
    const { runId } = approval;
    const marked = await tx.runbookApproval.updateMany({
      where: { id: approval.id, status: 'pending' },
      data: { status: outcome, decidedBy, decidedAt: now, comment },
    });
    if (marked.count !== 1) {
      throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.APPROVAL_NOT_PENDING, message: 'This approval was already decided or has expired' }, 409);
    }
    const events: AdvanceOutcome['events'] = [
      { type: 'approval', runId, approvalId: approval.id, status: outcome, scope: approval.scope, kind: approval.kind },
    ];
    const local: AdvanceOutcome = { runId, events, cancelRequests: [], finished: null, approvals: [], dispatched: 0 };

    if (approval.kind === 'gate') {
      if (outcome === 'approved') {
        assertTransition('run', 'paused', 'running');
        const moved = await tx.runbookRun.updateMany({ where: { id: runId, status: 'paused' }, data: { status: 'running' } });
        if (moved.count === 1) events.push({ type: 'run', runId, status: 'running' });
      } else {
        assertTransition('run', 'paused', 'aborted');
        const moved = await tx.runbookRun.updateMany({ where: { id: runId, status: 'paused' }, data: { status: 'aborted' } });
        if (moved.count === 1) events.push({ type: 'run', runId, status: 'aborted' });
      }
      return mergeOutcomes(runId, local, await this.coordinator.advance(tx, runId, now));
    }

    // A step gate: the parked targets.
    const stepRows = await tx.runbookRunStep.findMany({
      where: {
        runId,
        stepIndex: approval.stepIndex,
        status: 'waiting_approval',
        ...(approval.scope === 'target' && approval.runTargetId ? { runTargetId: approval.runTargetId } : {}),
      },
      select: { id: true, runTargetId: true },
    });
    const parked = await tx.runbookRunTarget.findMany({
      where: { runId, status: 'waiting', id: { in: stepRows.map((s) => s.runTargetId) } },
      select: { id: true },
    });
    const parkedIds = new Set(parked.map((t) => t.id));

    for (const step of stepRows.filter((s) => parkedIds.has(s.runTargetId))) {
      const targetId = step.runTargetId;
      if (outcome === 'approved') {
        assertTransition('step', 'waiting_approval', 'succeeded');
        assertTransition('target', 'waiting', 'queued');
        await tx.runbookRunStep.update({ where: { id: step.id }, data: { status: 'succeeded', finishedAt: now, durationMs: 0 } });
        await tx.runbookRunTarget.update({ where: { id: targetId }, data: { status: 'queued', nextStepIndex: approval.stepIndex + 1 } });
        await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: RUNBOOK_TARGET_RUN_TYPE,
          reason: RUNBOOK_JOB_REASON,
          orgId: approval.orgId,
          subjectType: RUNBOOK_RUN_TARGET_SUBJECT,
          subjectId: targetId,
          payload: { runId, targetId, fromStepIndex: approval.stepIndex + 1 },
        });
        events.push({ type: 'step', runId, targetId, stepIndex: approval.stepIndex, status: 'succeeded' });
        events.push({ type: 'target', runId, targetId, status: 'queued' });
      } else {
        const code = outcome === 'rejected' ? FAILURE_CODES.APPROVAL_REJECTED : FAILURE_CODES.APPROVAL_EXPIRED;
        assertTransition('step', 'waiting_approval', 'failed');
        assertTransition('target', 'waiting', 'failed');
        await tx.runbookRunStep.update({ where: { id: step.id }, data: { status: 'failed', errorCode: code, finishedAt: now } });
        await tx.runbookRunStep.updateMany({ where: { runTargetId: targetId, status: 'pending' }, data: { status: 'skipped', finishedAt: now } });
        await tx.runbookRunTarget.update({
          where: { id: targetId },
          data: { status: 'failed', errorCode: code, errorMessage: outcome === 'rejected' ? 'The approval was rejected' : 'The approval expired', finishedAt: now },
        });
        events.push({ type: 'step', runId, targetId, stepIndex: approval.stepIndex, status: 'failed' });
        events.push({ type: 'target', runId, targetId, status: 'failed', errorCode: code });
      }
    }
    return mergeOutcomes(runId, local, await this.coordinator.advance(tx, runId, now));
  }
}
