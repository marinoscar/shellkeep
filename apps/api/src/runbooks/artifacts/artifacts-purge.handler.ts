// =============================================================================
// `runbook.artifacts.purge` (issue #63): the retention of runbook logs and artifacts
// =============================================================================
//
// The purge of the `retention.runbookArtifacts` policy (default 30 days, ON; an operator may switch it
// off or change the window in Settings). It is a SYSTEM job (`orgId: null`): it looks across organizations
// through the bypass client under the registered access reason `runbooks-artifacts-purge`, because a
// deployment's retention window is one number.
//
// WHAT IT DELETES, per run that FINISHED before the cutoff:
//   - the storage objects of the run's `runbook_artifacts` rows (archives and the bundle),
//   - those rows,
//   - the storage objects of the run's step logs (`log_storage_key`) and the key on the step.
// THE RUN ROWS STAY (the history of what ran, with its exit codes and output tails).
//
// ORDER. Objects first, rows after: a failed object delete leaves its run's rows in place so the next
// pass tries again; a run whose objects could not all be deleted is skipped for the rest of this job and
// is not counted. A run is only selected while it still has an artifact row or a step log key, so a purged
// run is never selected again. A disabled policy is a logged no-op (`runRetentionPolicyPurge`).
// Bounded batches through `purgeInBatches`; idempotent, so the queue's at-least-once delivery is safe.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, runRetentionPolicyPurge, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_PROVIDER, type StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { RUNBOOKS_ARTIFACTS_PURGE_REASON, RUNBOOK_ARTIFACTS_PURGE_TYPE, RUNBOOK_ARTIFACTS_RETENTION_KEY } from '../engine/engine.constants';

@Injectable()
export class ArtifactsPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_ARTIFACTS_PURGE_TYPE;
  readonly label = 'Purge runbook logs and artifacts';
  readonly profile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(ArtifactsPurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly system: PrismaSystemService,
    private readonly settings: SystemSettingsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const policy = (await this.settings.getRetentionPolicy())[RUNBOOK_ARTIFACTS_RETENTION_KEY];
    if (!policy) return;
    const skipped = new Set<string>();
    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: `retention.${RUNBOOK_ARTIFACTS_RETENTION_KEY}`,
      what: 'runbook artifacts purge',
      rows: 'run(s) of artifacts and step logs',
      selectIds: (cutoff, take) => this.selectRuns(cutoff, take, skipped),
      deleteIds: (ids) => this.purgeRuns(ids, skipped),
    });
  }

  /** Runs that finished before `cutoff` and still hold an artifact row or a stored step log. */
  async selectRuns(cutoff: Date, take: number, skipped: ReadonlySet<string> = new Set()): Promise<string[]> {
    return this.system.runAsSystem(RUNBOOKS_ARTIFACTS_PURGE_REASON, async (tx) => {
      const rows = await tx.runbookRun.findMany({
        where: {
          finishedAt: { lt: cutoff },
          ...(skipped.size > 0 ? { id: { notIn: [...skipped] } } : {}),
          OR: [{ artifacts: { some: {} } }, { steps: { some: { logStorageKey: { not: null } } } }],
        },
        select: { id: true },
        orderBy: { finishedAt: 'asc' },
        take,
      });
      return rows.map((row) => row.id);
    });
  }

  /** Deletes the objects and rows of these runs; returns how many runs were fully purged. */
  async purgeRuns(runIds: string[], skipped: Set<string> = new Set()): Promise<number> {
    const found = await this.system.runAsSystem(RUNBOOKS_ARTIFACTS_PURGE_REASON, async (tx) => ({
      artifacts: await tx.runbookArtifact.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, storageKey: true } }),
      steps: await tx.runbookRunStep.findMany({ where: { runId: { in: runIds }, logStorageKey: { not: null } }, select: { id: true, runId: true, logStorageKey: true } }),
    }));

    const failed = new Set<string>();
    const remove = async (runId: string, key: string): Promise<boolean> => {
      try {
        await this.storage.delete(key);
        return true;
      } catch (error) {
        failed.add(runId);
        this.logger.warn(`a runbook object was not deleted (its run is retried next pass): ${error instanceof Error ? error.name : 'error'}`);
        return false;
      }
    };
    const artifactDone: string[] = [];
    for (const artifact of found.artifacts) if (await remove(artifact.runId, artifact.storageKey)) artifactDone.push(artifact.id);
    const stepDone: string[] = [];
    for (const step of found.steps) if (await remove(step.runId, step.logStorageKey!)) stepDone.push(step.id);

    await this.system.runAsSystem(RUNBOOKS_ARTIFACTS_PURGE_REASON, async (tx) => {
      await tx.runbookArtifact.deleteMany({ where: { id: { in: artifactDone } } });
      await tx.runbookRunStep.updateMany({ where: { id: { in: stepDone } }, data: { logStorageKey: null } });
    });
    for (const runId of failed) skipped.add(runId);
    return runIds.filter((id) => !failed.has(id)).length;
  }
}
