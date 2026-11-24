// =============================================================================
// What happens AFTER a run's transaction commits (issue #62)
// =============================================================================
//
// `afterCommit(outcome)` is called by every writer of run state once its transaction has committed, never
// inside one: the run and target events go to the bus (the SSE stream and the matrix read them), the
// "run finished" event leaves the process for #63 and #66, and the notifications go out
// (`runbooks.run_finished` / `runbooks.run_failed` to the person who started the run,
// `runbooks.approval_requested` to the holders of `runbooks:approve`).
//
// IT NEVER THROWS. The rows are already committed and the stream replays from them, so a bus, mail or
// listener fault costs a log line, not a run.
//
// A notification names the runbook, its version and target COUNTS and links into the app: never a
// command, an output, a host or a credential (the templates cannot carry one).
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { runInOrg } from '@marinoscar/platform-api/core';
import { NotificationsService } from '@marinoscar/platform-api/notifications';

import type { RunbookApprovalRequestedData, RunbookRunNotificationData } from '../../email-templates/runbook-run.email';
import {
  RUNBOOK_APPROVAL_REQUESTED_EVENT,
  RUNBOOK_DRY_RUN_FINISHED_EVENT,
  RUNBOOK_RUN_FAILED_EVENT,
  RUNBOOK_RUN_FINISHED_EVENT as RUN_FINISHED_NOTIFICATION,
} from '../../notifications-registry/runbooks.notifications';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { EngineMetricsService } from './engine-metrics.service';
import type { AdvanceOutcome } from './run-coordinator.service';
import { RunEventsService } from './run-events.service';
import { RunbookRunFinished, RUNBOOK_RUN_FINISHED_EVENT } from './run-finished.event';

@Injectable()
export class RunLifecycleService {
  private readonly logger = new Logger(RunLifecycleService.name);

  constructor(
    private readonly events: RunEventsService,
    private readonly emitter: EventEmitter2,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly metrics: EngineMetricsService,
  ) {}

  async afterCommit(outcome: AdvanceOutcome): Promise<void> {
    try {
      await this.events.publishAll(outcome.events);
      for (const message of outcome.cancelRequests) await this.events.publishCancel(message);

      const { finished } = outcome;
      if (finished) {
        this.metrics.runFinished(finished.status, finished.trigger);
        // A dry run is not a real run: the in-process event feeds log collection and the webhooks (#63,
        // #66), and neither may see a rehearsal.
        if (!finished.dryRun) {
          this.emitter.emit(
            RUNBOOK_RUN_FINISHED_EVENT,
            new RunbookRunFinished(
              finished.runId,
              finished.orgId,
              finished.runbookId,
              finished.version,
              finished.status,
              finished.trigger,
              finished.initiatedBy,
              finished.targetsTotal,
              finished.targetsSucceeded,
              finished.targetsFailed,
            ),
          );
        }
        await this.notifyFinished(finished);
      }
      for (const approval of outcome.approvals) await this.notifyApprovers(approval);
    } catch (error) {
      this.logger.warn(`post-commit hooks failed for a run: ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  private async runbookName(orgId: string, runbookId: string): Promise<string> {
    try {
      const row = await runInOrg(this.prisma, { orgId }, (tx) =>
        tx.runbook.findUnique({ where: { id: runbookId }, select: { name: true } }),
      );
      return row?.name ?? 'Runbook';
    } catch {
      return 'Runbook';
    }
  }

  private async notifyFinished(finished: NonNullable<AdvanceOutcome['finished']>): Promise<void> {
    if (!finished.initiatedBy || finished.status === 'cancelled') return;
    const data: RunbookRunNotificationData = {
      runbookName: await this.runbookName(finished.orgId, finished.runbookId),
      version: finished.version,
      targetsTotal: finished.targetsTotal,
      targetsSucceeded: finished.targetsSucceeded,
      targetsFailed: finished.targetsFailed,
      runLink: `/runbooks/runs/${finished.runId}`,
    };
    const event = finished.dryRun
      ? RUNBOOK_DRY_RUN_FINISHED_EVENT
      : finished.status === 'succeeded'
        ? RUN_FINISHED_NOTIFICATION
        : RUNBOOK_RUN_FAILED_EVENT;
    await this.notifications.notify(event, finished.initiatedBy, data);
  }

  async notifyApprovers(approval: AdvanceOutcome['approvals'][number]): Promise<void> {
    const data: RunbookApprovalRequestedData = {
      runbookName: await this.runbookName(approval.orgId, approval.runbookId),
      version: approval.version,
      stepName: approval.stepName,
      targetsTotal: approval.targetsTotal,
      runLink: `/runbooks/runs/${approval.runId}`,
      approvalLink: `/runbooks/approvals?approval=${approval.approvalId}`,
    };
    await this.notifications.notifyPermissionHolders(RUNBOOK_APPROVAL_REQUESTED_EVENT, PERMISSIONS.RUNBOOKS_APPROVE, data);
  }
}
