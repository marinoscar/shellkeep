// =============================================================================
// `runbook.schedules.tick` (issue #66)
// =============================================================================
//
// A SYSTEM job (`orgId: null`) queued every minute by `RunbookSchedulesTask`. It FINDS the schedules that are
// due across organizations with the bypass client (registered reason `runbooks-schedules`) and CHANGES
// nothing there: every claim, check and run happens inside the schedule's own organization.
//
// FIRING ONE SCHEDULE, in order:
//   1. CLAIM. In the schedule's organization, `next_run_at` is moved to the first slot strictly after `now` by a
//      GUARDED update (`WHERE id AND enabled AND next_run_at = <the value read>`). Two ticks racing for the same
//      schedule: the second update waits for the first to commit, finds `next_run_at` changed and claims
//      nothing. So a schedule fires at most once per slot, with no raw `FOR UPDATE`. A slot missed during
//      downtime is not caught up: only the next future slot is set.
//   2. CHECK, as the person it runs as: still active, still holds `runbooks:run` and `servers:read`, may still
//      run the runbook; the runbook is not archived; the version exists; a destructive version is approved
//      for THIS version. Any failure switches the schedule off with a reason and notifies its owner (after
//      the write committed).
//   3. OVERLAP. `skip`: when the previous run has not finished nothing is created. `queue` and `allow` always
//      create the run.
//   4. RUN. `RunbookRunsService.create(..., 'schedule', { scheduleId, preApproved })` writes the run and
//      enqueues `runbook.run.start` in one transaction, exactly as a manual launch does.
//
// A claimed slot whose run could not be created is lost (at most once per slot, never twice); the outcome is
// the `failed` label of `app.runbooks.schedule_fires`. Idempotent per tick: a retry of the job finds nothing
// due. LOGGING: counts only; a schedule name, parameter or target never reaches a log line.
// =============================================================================

