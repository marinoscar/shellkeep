// =============================================================================
// "Stop AI" (issue #64)
// =============================================================================
//
// `POST /api/runbook-runs/:id/ai/stop` sets `ai_stop_requested_at` on the run. Every agent job reads it before
// each tool execution (and polls it while a command runs), so a running agent ends with `AI_STOPPED` before its
// next command. An AI step that is parked behind a pending approval has no job to notice: its approvals are
// closed here (`rejected`, "AI stopped") and the step fails `AI_STOPPED` at once.
//
// The run itself keeps going: only the AI steps stop. (To stop everything, cancel the run.)
// =============================================================================

import { HttpException, Inject, Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { recordAudit } from '../../common/audit/record-audit';
import { PrismaService } from '../../prisma/prisma.service';
import { RUNBOOK_RUN_ERROR_CODES } from '../engine/engine.error-codes';
import { RunCoordinatorService } from '../engine/run-coordinator.service';
import type { RunEvent } from '../engine/run-events';
import { RunEventsService } from '../engine/run-events.service';
import { RunbooksService } from '../runbooks.service';
import { applyAiApproval, AI_APPROVAL_KINDS } from './ai-approvals';

@Injectable()
export class RunbookAiStopService {
  private readonly logger = new Logger(RunbookAiStopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runbooks: RunbooksService,
    private readonly jobs: JobsService,
    private readonly coordinator: RunCoordinatorService,
    private readonly events: RunEventsService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  /** Asks the AI steps of a run to stop. `stoppedSteps` counts the parked steps failed right away. */
  async stop(principal: Principal, runId: string): Promise<{ id: string; stopRequested: true; stoppedSteps: number }> {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    const scope = { userId: principal.userId, orgId: principal.activeOrgId };
    const now = new Date();

    const run = await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookRun.findFirst({ where: { id: runId, orgId: scope.orgId }, select: { runbookId: true, initiatedBy: true, finishedAt: true, status: true } }),
    );
    // A run the caller may not run is a 404, never a 403 (the same rule as cancelling it).
    if (!run || (run.initiatedBy !== principal.userId && !(await this.runbooks.can(principal, run.runbookId, 'run')))) {
      throw new NotFoundException('Run not found');
    }
    if (run.finishedAt) {
      throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: `A ${run.status} run has no AI step to stop` }, 409);
    }

    const events: RunEvent[] = [];
    const stoppedSteps = await runInOrg(this.prisma, scope, async (tx) => {
      await tx.runbookRun.updateMany({ where: { id: runId, finishedAt: null }, data: { aiStopRequestedAt: now } });
      const pending = await tx.runbookApproval.findMany({ where: { runId, status: 'pending', kind: { in: [...AI_APPROVAL_KINDS] } } });
      let count = 0;
      for (const approval of pending) {
        const marked = await tx.runbookApproval.updateMany({
          where: { id: approval.id, status: 'pending' },
          data: { status: 'rejected', decidedBy: scope.userId, decidedAt: now, comment: 'AI stopped' },
        });
        if (marked.count !== 1) continue;
        events.push({ type: 'approval', runId, approvalId: approval.id, status: 'rejected', scope: approval.scope, kind: approval.kind });
        await applyAiApproval(tx, { jobs: this.jobs, coordinator: this.coordinator }, approval, 'rejected', now, events, { stopped: true });
        count += 1;
      }
      return count;
    });

    await this.events.publishAll(events);
    await recordAudit(this.auditSink, this.logger, {
      action: 'runbook_run.ai_stopped',
      actorUserId: scope.userId,
      targetType: 'runbook_run',
      targetId: runId,
      meta: { stoppedSteps },
    });
    return { id: runId, stopRequested: true, stoppedSteps };
  }
}
