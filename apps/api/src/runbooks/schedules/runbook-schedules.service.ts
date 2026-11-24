// =============================================================================
// Runbook schedules: create, read, change, approve, run now (issue #66)
// =============================================================================
//
// A schedule is a cron expression (5 fields, an IANA zone) over a runbook, with the parameters, targets and
// strategy a run needs. It acts AS the person it runs as (`run_as_user_id`): the creator, or whoever last
// changed a field that decides what it does (changing the targets, the parameters or the version rebinds it,
// so nobody's identity runs what someone else edited in). The tick re-checks that person's permissions on
// every fire (`runbook-schedules-tick.handler.ts`).
//
// DESTRUCTIVE RUNBOOKS (#67). A schedule skips the per-run confirmation and the second person, so both
// happen once, to the SCHEDULE:
//   - creating (or materially changing) a schedule of a destructive version needs the same `confirm`
//     (runbook name and resolved server count) a manual launch needs (428 without it);
//   - then a person other than the one it runs as, holding `runbooks:approve`, approves the schedule
//     (`POST .../approve`), unless the organization allows self-approval (then the confirmation is the
//     approval). Until then it is `enabled: false` with `disabledReason: APPROVAL_REQUIRED`;
//   - the approval covers ONE version (`approved_version`). A new destructive version under `latest` is a
//     different thing: the tick switches the schedule off (`APPROVAL_REQUIRED`) until it is approved again.
// A schedule can never be enabled, or run now, while a destructive version has no approval for it.
//
// A "material" change is one of: the targets, the parameters, the secret references, the strategy or the
// version pin. Renaming, retiming, the overlap policy and enabling do not need a new approval.
//
// Everything runs in the caller's organization (`runInOrg`); a schedule or runbook the caller cannot see is 404.
// =============================================================================

import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal, type RlsTransactionClient } from '@marinoscar/platform-api/core';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';
import { Prisma, type RunbookSchedule } from '@prisma/client';

import { recordAudit } from '../../common/audit/record-audit';
import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateRunDto } from '../engine/dto/run.dto';
import { EngineMetricsService } from '../engine/engine-metrics.service';
import { RUNBOOK_RUN_ERROR_CODES } from '../engine/engine.error-codes';
import { checkRunParams } from '../engine/run-params';
import { RunbookRunsService, type LaunchResult } from '../engine/runbook-runs.service';
import { RunbookSettingsService } from '../engine/runbook-settings.service';
import { RUNBOOK_SECRET_PURPOSE } from '../runbooks.credentials';
import { RunbooksService } from '../runbooks.service';
import { RunbookRiskService, type DefinitionRisk } from '../safety/runbook-risk.service';
import { targetSelectorSchema, type RunbookDefinition } from '../schema/runbook-definition.schema';
import { TargetResolverService } from '../target-resolver.service';
import type { ApproveScheduleDto, CreateScheduleDto, SchedulesQueryDto, UpdateScheduleDto } from './dto/schedule.dto';
import { PREVIEW_COUNT, ScheduleCronError, assertValidSchedule, nextFireAfter, nextFireTimes } from './schedule-cron';
import { SCHEDULE_DISABLED_REASONS, type OverlapPolicy } from './schedules.constants';
import { RUNBOOK_SCHEDULE_ERROR_CODES } from './schedules.error-codes';

type OrgTx = RlsTransactionClient<PrismaService>;

/** `not_required` (not destructive), `pending` (never approved), `approved` (this version), `stale` (approved an earlier version). */
export type ScheduleApprovalState = 'not_required' | 'pending' | 'approved' | 'stale';

export interface ScheduleView {
  id: string;
  runbookId: string;
  name: string;
  cron: string;
  timezone: string;
  versionPin: string;
  /** The version number the next fire would run (`null` when the pinned version is gone). */
  resolvedVersion: number | null;
  params: unknown;
  /** The NAMES of the secrets, never a value. */
  secretRefs: unknown;
  targets: unknown;
  strategy: unknown;
  overlap: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastFiredAt: Date | null;
  runAsUserId: string | null;
  disabledReason: string | null;
  destructive: boolean;
  approval: { state: ScheduleApprovalState; approvedBy: string | null; approvedAt: Date | null; approvedVersion: number | null };
  createdAt: Date;
  updatedAt: Date;
}

