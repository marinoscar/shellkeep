// =============================================================================
// Runs: create, read, cancel, retry (issue #62)
// =============================================================================
//
// `create` validates the parameters against the version's definition and the secret references against
// the organization's runbook secrets, writes a `queued` run and enqueues `runbook.run.start` IN THE SAME
// TRANSACTION (a run exists if and only if its start job does). The row holds the NON-SECRET parameter
// values and the NAMES of the secrets: the value of a secret is read by the target job, in memory, and
// never reaches a row, a payload or a log.
//
// `cancel` flips the run to `cancelling` and lets `advance` cancel what has not started; running targets
// notice through the `runbooks.cancel` message and a 2-second poll.
// =============================================================================

import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';
import { JobsService, type JobsTx } from '@marinoscar/platform-api/jobs';
import type { Prisma } from '@prisma/client';

import { recordAudit } from '../../common/audit/record-audit';
import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { RunbooksService } from '../runbooks.service';
import { RUNBOOK_SECRET_PURPOSE } from '../runbooks.credentials';
import { runStrategySchema, type RunbookDefinition, targetSelectorSchema } from '../schema/runbook-definition.schema';
import type { CreateRunDto, RunsQueryDto } from './dto/run.dto';
import { sinceToDate } from './dto/run.dto';
import { FAILURE_CODES, RUNBOOK_JOB_REASON, RUNBOOK_RUN_START_TYPE, RUNBOOK_RUN_SUBJECT } from './engine.constants';
import { RUNBOOK_RUN_ERROR_CODES } from './engine.error-codes';
import { RunCoordinatorService, type AdvanceOutcome } from './run-coordinator.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { checkRunParams } from './run-params';
import { RunbookSettingsService } from './runbook-settings.service';
import { assertTransition, type RunStatus } from './state-machine';

const CANCELLABLE: readonly string[] = ['queued', 'resolving', 'running', 'paused'];

@Injectable()
export class RunbookRunsService {
  private readonly logger = new Logger(RunbookRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly runbooks: RunbooksService,
    private readonly credentials: OrgCredentialsService,
    private readonly settings: RunbookSettingsService,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  /**
   * The run, when the caller may see it: they started it, or they may read its runbook (a runbook is private
   * by default, sharing grants access). A run the caller cannot see is a 404, never a 403.
   */
  private async visibleRun(principal: Principal, id: string, action: 'read' | 'run' = 'read') {
    const scope = this.scopeOf(principal);
    const run = await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookRun.findFirst({ where: { id, orgId: scope.orgId }, select: { id: true, runbookId: true, initiatedBy: true } }),
    );
    if (!run) throw new NotFoundException('Run not found');
    if (run.initiatedBy !== principal.userId && !(await this.runbooks.can(principal, run.runbookId, action))) {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  /** Throws 404 unless the caller may read the run. */
  async requireVisible(principal: Principal, id: string): Promise<void> {
    await this.visibleRun(principal, id);
  }

  private async requireEnabled(orgId: string): Promise<void> {
    if (!(await this.settings.effective(orgId)).enabled) {
      throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.DISABLED, message: 'Runbooks are switched off' }, 503);
    }
  }