import { HttpException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import type { RunbookSchedule } from '@prisma/client';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { RUNBOOK_SCHEDULE_DISABLED_EVENT, type RunbookScheduleDisabledData } from '../../notifications-registry/runbooks.notifications';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { EngineAccessService } from '../engine/engine-access.service';
import { EngineMetricsService } from '../engine/engine-metrics.service';
import { RunbookRunsService } from '../engine/runbook-runs.service';
import { approvalStateOf, RunbookSchedulesService } from './runbook-schedules.service';
import { nextFireAfter } from './schedule-cron';
import {
  RUNBOOKS_SCHEDULES_REASON,
  RUNBOOK_SCHEDULES_TICK_TYPE,
  SCHEDULE_DISABLED_REASONS,
  TICK_BATCH,
  type ScheduleDisabledReason,
  type ScheduleFireOutcome,
} from './schedules.constants';

export interface TickResult {
  due: number;
  fired: number;
  skippedOverlap: number;
  disabled: number;
  failed: number;
  /** Another tick claimed the slot first. */
  raced: number;
}

@Injectable()
export class RunbookSchedulesTickHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_SCHEDULES_TICK_TYPE;
  readonly label = 'Fire due runbook schedules';
  readonly profile = { maxRuntimeMs: 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(RunbookSchedulesTickHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly system: PrismaSystemService,
    private readonly access: EngineAccessService,
    private readonly runs: RunbookRunsService,
    private readonly schedules: RunbookSchedulesService,
    private readonly notifications: NotificationsService,
    private readonly metrics: EngineMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.tick(new Date());
    this.logger.log(
      `schedules tick: ${result.due} due, ${result.fired} fired, ${result.skippedOverlap} skipped (overlap), ${result.disabled} disabled, ${result.failed} failed, ${result.raced} raced`,
    );
  }

  /** Fires every schedule due at `now`. The clock is a parameter so a test injects it. */
  async tick(now: Date): Promise<TickResult> {
    const result: TickResult = { due: 0, fired: 0, skippedOverlap: 0, disabled: 0, failed: 0, raced: 0 };
    const due = await this.system.runAsSystem(RUNBOOKS_SCHEDULES_REASON, (tx) =>
      tx.runbookSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: TICK_BATCH,
        select: { id: true, orgId: true },
      }),
    );
    result.due = due.length;
    for (const { id, orgId } of due) {
      let outcome: ScheduleFireOutcome | 'raced';
      try {
        outcome = await this.fire(orgId, id, now);
      } catch (error) {
        this.logger.warn(`a schedule could not be fired: ${error instanceof Error ? error.name : 'error'}`);
        outcome = 'failed';
      }
      if (outcome === 'raced') result.raced += 1;
      else {
        this.metrics.scheduleFire(outcome);
        if (outcome === 'fired') result.fired += 1;
        else if (outcome === 'skipped_overlap') result.skippedOverlap += 1;
        else if (outcome === 'disabled') result.disabled += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  /** Step 1: moves `next_run_at` forward and returns the row, or `null` when another tick claimed the slot. */
  private claim(orgId: string, scheduleId: string, now: Date): Promise<RunbookSchedule | null> {
    return runInOrg(this.prisma, { orgId }, async (tx) => {
      const row = await tx.runbookSchedule.findFirst({ where: { id: scheduleId, orgId, enabled: true, nextRunAt: { lte: now } } });
      if (!row || !row.nextRunAt) return null;
      let next: Date | null = null;
      try {
        next = nextFireAfter(row.cron, row.timezone, now);
      } catch {
        // an expression that no longer parses: the slot is claimed and the schedule parks (nextRunAt null below)
      }
      const claimed = await tx.runbookSchedule.updateMany({
        where: { id: scheduleId, orgId, enabled: true, nextRunAt: row.nextRunAt },
        data: { nextRunAt: next },
      });
      return claimed.count === 1 ? row : null;
    });
  }

  private async fire(orgId: string, scheduleId: string, now: Date): Promise<ScheduleFireOutcome | 'raced'> {
    const row = await this.claim(orgId, scheduleId, now);
    if (!row) return 'raced';

    const initiator = row.runAsUserId ? await this.access.load(row.runAsUserId, orgId) : null;
    const permitted =
      initiator !== null &&
      this.access.canRun(initiator) &&
      initiator.principal.permissions.includes(PERMISSIONS.SERVERS_READ) &&
      (await this.mayRun(initiator, row.runbookId));
    if (!initiator || !permitted) return this.disable(row, SCHEDULE_DISABLED_REASONS.PERMISSION_REVOKED);

    const context = await runInOrg(this.prisma, { orgId }, (tx) => this.schedules.loadContext(tx, orgId, row.runbookId, row.versionPin));
    if (!context || context.runbook.archivedAt) return this.disable(row, SCHEDULE_DISABLED_REASONS.RUNBOOK_ARCHIVED);
    if (!context.version) return this.disable(row, SCHEDULE_DISABLED_REASONS.VERSION_MISSING);
    const destructive = this.schedules.assess(context.version.definition).destructive;
    if (destructive && approvalStateOf(true, context.version.version, row) !== 'approved') {
      return this.disable(row, SCHEDULE_DISABLED_REASONS.APPROVAL_REQUIRED, context.runbook.name);
    }

    if (row.overlap === 'skip') {
      const active = await runInOrg(this.prisma, { orgId }, (tx) => this.schedules.previousRunActive(tx, orgId, row.lastRunId));
      if (active) return 'skipped_overlap';
    }

    try {
      const launched = await this.runs.create(initiator.principal, row.runbookId, this.schedules.runDto(row, context.version.version), 'schedule', {
        scheduleId: row.id,
        preApproved: destructive,
      });
      await runInOrg(this.prisma, { orgId }, (tx) =>
        tx.runbookSchedule.updateMany({ where: { id: row.id, orgId }, data: { lastRunId: launched.runId, lastFiredAt: now } }),
      );
      return 'fired';
    } catch (error) {
      // A refusal about the schedule's own content switches it off; a runbooks switch or a fault only loses the slot.
      if (error instanceof HttpException && [404, 409, 422, 428].includes(error.getStatus())) {
        return this.disable(row, SCHEDULE_DISABLED_REASONS.RUN_REJECTED, context.runbook.name);
      }
      this.logger.warn(`a scheduled run could not be created: ${error instanceof Error ? error.name : 'error'}`);
      return 'failed';
    }
  }

  private async mayRun(initiator: NonNullable<Awaited<ReturnType<EngineAccessService['load']>>>, runbookId: string): Promise<boolean> {
    try {
      await this.access.requireRun(initiator, runbookId);
      return true;
    } catch {
      return false;
    }
  }

  /** Switches the schedule off, then (after the write committed) tells the person it runs as. */
  private async disable(row: RunbookSchedule, reason: ScheduleDisabledReason, runbookName?: string): Promise<ScheduleFireOutcome> {
    await runInOrg(this.prisma, { orgId: row.orgId }, (tx) =>
      tx.runbookSchedule.updateMany({
        where: { id: row.id, orgId: row.orgId },
        data: { enabled: false, disabledReason: reason, nextRunAt: null },
      }),
    );
    if (row.runAsUserId) {
      try {
        const name =
          runbookName ??
          (await runInOrg(this.prisma, { orgId: row.orgId }, (tx) => tx.runbook.findFirst({ where: { id: row.runbookId, orgId: row.orgId }, select: { name: true } })))?.name ??
          'Runbook';
        const data: RunbookScheduleDisabledData = {
          scheduleName: row.name,
          runbookName: name,
          reason,
          link: `/runbooks/${row.runbookId}`,
        };
        await this.notifications.notify(RUNBOOK_SCHEDULE_DISABLED_EVENT, row.runAsUserId, data);
      } catch (error) {
        this.logger.warn(`the schedule-disabled notification failed: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
    return 'disabled';
  }
}