/** The runbook and the version a schedule resolves to right now. */
export interface ScheduleContext {
  runbook: { id: string; name: string; archivedAt: Date | null; latestVersionId: string | null };
  version: { id: string; version: number; definition: RunbookDefinition } | null;
}

/** The approval state of `row` against the version it would run. */
export function approvalStateOf(
  destructive: boolean,
  version: number | null,
  row: Pick<RunbookSchedule, 'approvedAt' | 'approvedVersion'>,
): ScheduleApprovalState {
  if (!destructive) return 'not_required';
  if (version !== null && row.approvedAt && row.approvedVersion === version) return 'approved';
  return row.approvedAt ? 'stale' : 'pending';
}

const MATERIAL_FIELDS = ['params', 'secretRefs', 'targets', 'strategy', 'versionPin'] as const;

@Injectable()
export class RunbookSchedulesService {
  private readonly logger = new Logger(RunbookSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runbooks: RunbooksService,
    private readonly runs: RunbookRunsService,
    private readonly settings: RunbookSettingsService,
    private readonly credentials: OrgCredentialsService,
    private readonly resolver: TargetResolverService,
    private readonly risk: RunbookRiskService,
    private readonly metrics: EngineMetricsService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  private invalid(message: string, details: Record<string, unknown> = {}): UnprocessableEntityException {
    return new UnprocessableEntityException({ code: RUNBOOK_SCHEDULE_ERROR_CODES.INVALID, message, details });
  }

  /** Throws 422 unless the expression and the zone are valid. */
  private assertSchedule(cron: string, timezone: string): void {
    try {
      assertValidSchedule(cron, timezone);
    } catch (error) {
      if (error instanceof ScheduleCronError) {
        throw this.invalid(error.message, { field: error.issue === 'TIMEZONE_INVALID' ? 'timezone' : 'cron' });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  /** The next five fire times of an expression, for the editor. Nothing is stored. */
  preview(cron: string, timezone: string, now: Date = new Date()): { cron: string; timezone: string; next: string[] } {
    this.assertSchedule(cron, timezone);
    return { cron: cron.trim(), timezone, next: nextFireTimes(cron, timezone, now, PREVIEW_COUNT).map((d) => d.toISOString()) };
  }

  // ---------------------------------------------------------------------------
  // Shared with the tick
  // ---------------------------------------------------------------------------

  /** The runbook and the version `pin` resolves to, inside an organization transaction. */
  async loadContext(tx: OrgTx, orgId: string, runbookId: string, pin: string): Promise<ScheduleContext | null> {
    const runbook = await tx.runbook.findFirst({
      where: { id: runbookId, orgId },
      select: { id: true, name: true, archivedAt: true, latestVersionId: true },
    });
    if (!runbook) return null;
    const versionId = pin === 'latest' ? runbook.latestVersionId : pin;
    const row = versionId
      ? await tx.runbookVersion.findFirst({ where: { id: versionId, runbookId, orgId }, select: { id: true, version: true, definition: true } })
      : null;
    return { runbook, version: row ? { id: row.id, version: row.version, definition: row.definition as unknown as RunbookDefinition } : null };
  }

  assess(definition: RunbookDefinition): DefinitionRisk {
    return this.risk.assessDefinition(definition);
  }

  /** The run a fire creates: the schedule's stored values over the version, no dry run, no confirmation (the schedule carries it). */
  runDto(row: Pick<RunbookSchedule, 'params' | 'secretRefs' | 'targetSelector' | 'strategy'>, version: number): CreateRunDto {
    return {
      dryRun: false,
      version,
      params: row.params as CreateRunDto['params'],
      secretRefs: row.secretRefs as CreateRunDto['secretRefs'],
      targets: row.targetSelector as CreateRunDto['targets'],
      ...(row.strategy ? { strategy: row.strategy as CreateRunDto['strategy'] } : {}),
    } as CreateRunDto;
  }

  /** Whether the schedule's previous run has not finished. */
  async previousRunActive(tx: OrgTx, orgId: string, lastRunId: string | null): Promise<boolean> {
    if (!lastRunId) return false;
    const previous = await tx.runbookRun.findFirst({ where: { id: lastRunId, orgId }, select: { finishedAt: true } });
    return previous !== null && previous.finishedAt === null;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(principal: Principal, runbookId: string, query: SchedulesQueryDto) {
    await this.runbooks.requireRead(principal, runbookId);
    const scope = this.scopeOf(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const where = { orgId: scope.orgId, runbookId };
      const [total, rows] = await Promise.all([
        tx.runbookSchedule.count({ where }),
        tx.runbookSchedule.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      ]);
      return { items: await this.viewsOf(tx, scope.orgId, runbookId, rows), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(principal: Principal, runbookId: string, scheduleId: string): Promise<ScheduleView> {
    await this.runbooks.requireRead(principal, runbookId);
    const scope = this.scopeOf(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const row = await tx.runbookSchedule.findFirst({ where: { id: scheduleId, runbookId, orgId: scope.orgId } });
      if (!row) throw new NotFoundException('Schedule not found');
      return (await this.viewsOf(tx, scope.orgId, runbookId, [row]))[0]!;
    });
  }

  /** The views of `rows` (all of one runbook): the versions they resolve to are read once. */
  private async viewsOf(tx: OrgTx, orgId: string, runbookId: string, rows: RunbookSchedule[]): Promise<ScheduleView[]> {
    const runbook = await tx.runbook.findFirst({ where: { id: runbookId, orgId }, select: { latestVersionId: true } });
    const wanted = new Set<string>();
    for (const row of rows) {
      const id = row.versionPin === 'latest' ? runbook?.latestVersionId : row.versionPin;
      if (id) wanted.add(id);
    }
    const versions = await tx.runbookVersion.findMany({ where: { runbookId, orgId, id: { in: [...wanted] } }, select: { id: true, version: true, definition: true } });
    const byId = new Map(versions.map((v) => [v.id, { version: v.version, destructive: this.risk.assessDefinition(v.definition as unknown as RunbookDefinition).destructive }]));
    const lastRuns = await tx.runbookRun.findMany({
      where: { orgId, id: { in: rows.flatMap((r) => (r.lastRunId ? [r.lastRunId] : [])) } },
      select: { id: true, status: true },
    });
    const statusOf = new Map(lastRuns.map((r) => [r.id, r.status]));
    return rows.map((row) => {
      const resolved = byId.get((row.versionPin === 'latest' ? runbook?.latestVersionId : row.versionPin) ?? '') ?? null;
      const destructive = resolved?.destructive ?? false;
      return {
        id: row.id,
        runbookId: row.runbookId,
        name: row.name,
        cron: row.cron,
        timezone: row.timezone,
        versionPin: row.versionPin,
        resolvedVersion: resolved?.version ?? null,
        params: row.params,
        secretRefs: row.secretRefs,
        targets: row.targetSelector,
        strategy: row.strategy,
        overlap: row.overlap,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt,
        lastRunId: row.lastRunId,
        lastRunStatus: row.lastRunId ? (statusOf.get(row.lastRunId) ?? null) : null,
        lastFiredAt: row.lastFiredAt,
        runAsUserId: row.runAsUserId,
        disabledReason: row.disabledReason,
        destructive,
        approval: {
          state: approvalStateOf(destructive, resolved?.version ?? null, row),
          approvedBy: row.approvedBy,
          approvedAt: row.approvedAt,
          approvedVersion: row.approvedVersion,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** Validates the parameters and secret references against the version, as a run would. */
  private async checkInputs(
    orgId: string,
    definition: RunbookDefinition,
    params: CreateRunDto['params'],
    secretRefs: CreateRunDto['secretRefs'],
  ): Promise<{ params: Record<string, string | number | boolean>; secretRefs: Record<string, string> }> {
    const checked = checkRunParams(definition, params ?? {}, secretRefs ?? {});
    if (checked.issues.length > 0) {
      throw new UnprocessableEntityException({
        code: RUNBOOK_RUN_ERROR_CODES.PARAMS_INVALID,
        message: 'The schedule parameters are not valid',
        details: { issues: checked.issues },
      });
    }
    for (const [param, name] of Object.entries(checked.secretRefs)) {
      if (!(await this.credentials.describe(orgId, RUNBOOK_SECRET_PURPOSE, name))) {
        throw new UnprocessableEntityException({
          code: RUNBOOK_RUN_ERROR_CODES.SECRET_REF_UNKNOWN,
          message: `The secret for ${param} does not exist`,
          details: { parameter: param },
        });
      }
    }
    return { params: checked.values, secretRefs: checked.secretRefs };
  }

  private async requireContext(scope: OwnerScope, runbookId: string, pin: string): Promise<ScheduleContext & { version: NonNullable<ScheduleContext['version']> }> {
    const context = await runInOrg(this.prisma, scope, (tx) => this.loadContext(tx, scope.orgId, runbookId, pin));
    if (!context) throw new NotFoundException('Runbook not found');
    if (context.runbook.archivedAt) throw new HttpException({ code: 'RUNBOOK_ARCHIVED', message: 'The runbook is archived' }, 409);
    if (!context.version) throw this.invalid('The version this schedule is pinned to does not exist', { field: 'versionPin' });
    return context as ScheduleContext & { version: NonNullable<ScheduleContext['version']> };
  }

  async create(principal: Principal, runbookId: string, dto: CreateScheduleDto): Promise<ScheduleView> {
    const scope = this.scopeOf(principal);
    await this.runbooks.requireRun(principal, runbookId);
    this.assertSchedule(dto.cron, dto.timezone);
    const context = await this.requireContext(scope, runbookId, dto.versionPin);
    const checked = await this.checkInputs(scope.orgId, context.version.definition, dto.params, dto.secretRefs);
    const selector = targetSelectorSchema.parse({ ...context.version.definition.defaultTargets, ...dto.targets });
    const assessment = this.risk.assessDefinition(context.version.definition);
    const allowSelf = (await this.settings.effective(scope.orgId)).approvals.allowSelfApproval;

    const now = new Date();
    let enabled = dto.enabled;
    let disabledReason: string | null = null;
    const approval: { approvedBy: string | null; approvedAt: Date | null; approvedVersion: number | null } = { approvedBy: null, approvedAt: null, approvedVersion: null };
    if (assessment.destructive) {
      // The same confirmation a manual launch needs: the runbook's exact name and the servers it will reach.
      await this.runs.requireConfirmation(principal, context.runbook.name, assessment, dto.confirm, selector, !allowSelf);
      if (allowSelf) Object.assign(approval, { approvedBy: scope.userId, approvedAt: now, approvedVersion: context.version.version });
      else if (enabled) {
        enabled = false;
        disabledReason = SCHEDULE_DISABLED_REASONS.APPROVAL_REQUIRED;
      }
    }

    const created = await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookSchedule.create({
        data: {
          orgId: scope.orgId,
          runbookId,
          name: dto.name,
          cron: dto.cron.trim(),
          timezone: dto.timezone,
          versionPin: dto.versionPin,
          params: checked.params as Prisma.InputJsonValue,
          secretRefs: checked.secretRefs as Prisma.InputJsonValue,
          targetSelector: (dto.targets ?? {}) as Prisma.InputJsonValue,
          ...(dto.strategy ? { strategy: dto.strategy as Prisma.InputJsonValue } : {}),
          overlap: dto.overlap,
          enabled,
          nextRunAt: enabled ? nextFireAfter(dto.cron, dto.timezone, now) : null,
          runAsUserId: scope.userId,
          disabledReason,
          ...approval,
        },
      }),
    );
    await this.audit('runbook_schedule.created', scope, created.id, { runbookId, enabled, destructive: assessment.destructive });
    return this.get(principal, runbookId, created.id);
  }

  async update(principal: Principal, runbookId: string, scheduleId: string, dto: UpdateScheduleDto): Promise<ScheduleView> {
    const scope = this.scopeOf(principal);
    await this.runbooks.requireRun(principal, runbookId);
    const row = await runInOrg(this.prisma, scope, (tx) => tx.runbookSchedule.findFirst({ where: { id: scheduleId, runbookId, orgId: scope.orgId } }));
    if (!row) throw new NotFoundException('Schedule not found');

    const cron = (dto.cron ?? row.cron).trim();
    const timezone = dto.timezone ?? row.timezone;
    if (dto.cron !== undefined || dto.timezone !== undefined) this.assertSchedule(cron, timezone);
    const versionPin = dto.versionPin ?? row.versionPin;
    const context = await this.requireContext(scope, runbookId, versionPin);
    const assessment = this.risk.assessDefinition(context.version.definition);
    const rebound = row.runAsUserId !== scope.userId;
    const material = MATERIAL_FIELDS.some((field) => dto[field] !== undefined) || rebound;

    const data: Prisma.RunbookScheduleUncheckedUpdateManyInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cron !== undefined) data.cron = cron;
    if (dto.timezone !== undefined) data.timezone = timezone;
    if (dto.overlap !== undefined) data.overlap = dto.overlap;
    if (dto.versionPin !== undefined) data.versionPin = versionPin;
    if (dto.targets !== undefined) data.targetSelector = dto.targets as Prisma.InputJsonValue;
    if (dto.strategy !== undefined) data.strategy = dto.strategy === null ? Prisma.JsonNull : (dto.strategy as Prisma.InputJsonValue);
    if (dto.params !== undefined || dto.secretRefs !== undefined || dto.versionPin !== undefined) {
      const checked = await this.checkInputs(
        scope.orgId,
        context.version.definition,
        (dto.params ?? row.params) as CreateRunDto['params'],
        (dto.secretRefs ?? row.secretRefs) as CreateRunDto['secretRefs'],
      );
      data.params = checked.params as Prisma.InputJsonValue;
      data.secretRefs = checked.secretRefs as Prisma.InputJsonValue;
    }
    if (rebound && material) data.runAsUserId = scope.userId;

    // Approval. A material change to a destructive schedule is a new thing to approve.
    const allowSelf = (await this.settings.effective(scope.orgId)).approvals.allowSelfApproval;
    const now = new Date();
    let approved = approvalStateOf(assessment.destructive, context.version.version, row) === 'approved';
    let enabled = dto.enabled ?? row.enabled;
    if (assessment.destructive && material) {
      const selector = targetSelectorSchema.parse({
        ...context.version.definition.defaultTargets,
        ...((dto.targets ?? row.targetSelector) as object),
      });
      await this.runs.requireConfirmation(principal, context.runbook.name, assessment, dto.confirm, selector, !allowSelf);
      if (allowSelf) {
        Object.assign(data, { approvedBy: scope.userId, approvedAt: now, approvedVersion: context.version.version });
        approved = true;
      } else {
        Object.assign(data, { approvedBy: null, approvedAt: null, approvedVersion: null });
        approved = false;
        if (enabled) {
          enabled = false;
          data.disabledReason = SCHEDULE_DISABLED_REASONS.APPROVAL_REQUIRED;
        }
      }
    }
    if (assessment.destructive && dto.enabled === true && !approved) {
      throw new HttpException(
        { code: RUNBOOK_SCHEDULE_ERROR_CODES.APPROVAL_REQUIRED, message: 'A destructive schedule must be approved by a second person before it can be enabled' },
        409,
      );
    }

    if (dto.enabled === false) {
      enabled = false;
      data.disabledReason = null;
    } else if (dto.enabled === true && enabled) {
      data.disabledReason = null;
    }
    data.enabled = enabled;
    // The next slot: recomputed whenever the schedule is (or becomes) enabled and its timing or state changed.
    if (!enabled) data.nextRunAt = null;
    else if (dto.cron !== undefined || dto.timezone !== undefined || !row.enabled || row.nextRunAt === null) data.nextRunAt = nextFireAfter(cron, timezone, now);

    await runInOrg(this.prisma, scope, async (tx) => {
      const updated = await tx.runbookSchedule.updateMany({ where: { id: scheduleId, orgId: scope.orgId }, data });
      if (updated.count !== 1) throw new NotFoundException('Schedule not found');
    });
    await this.audit('runbook_schedule.updated', scope, scheduleId, {
      runbookId,
      fields: Object.keys(dto).filter((key) => key !== 'confirm').join(','),
      reapproval: assessment.destructive && material,
    });
    return this.get(principal, runbookId, scheduleId);
  }

  async remove(principal: Principal, runbookId: string, scheduleId: string): Promise<void> {
    const scope = this.scopeOf(principal);
    await this.runbooks.requireRun(principal, runbookId);
    await runInOrg(this.prisma, scope, async (tx) => {
      const row = await tx.runbookSchedule.findFirst({ where: { id: scheduleId, runbookId, orgId: scope.orgId }, select: { id: true } });
      if (!row) throw new NotFoundException('Schedule not found');
      // The key from a run is composite (schedule, org): the database cannot null just one column, so it is done here.
      await tx.runbookRun.updateMany({ where: { scheduleId, orgId: scope.orgId }, data: { scheduleId: null } });
      await tx.runbookSchedule.deleteMany({ where: { id: scheduleId, orgId: scope.orgId } });
    });
    await this.audit('runbook_schedule.deleted', scope, scheduleId, { runbookId });
  }

  /** A second person approves a destructive schedule for the version it would run now. */
  async approve(principal: Principal, runbookId: string, scheduleId: string, _dto: ApproveScheduleDto): Promise<ScheduleView> {
    const scope = this.scopeOf(principal);
    await this.runbooks.requireRead(principal, runbookId);
    const row = await runInOrg(this.prisma, scope, (tx) => tx.runbookSchedule.findFirst({ where: { id: scheduleId, runbookId, orgId: scope.orgId } }));
    if (!row) throw new NotFoundException('Schedule not found');
    const context = await this.requireContext(scope, runbookId, row.versionPin);
    const assessment = this.risk.assessDefinition(context.version.definition);
    if (!assessment.destructive) return this.get(principal, runbookId, scheduleId);

    const allowSelf = (await this.settings.effective(scope.orgId)).approvals.allowSelfApproval;
    if (row.runAsUserId === scope.userId && !allowSelf) {
      throw new ForbiddenException({
        code: RUNBOOK_SCHEDULE_ERROR_CODES.SELF_APPROVAL,
        message: 'The person a schedule runs as cannot approve it',
      });
    }
    const now = new Date();
    const reenable = row.disabledReason === SCHEDULE_DISABLED_REASONS.APPROVAL_REQUIRED;
    await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookSchedule.updateMany({
        where: { id: scheduleId, orgId: scope.orgId },
        data: {
          approvedBy: scope.userId,
          approvedAt: now,
          approvedVersion: context.version.version,
          ...(reenable ? { enabled: true, disabledReason: null, nextRunAt: nextFireAfter(row.cron, row.timezone, now) } : {}),
        },
      }),
    );
    this.metrics.destructiveRun('approved');
    await this.audit('runbook_schedule.approved', scope, scheduleId, { runbookId, version: context.version.version, enabled: reenable || row.enabled });
    return this.get(principal, runbookId, scheduleId);
  }

  /** Fires the schedule now, as the caller, without moving its next slot. Honours `overlap: skip` and the approval. */
  async runNow(principal: Principal, runbookId: string, scheduleId: string): Promise<LaunchResult> {
    const scope = this.scopeOf(principal);
    await this.runbooks.requireRun(principal, runbookId);
    const found = await runInOrg(this.prisma, scope, async (tx) => {
      const row = await tx.runbookSchedule.findFirst({ where: { id: scheduleId, runbookId, orgId: scope.orgId } });
      if (!row) return null;
      return { row, active: row.overlap === 'skip' && (await this.previousRunActive(tx, scope.orgId, row.lastRunId)) };
    });
    if (!found) throw new NotFoundException('Schedule not found');
    const { row } = found;
    const context = await this.requireContext(scope, runbookId, row.versionPin);
    const assessment = this.risk.assessDefinition(context.version.definition);
    if (assessment.destructive && approvalStateOf(true, context.version.version, row) !== 'approved') {
      throw new HttpException(
        { code: RUNBOOK_SCHEDULE_ERROR_CODES.APPROVAL_REQUIRED, message: 'A destructive schedule must be approved before it can run' },
        409,
      );
    }
    if (found.active) {
      throw new HttpException({ code: RUNBOOK_SCHEDULE_ERROR_CODES.OVERLAP, message: 'The previous run of this schedule is still active' }, 409);
    }
    const launched = await this.runs.create(principal, runbookId, this.runDto(row, context.version.version), 'schedule', {
      scheduleId,
      preApproved: assessment.destructive,
    });
    await runInOrg(this.prisma, scope, (tx) =>
      tx.runbookSchedule.updateMany({ where: { id: scheduleId, orgId: scope.orgId }, data: { lastRunId: launched.runId, lastFiredAt: new Date() } }),
    );
    await this.audit('runbook_schedule.run_now', scope, scheduleId, { runbookId, runId: launched.runId });
    return launched;
  }

  private async audit(action: string, scope: OwnerScope, scheduleId: string, meta: Record<string, unknown>): Promise<void> {
    await recordAudit(this.auditSink, this.logger, {
      action,
      actorUserId: scope.userId,
      targetType: 'runbook_schedule',
      targetId: scheduleId,
      meta: meta as never,
    });
  }
}

export type { OverlapPolicy };
