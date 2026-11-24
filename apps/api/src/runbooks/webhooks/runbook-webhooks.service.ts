// =============================================================================
// Raising the runbook webhook events (issue #66)
// =============================================================================
//
// Called by `RunLifecycleService.afterCommit`, AFTER the transaction that finished the run (or created the
// approval) committed, outside any `$transaction`. `emit` opens its own short transaction and makes no HTTP
// request (the delivery is a queue job). NEVER THROWS: a webhook must not fail the run, so a failure is logged
// by name only. Payloads are metadata (see `runbooks.webhooks.ts`); the link is absolute when `APP_URL` is set.
// =============================================================================

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runInOrg } from '@marinoscar/platform-api/core';
import { WebhooksService } from '@marinoscar/platform-api/webhooks';

import { PrismaService } from '../../prisma/prisma.service';
import {
  RUNBOOK_WEBHOOK_EVENTS,
  RUN_COMPLETED_STATUSES,
  type RunbookApprovalRequestedData,
  type RunbookRunCompletedData,
} from './runbooks.webhooks';

export interface FinishedRunRef {
  runId: string;
  orgId: string;
}

export interface ApprovalRef {
  approvalId: string;
  runId: string;
  orgId: string;
  kind: string;
}

@Injectable()
export class RunbookWebhooksService {
  private readonly logger = new Logger(RunbookWebhooksService.name);

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private link(path: string): string {
    const base = this.config?.get<string>('appUrl');
    return base ? `${base.replace(/\/+$/, '')}${path}` : path;
  }

  /** `runbook.run.completed`, from the run's committed rows. A dry run never reaches here. */
  async runCompleted(finished: FinishedRunRef): Promise<void> {
    try {
      const run = await runInOrg(this.prisma, { orgId: finished.orgId }, async (tx) => {
        const row = await tx.runbookRun.findFirst({
          where: { id: finished.runId, orgId: finished.orgId },
          select: { id: true, runbookId: true, version: true, status: true, trigger: true, scheduleId: true, startedAt: true, finishedAt: true, dryRun: true, runbook: { select: { name: true } } },
        });
        if (!row) return null;
        const grouped = await tx.runbookRunTarget.groupBy({ by: ['status'], where: { runId: finished.runId }, _count: { _all: true } });
        return { row, grouped };
      });
      if (!run || run.row.dryRun || !run.row.finishedAt) return;
      if (!(RUN_COMPLETED_STATUSES as readonly string[]).includes(run.row.status)) return;
      const count = (status: string): number => run.grouped.find((g: { status: string }) => g.status === status)?._count._all ?? 0;
      const data: RunbookRunCompletedData = {
        runId: run.row.id,
        runbookId: run.row.runbookId,
        runbookName: run.row.runbook.name,
        version: run.row.version,
        status: run.row.status as RunbookRunCompletedData['status'],
        trigger: run.row.trigger as RunbookRunCompletedData['trigger'],
        ...(run.row.scheduleId ? { scheduleId: run.row.scheduleId } : {}),
        counts: {
          total: run.grouped.reduce((sum: number, g: { _count: { _all: number } }) => sum + g._count._all, 0),
          succeeded: count('succeeded'),
          failed: count('failed'),
          cancelled: count('cancelled'),
          skipped: count('skipped'),
        },
        startedAt: run.row.startedAt ? run.row.startedAt.toISOString() : null,
        finishedAt: run.row.finishedAt.toISOString(),
        url: this.link(`/runbooks/runs/${run.row.id}`),
      };
      await this.webhooks.emit(RUNBOOK_WEBHOOK_EVENTS.RUN_COMPLETED, data as unknown as Record<string, unknown>, {
        orgId: finished.orgId,
        occurredAt: run.row.finishedAt,
      });
    } catch (error) {
      this.logger.warn(`Could not raise webhook event ${RUNBOOK_WEBHOOK_EVENTS.RUN_COMPLETED}: ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  /** `runbook.approval.requested`, from the approval row (never its message or the command). */
  async approvalRequested(approval: ApprovalRef): Promise<void> {
    try {
      const row = await runInOrg(this.prisma, { orgId: approval.orgId }, (tx) =>
        tx.runbookApproval.findFirst({
          where: { id: approval.approvalId, orgId: approval.orgId },
          select: { id: true, runId: true, kind: true, expiresAt: true, run: { select: { runbook: { select: { name: true } } } } },
        }),
      );
      if (!row) return;
      const data: RunbookApprovalRequestedData = {
        approvalId: row.id,
        runId: row.runId,
        kind: row.kind as RunbookApprovalRequestedData['kind'],
        runbookName: row.run.runbook.name,
        expiresAt: row.expiresAt.toISOString(),
        url: this.link(`/runbooks/approvals?approval=${row.id}`),
      };
      await this.webhooks.emit(RUNBOOK_WEBHOOK_EVENTS.APPROVAL_REQUESTED, data as unknown as Record<string, unknown>, { orgId: approval.orgId });
    } catch (error) {
      this.logger.warn(`Could not raise webhook event ${RUNBOOK_WEBHOOK_EVENTS.APPROVAL_REQUESTED}: ${error instanceof Error ? error.name : 'error'}`);
    }
  }
}