  /** Creates a queued run and its start job. */
  async create(principal: Principal, runbookId: string, dto: CreateRunDto, trigger: 'manual' | 'api' | 'schedule' = 'manual'): Promise<{ runId: string }> {
    const scope = this.scopeOf(principal);
    await this.requireEnabled(scope.orgId);
    await this.runbooks.requireRun(principal, runbookId); // 404 for a runbook the caller cannot see, 404 for one they may not run

    const { runbook, version } = await runInOrg(this.prisma, scope, async (tx) => {
      const row = await tx.runbook.findFirst({ where: { id: runbookId, orgId: scope.orgId } });
      if (!row) return { runbook: null, version: null };
      const found = await tx.runbookVersion.findFirst({
        where: { runbookId, orgId: scope.orgId, ...(dto.version !== undefined ? { version: dto.version } : { id: row.latestVersionId ?? '' }) },
      });
      return { runbook: row, version: found };
    });
    if (!runbook) throw new NotFoundException('Runbook not found');
    if (runbook.archivedAt) throw new HttpException({ code: 'RUNBOOK_ARCHIVED', message: 'The runbook is archived' }, 409);
    if (!version) throw new NotFoundException('Runbook version not found');
    const definition = version.definition as unknown as RunbookDefinition;

    const checked = checkRunParams(definition, dto.params ?? {}, dto.secretRefs ?? {});
    const issues = [...checked.issues];
    for (const [param, name] of Object.entries(checked.secretRefs)) {
      const exists = await this.credentials.describe(scope.orgId, RUNBOOK_SECRET_PURPOSE, name);
      if (!exists) {
        throw new UnprocessableEntityException({
          code: RUNBOOK_RUN_ERROR_CODES.SECRET_REF_UNKNOWN,
          message: `The secret for ${param} does not exist`,
          details: { parameter: param },
        });
      }
    }
    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        code: RUNBOOK_RUN_ERROR_CODES.PARAMS_INVALID,
        message: 'The run parameters are not valid',
        details: { issues },
      });
    }

    const effective = await this.settings.effective(scope.orgId);
    const merged = runStrategySchema.parse({ ...definition.strategy, ...(dto.strategy ?? {}) });
    const strategy = { ...merged, concurrency: Math.min(merged.concurrency, effective.maxConcurrency) };
    const selector = targetSelectorSchema.parse({ ...definition.defaultTargets, ...(dto.targets ?? {}) });

    const runId = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.create({
        data: {
          orgId: scope.orgId,
          runbookId,
          version: version.version,
          status: 'queued',
          trigger,
          initiatedBy: scope.userId,
          params: checked.values as Prisma.InputJsonValue,
          secretRefs: checked.secretRefs as Prisma.InputJsonValue,
          targetSelector: selector as unknown as Prisma.InputJsonValue,
          strategy: strategy as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
        type: RUNBOOK_RUN_START_TYPE,
        reason: RUNBOOK_JOB_REASON,
        orgId: scope.orgId,
        subjectType: RUNBOOK_RUN_SUBJECT,
        subjectId: run.id,
        payload: { runId: run.id },
      });
      return run.id;
    });
    await this.audit('runbook_run.created', scope, runId, { runbookId, version: version.version, trigger });
    return { runId };
  }

  async list(principal: Principal, query: RunsQueryDto) {
    const scope = this.scopeOf(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const readable = await this.runbooks.readableWhere(tx, principal);
      const where: Prisma.RunbookRunWhereInput = {
        orgId: scope.orgId,
        OR: [{ initiatedBy: principal.userId }, { runbook: readable }],
        ...(query.runbookId ? { runbookId: query.runbookId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.trigger ? { trigger: query.trigger } : {}),
        ...(query.initiatedBy ? { initiatedBy: query.initiatedBy } : {}),
        ...(query.since ? { createdAt: { gte: sinceToDate(query.since) } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.runbookRun.count({ where }),
        tx.runbookRun.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true, runbookId: true, version: true, status: true, trigger: true, initiatedBy: true,
            createdAt: true, startedAt: true, finishedAt: true, runbook: { select: { name: true } },
          },
        }),
      ]);
      // The succeeded / failed / total split of each listed run's servers (one grouped query, #65).
      const grouped = rows.length
        ? await tx.runbookRunTarget.groupBy({
            by: ['runId', 'status'],
            where: { orgId: scope.orgId, runId: { in: rows.map((r) => r.id) } },
            _count: { _all: true },
          })
        : [];
      const targetsOf = (runId: string) => {
        const counts = { total: 0, succeeded: 0, failed: 0, running: 0 };
        for (const g of grouped) {
          if (g.runId !== runId) continue;
          const n = g._count._all;
          counts.total += n;
          if (g.status === 'succeeded') counts.succeeded += n;
          else if (g.status === 'failed' || g.status === 'cancelled') counts.failed += n;
          else if (g.status === 'running' || g.status === 'waiting' || g.status === 'queued') counts.running += n;
        }
        return counts;
      };
      return {
        items: rows.map(({ runbook, ...run }) => ({ ...run, runbookName: runbook.name, targets: targetsOf(run.id) })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** The run, its targets, the steps matrix and counts. Parameters are the stored non-secret values. */
  async get(principal: Principal, id: string) {
    await this.visibleRun(principal, id);
    const scope = this.scopeOf(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.findFirst({
        where: { id, orgId: scope.orgId },
        include: { runbook: { select: { name: true } } },
      });
      if (!run) throw new NotFoundException('Run not found');
      const targets = await tx.runbookRunTarget.findMany({ where: { runId: id }, orderBy: { position: 'asc' } });
      const steps = await tx.runbookRunStep.findMany({
        where: { runId: id },
        orderBy: [{ runTargetId: 'asc' }, { stepIndex: 'asc' }],
        select: {
          id: true, runTargetId: true, stepIndex: true, stepId: true, kind: true, name: true, status: true, exitCode: true,
          durationMs: true, errorCode: true, logBytes: true, logTruncated: true, startedAt: true, finishedAt: true,
        },
      });
      const counts: Record<string, number> = {};
      for (const t of targets) counts[t.status] = (counts[t.status] ?? 0) + 1;
      const stepsByTarget = new Map<string, typeof steps>();
      for (const step of steps) stepsByTarget.set(step.runTargetId, [...(stepsByTarget.get(step.runTargetId) ?? []), step]);
      const { runbook, secretRefs, ...rest } = run;
      return {
        ...rest,
        runbookName: runbook.name,
        // The NAMES of the secrets, never a value.
        secretRefs,
        counts: { total: targets.length, ...counts },
        targets: targets.map((t) => ({ ...t, steps: stepsByTarget.get(t.id) ?? [] })),
      };
    });
  }

  /** The id of a step row, for the log routes. */
  async stepRowId(principal: Principal, runId: string, targetId: string, stepIndex: number): Promise<string> {
    await this.visibleRun(principal, runId);
    const scope = this.scopeOf(principal);
    const row = await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookRunStep.findFirst({ where: { runId, runTargetId: targetId, stepIndex, orgId: scope.orgId }, select: { id: true } }),
    );
    if (!row) throw new NotFoundException('Step not found');
    return row.id;
  }

  async cancel(principal: Principal, id: string): Promise<{ id: string; status: string }> {
    await this.visibleRun(principal, id, 'run');
    const scope = this.scopeOf(principal);
    const now = new Date();
    const result = await runInOrg(this.prisma, scope, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM runbook_runs WHERE id = ${id}::uuid AND org_id = ${scope.orgId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Run not found');
      const run = await tx.runbookRun.findUniqueOrThrow({ where: { id }, select: { status: true, finishedAt: true } });
      if (run.finishedAt || !CANCELLABLE.includes(run.status)) {
        throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: `A ${run.status} run cannot be cancelled` }, 409);
      }
      assertTransition('run', run.status, 'cancelling');
      await tx.runbookRun.update({ where: { id }, data: { status: 'cancelling', cancelRequestedAt: now } });
      await tx.runbookRunTarget.updateMany({
        where: { runId: id, status: { in: ['queued', 'running'] }, cancelRequestedAt: null },
        data: { cancelRequestedAt: now },
      });
      const outcome = await this.coordinator.advance(tx, id, now);
      outcome.events.unshift({ type: 'run', runId: id, status: outcome.finished?.status ?? 'cancelling' });
      outcome.cancelRequests.push({ runId: id });
      return outcome;
    });
    await this.lifecycle.afterCommit(result);
    await this.audit('runbook_run.cancelled', scope, id, {});
    return { id, status: result.finished?.status ?? 'cancelling' };
  }

  async cancelTarget(principal: Principal, runId: string, targetId: string): Promise<{ id: string; status: string }> {
    await this.visibleRun(principal, runId, 'run');
    const scope = this.scopeOf(principal);
    const now = new Date();
    const result = await runInOrg(this.prisma, scope, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM runbook_runs WHERE id = ${runId}::uuid AND org_id = ${scope.orgId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Run not found');
      const target = await tx.runbookRunTarget.findFirst({ where: { id: targetId, runId }, select: { status: true } });
      if (!target) throw new NotFoundException('Target not found');
      const outcome: AdvanceOutcome = { runId, events: [], cancelRequests: [], finished: null, approvals: [], dispatched: 0 };
      if (['succeeded', 'failed', 'skipped', 'cancelled'].includes(target.status)) {
        throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: `A ${target.status} target cannot be cancelled` }, 409);
      }
      if (target.status === 'pending' || target.status === 'waiting') {
        assertTransition('target', target.status, 'cancelled');
        await tx.runbookRunTarget.update({
          where: { id: targetId },
          data: { status: 'cancelled', errorCode: FAILURE_CODES.CANCELLED, cancelRequestedAt: now, finishedAt: now },
        });
        await tx.runbookRunStep.updateMany({
          where: { runTargetId: targetId, status: { in: ['pending', 'waiting_approval'] } },
          data: { status: 'cancelled', finishedAt: now },
        });
        outcome.events.push({ type: 'target', runId, targetId, status: 'cancelled', errorCode: FAILURE_CODES.CANCELLED });
      } else {
        await tx.runbookRunTarget.update({ where: { id: targetId }, data: { cancelRequestedAt: now } });
        outcome.cancelRequests.push({ runId, targetId });
      }
      const advanced = await this.coordinator.advance(tx, runId, now);
      return { ...advanced, events: [...outcome.events, ...advanced.events], cancelRequests: [...outcome.cancelRequests, ...advanced.cancelRequests] };
    });
    await this.lifecycle.afterCommit(result);
    await this.audit('runbook_run.target_cancelled', scope, runId, { targetId });
    return { id: targetId, status: 'cancelling' };
  }

  /** A new run with the same version, parameters and strategy, on the failed servers (or all of them). */
  async retry(principal: Principal, id: string, only: 'failed' | 'all'): Promise<{ runId: string }> {
    const scope = this.scopeOf(principal);
    await this.requireEnabled(scope.orgId);
    const source = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.findFirst({ where: { id, orgId: scope.orgId } });
      if (!run) throw new NotFoundException('Run not found');
      const targets = await tx.runbookRunTarget.findMany({
        where: { runId: id, serverProfileId: { not: null }, ...(only === 'failed' ? { status: { in: ['failed', 'cancelled'] } } : { status: { not: 'skipped' } }) },
        select: { serverProfileId: true },
      });
      return { run, serverIds: targets.map((t) => t.serverProfileId!).filter(Boolean) };
    });
    await this.runbooks.requireRun(principal, source.run.runbookId);
    if (!source.run.finishedAt) throw new HttpException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: 'Only a finished run can be retried' }, 409);
    if (source.serverIds.length === 0) {
      throw new UnprocessableEntityException({ code: RUNBOOK_RUN_ERROR_CODES.NO_TARGETS, message: 'There is nothing to retry' });
    }

    const runId = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.create({
        data: {
          orgId: scope.orgId,
          runbookId: source.run.runbookId,
          version: source.run.version,
          status: 'queued',
          trigger: 'manual',
          initiatedBy: scope.userId,
          retryOfRunId: source.run.id,
          params: source.run.params as Prisma.InputJsonValue,
          secretRefs: source.run.secretRefs as Prisma.InputJsonValue,
          targetSelector: { serverIds: source.serverIds, tags: { any: [], all: [] }, groupIds: [], exclude: [] },
          strategy: source.run.strategy as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
        type: RUNBOOK_RUN_START_TYPE,
        reason: RUNBOOK_JOB_REASON,
        orgId: scope.orgId,
        subjectType: RUNBOOK_RUN_SUBJECT,
        subjectId: run.id,
        payload: { runId: run.id },
      });
      return run.id;
    });
    await this.audit('runbook_run.created', scope, runId, { retryOf: id, only });
    return { runId };
  }

  private async audit(action: string, scope: OwnerScope, runId: string, meta: Record<string, unknown>): Promise<void> {
    await recordAudit(this.auditSink, this.logger, {
      action,
      actorUserId: scope.userId,
      targetType: 'runbook_run',
      targetId: runId,
      meta: meta as never,
    });
  }
}

export type { RunStatus };
