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
import { RunbookRiskService, type DefinitionRisk } from '../safety/runbook-risk.service';
import { TargetResolverService } from '../target-resolver.service';
import { RUNBOOK_SECRET_PURPOSE } from '../runbooks.credentials';
import { runStrategySchema, type RunbookDefinition, targetSelectorSchema } from '../schema/runbook-definition.schema';
import type { CreateRunDto, RunsQueryDto } from './dto/run.dto';

type RunConfirm = NonNullable<CreateRunDto['confirm']>;

/** What starting a run answers: `awaitingApproval` is a destructive run parked behind its second person. */
export interface LaunchResult {
  runId: string;
  status: 'queued';
  dryRun: boolean;
  awaitingApproval: boolean;
  approvalId: string | null;
}
import { DESTRUCTIVE_RUN_STEP_INDEX, FAILURE_CODES, RUNBOOK_JOB_REASON, RUNBOOK_RUN_START_TYPE, RUNBOOK_RUN_SUBJECT } from './engine.constants';
import { EngineMetricsService } from './engine-metrics.service';
import { RUNBOOK_RUN_ERROR_CODES } from './engine.error-codes';
import { RunCoordinatorService, emptyOutcome, type AdvanceOutcome } from './run-coordinator.service';
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
    private readonly risk: RunbookRiskService,
    private readonly resolver: TargetResolverService,
    private readonly metrics: EngineMetricsService,
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
  async create(principal: Principal, runbookId: string, dto: CreateRunDto, trigger: 'manual' | 'api' | 'schedule' = 'manual'): Promise<LaunchResult> {
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
    const dryRun = dto.dryRun === true;
    const merged = runStrategySchema.parse({ ...definition.strategy, ...(dto.strategy ?? {}) });
    const strategy = {
      ...merged,
      concurrency: Math.min(merged.concurrency, effective.maxConcurrency),
      // A dry run creates no approvals: no canary pause.
      ...(dryRun ? { pauseAfterFirstBatch: false } : {}),
    };
    const selector = targetSelectorSchema.parse({ ...definition.defaultTargets, ...(dto.targets ?? {}) });

    return this.launch(principal, scope, {
      runbook: { id: runbook.id, name: runbook.name },
      version: version.version,
      definition,
      dryRun,
      confirm: dto.confirm,
      trigger,
      params: checked.values,
      secretRefs: checked.secretRefs,
      selector,
      strategy,
      requireApproval: !effective.approvals.allowSelfApproval,
      approvalExpirySec: effective.approvals.defaultExpirySec,
    });
  }

  /**
   * Writes the run and either enqueues its start job or, for a destructive run under the two-person rule,
   * parks it `queued` behind a `destructive_run` approval (no start job until a different person approves).
   * A destructive launch (not a dry run) must carry `confirm`: the runbook's exact name and the number of
   * servers the selector resolves to now, so a wrong tag cannot silently widen the blast radius.
   */
  private async launch(
    principal: Principal,
    scope: OwnerScope,
    input: {
      runbook: { id: string; name: string };
      version: number;
      definition: RunbookDefinition;
      dryRun: boolean;
      confirm: RunConfirm | undefined;
      trigger: 'manual' | 'api' | 'schedule';
      params: unknown;
      secretRefs: unknown;
      selector: unknown;
      strategy: unknown;
      retryOfRunId?: string;
      requireApproval: boolean;
      approvalExpirySec: number;
    },
  ): Promise<LaunchResult> {
    const assessment = this.risk.assessDefinition(input.definition);
    const destructive = !input.dryRun && assessment.destructive;
    const awaitingApproval = destructive && input.requireApproval;

    if (destructive) await this.requireConfirmation(principal, input.runbook.name, assessment, input.confirm, input.selector, input.requireApproval);

    const reasons = [...new Set(assessment.findings.filter((f) => f.destructive).flatMap((f) => f.reasons))];
    const approvalMessage = `Destructive run of "${input.runbook.name}": ${reasons.join('; ')}`.slice(0, 2000);

    const created = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.create({
        data: {
          orgId: scope.orgId,
          runbookId: input.runbook.id,
          version: input.version,
          status: 'queued',
          trigger: input.trigger,
          initiatedBy: scope.userId,
          ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
          dryRun: input.dryRun,
          destructive,
          params: input.params as Prisma.InputJsonValue,
          secretRefs: input.secretRefs as Prisma.InputJsonValue,
          targetSelector: input.selector as Prisma.InputJsonValue,
          strategy: input.strategy as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      let approvalId: string | null = null;
      if (awaitingApproval) {
        const approval = await tx.runbookApproval.create({
          data: {
            orgId: scope.orgId,
            runId: run.id,
            runTargetId: null,
            scopeKey: 'run',
            scope: 'run',
            kind: 'destructive_run',
            stepIndex: DESTRUCTIVE_RUN_STEP_INDEX,
            stepName: 'Destructive run',
            message: approvalMessage,
            expiresAt: new Date(Date.now() + input.approvalExpirySec * 1000),
          },
          select: { id: true },
        });
        approvalId = approval.id;
      } else {
        await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: RUNBOOK_RUN_START_TYPE,
          reason: RUNBOOK_JOB_REASON,
          orgId: scope.orgId,
          subjectType: RUNBOOK_RUN_SUBJECT,
          subjectId: run.id,
          payload: { runId: run.id },
        });
      }
      return { runId: run.id, approvalId };
    });

    await this.audit('runbook_run.created', scope, created.runId, {
      runbookId: input.runbook.id,
      version: input.version,
      trigger: input.trigger,
      dryRun: input.dryRun,
      destructive,
      ...(input.retryOfRunId ? { retryOf: input.retryOfRunId } : {}),
    });
    if (input.dryRun) this.metrics.dryRun();
    if (destructive) {
      this.metrics.destructiveRun('confirmed');
      await this.audit('runbook_run.destructive_confirmed', scope, created.runId, {
        runbookId: input.runbook.id,
        version: input.version,
        findings: assessment.findings.filter((f) => f.destructive).length,
        requiresApproval: awaitingApproval,
      });
    }
    if (created.approvalId) {
      const outcome = emptyOutcome(created.runId);
      outcome.events.push({ type: 'approval', runId: created.runId, approvalId: created.approvalId, status: 'pending', scope: 'run', kind: 'destructive_run' });
      outcome.approvals.push({
        approvalId: created.approvalId,
        runId: created.runId,
        orgId: scope.orgId,
        runbookId: input.runbook.id,
        version: input.version,
        stepName: 'Destructive run',
        targetsTotal: input.confirm?.targetCount ?? 0,
        kind: 'destructive_run',
      });
      await this.lifecycle.afterCommit(outcome);
    }
    return { runId: created.runId, status: 'queued', dryRun: input.dryRun, awaitingApproval, approvalId: created.approvalId };
  }

  /** 428 unless `confirm` names the runbook exactly and the count of servers the selector resolves to now. */
  private async requireConfirmation(
    principal: Principal,
    runbookName: string,
    assessment: DefinitionRisk,
    confirm: RunConfirm | undefined,
    selector: unknown,
    requiresApproval: boolean,
  ): Promise<void> {
    const resolved = await this.resolver.resolve(principal, selector as never);
    const targetCount = resolved.targets.length;
    if (confirm && confirm.runbookName === runbookName && confirm.targetCount === targetCount) return;
    this.metrics.destructiveRun('blocked');
    throw new HttpException(
      {
        code: RUNBOOK_RUN_ERROR_CODES.CONFIRMATION_REQUIRED,
        message: confirm
          ? 'The confirmation does not match: type the exact runbook name and the number of servers this run will change'
          : 'This runbook has a destructive step: confirm the runbook name and the number of servers before it runs',
        details: { runbookName, targetCount, requiresApproval, findings: assessment.findings.filter((f) => f.destructive) },
      },
      428,
    );
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
      };
      const [total, rows] = await Promise.all([
        tx.runbookRun.count({ where }),
        tx.runbookRun.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true, runbookId: true, version: true, status: true, trigger: true, initiatedBy: true, dryRun: true, destructive: true, errorCode: true,
            createdAt: true, startedAt: true, finishedAt: true, runbook: { select: { name: true } },
          },
        }),
      ]);
      return {
        items: rows.map(({ runbook, ...run }) => ({ ...run, runbookName: runbook.name })),
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
          // An AI step's closing summary (#64); its stored conversation is never part of a read.
          aiSummary: true,
        },
      });
      const approvals = await tx.runbookApproval.findMany({
        where: { runId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, scope: true, status: true, stepIndex: true, stepName: true, expiresAt: true, decidedBy: true, decidedAt: true, runTargetId: true, message: true, payload: true },
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
        // The run's approvals (the canary pause, step gates, `destructive_run` and, for an AI step, `ai_command` and `ai_plan` with their payload).
        approvals,
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
      // A destructive run still waiting for its second person has no start job and no targets: nothing
      // would ever settle a `cancelling` run, so it is cancelled outright and its approval closed.
      if (run.status === 'queued') {
        const parked = await tx.runbookApproval.findFirst({ where: { runId: id, kind: 'destructive_run', status: 'pending' }, select: { id: true } });
        if (parked) {
          assertTransition('run', 'queued', 'cancelled');
          await tx.runbookApproval.update({ where: { id: parked.id }, data: { status: 'expired', decidedAt: now, comment: 'The run was cancelled before this was decided' } });
          const row = await tx.runbookRun.update({
            where: { id },
            data: { status: 'cancelled', cancelRequestedAt: now, finishedAt: now, errorCode: FAILURE_CODES.CANCELLED },
            select: { trigger: true, initiatedBy: true, runbookId: true, version: true, dryRun: true },
          });
          const parkedOutcome = emptyOutcome(id);
          parkedOutcome.events.push({ type: 'run', runId: id, status: 'cancelled', finishedAt: now.toISOString() });
          parkedOutcome.finished = { runId: id, orgId: scope.orgId, status: 'cancelled', targetsTotal: 0, targetsSucceeded: 0, targetsFailed: 0, ...row };
          return parkedOutcome;
        }
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

  /**
   * A new run with the same version, parameters and strategy, on the failed servers (or all of them). A
   * retry of a dry run is a dry run; a retry of a destructive runbook carries the same confirmation and
   * the same two-person rule as the launch it repeats.
   */
  async retry(principal: Principal, id: string, only: 'failed' | 'all', confirm?: RunConfirm): Promise<LaunchResult> {
    const scope = this.scopeOf(principal);
    await this.requireEnabled(scope.orgId);
    const source = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.findFirst({ where: { id, orgId: scope.orgId }, include: { runbook: { select: { name: true } }, runbookVersion: true } });
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
    const effective = await this.settings.effective(scope.orgId);

    return this.launch(principal, scope, {
      runbook: { id: source.run.runbookId, name: source.run.runbook.name },
      version: source.run.version,
      definition: source.run.runbookVersion.definition as unknown as RunbookDefinition,
      dryRun: source.run.dryRun,
      confirm,
      trigger: 'manual',
      params: source.run.params,
      secretRefs: source.run.secretRefs,
      selector: { serverIds: source.serverIds, tags: { any: [], all: [] }, groupIds: [], exclude: [] },
      strategy: source.run.strategy,
      retryOfRunId: source.run.id,
      requireApproval: !effective.approvals.allowSelfApproval,
      approvalExpirySec: effective.approvals.defaultExpirySec,
    });
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
