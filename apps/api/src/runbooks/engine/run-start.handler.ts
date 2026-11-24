// =============================================================================
// `runbook.run.start` (issue #62)
// =============================================================================
//
// Turns a queued run into targets. As the INITIATOR (their access, not the platform's) it resolves the
// run's selector, SNAPSHOTS each server (name, host, port, user, trusted fingerprint: the history survives
// a profile being edited), inserts the targets with their wave and one `pending` step row per step, moves
// the run to `running` and calls `advance`: all in one transaction.
//
// IDEMPOTENT: a re-run (a retry after a crash) that finds targets already present only advances. A
// server the initiator may not connect to becomes a `skipped` target (`FORBIDDEN`), visible in the matrix.
// =============================================================================

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';
import type { RunStrategy, TargetSelector, RunbookDefinition } from '../schema/runbook-definition.schema';
import { batchIndexOf } from './batching';
import { EngineAccessService } from './engine-access.service';
import { FAILURE_CODES, RUNBOOK_RUN_START_TYPE } from './engine.constants';
import { RunCoordinatorService, mergeOutcomes, type AdvanceOutcome, type OrgTx } from './run-coordinator.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { RunbookSettingsService } from './runbook-settings.service';
import { assertTransition, type RunStatus } from './state-machine';

const PAYLOAD = z.object({ runId: z.string().uuid() });

@Injectable()
export class RunStartHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_RUN_START_TYPE;
  readonly label = 'Start a runbook run';
  readonly profile = { maxRuntimeMs: 120_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(RunStartHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly jobScope: JobScope,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
    private readonly access: EngineAccessService,
    private readonly settings: RunbookSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const { runId } = PAYLOAD.parse(job.payload);
    const orgId = job.orgId;
    if (!orgId) throw new Error('runbook.run.start needs an organization');

    const run = await runInOrg(this.prisma, { orgId }, (tx) =>
      tx.runbookRun.findUnique({ where: { id: runId }, include: { runbookVersion: true, _count: { select: { targets: true } } } }),
    );
    if (!run) return;

    const resolution =
      run._count.targets > 0 || ['cancelling', 'cancelled', 'running'].includes(run.status)
        ? null
        : await this.resolve(orgId, run.initiatedBy, run.targetSelector as unknown as Partial<TargetSelector>);

    const outcome = await this.jobScope.run<Awaited<ReturnType<RunCoordinatorService['advance']>>, OrgTx>(job, async (tx) => {
      const now = new Date();
      const extra = resolution ? await this.insertTargets(tx, orgId, runId, run, resolution, now) : null;
      const advanced = await this.coordinator.advance(tx, runId, now);
      return extra ? mergeOutcomes(runId, extra, advanced) : advanced;
    });
    await this.lifecycle.afterCommit(outcome);
  }

  /** Servers the initiator may use, with the connection facts to snapshot; `failure` when nothing can run. */
  private async resolve(orgId: string, initiatedBy: string | null, selector: Partial<TargetSelector>) {
    const initiator = initiatedBy ? await this.access.load(initiatedBy, orgId) : null;
    if (!initiator || !this.access.canRun(initiator)) return { failure: FAILURE_CODES.PERMISSION_REVOKED, runnable: [], skipped: [] } as const;
    const limit = (await this.settings.effective(orgId)).maxTargetsPerRun;
    const resolved = await this.access.resolveTargets(initiator, selector, limit);
    const rows = await this.prisma.serverProfile.findMany({
      where: { orgId, id: { in: resolved.targets.map((t) => t.id) } },
      select: { id: true, name: true, hostname: true, port: true, username: true, fingerprint: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const runnable = resolved.targets.flatMap((t) => (byId.has(t.id) ? [byId.get(t.id)!] : []));
    return { failure: null, runnable, skipped: resolved.skipped } as const;
  }

  private async insertTargets(
    tx: OrgTx,
    orgId: string,
    runId: string,
    run: { status: string; strategy: unknown; runbookVersion: { definition: unknown } },
    resolution: Awaited<ReturnType<RunStartHandler['resolve']>>,
    now: Date,
  ): Promise<AdvanceOutcome | null> {
    const strategy = run.strategy as unknown as RunStrategy;
    const definition = run.runbookVersion.definition as unknown as RunbookDefinition;
    const from = run.status as RunStatus;

    if (resolution.failure || resolution.runnable.length === 0) {
      assertTransition('run', from, 'failed');
      await tx.runbookRun.update({ where: { id: runId }, data: { status: 'failed', startedAt: now, finishedAt: now } });
      return {
        runId,
        events: [{ type: 'run', runId, status: 'failed', finishedAt: now.toISOString() }],
        cancelRequests: [],
        finished: null,
        approvals: [],
        dispatched: 0,
      };
    }
    if (from === 'queued') assertTransition('run', 'queued', 'resolving');

    const targetData = [
      ...resolution.runnable.map((s, position) => ({
        orgId,
        runId,
        serverProfileId: s.id,
        position,
        batchIndex: batchIndexOf(position, strategy),
        status: 'pending',
        serverName: s.name,
        hostname: s.hostname,
        port: s.port,
        username: s.username,
        hostKeyFingerprint: s.fingerprint,
      })),
      ...resolution.skipped.map((s, i) => ({
        orgId,
        runId,
        serverProfileId: s.serverProfileId,
        position: resolution.runnable.length + i,
        batchIndex: 0,
        status: 'skipped',
        serverName: '(not accessible)',
        hostname: '',
        port: 0,
        username: '',
        hostKeyFingerprint: null,
        errorCode: FAILURE_CODES.FORBIDDEN,
        finishedAt: now,
      })),
    ];
    await tx.runbookRunTarget.createMany({ data: targetData, skipDuplicates: true });
    const created = await tx.runbookRunTarget.findMany({ where: { runId }, select: { id: true, status: true } });
    await tx.runbookRunStep.createMany({
      data: created.flatMap((t) =>
        definition.steps.map((step, stepIndex) => ({
          orgId,
          runId,
          runTargetId: t.id,
          stepIndex,
          stepId: step.id,
          kind: step.kind,
          name: step.name,
          status: t.status === 'skipped' ? 'skipped' : 'pending',
        })),
      ),
      skipDuplicates: true,
    });
    assertTransition('run', from === 'queued' ? 'resolving' : from, 'running');
    await tx.runbookRun.update({ where: { id: runId }, data: { status: 'running', startedAt: now } });
    this.logger.log(`run started: ${resolution.runnable.length} targets, ${resolution.skipped.length} skipped`);
    return null;
  }
}
