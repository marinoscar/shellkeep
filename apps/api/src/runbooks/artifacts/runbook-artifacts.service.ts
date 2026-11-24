// =============================================================================
// Runbook artifacts: list, signed download, build a bundle (issue #63)
// =============================================================================
//
// Reads and the on-demand bundle job. Everything is scoped to the caller's organization (`runInOrg`) and
// to a run the caller may see (`RunbookRunsService.requireVisible`: the person who started it, or anyone
// who may read its runbook): a run that is not visible is a 404, never a 403.
//
// DOWNLOADS ARE SIGNED. The API never streams an artifact: it answers `{ url, expiresAt }`, a presigned
// URL of the storage provider valid for 15 minutes. Each authenticated download is audited
// (`runbook_artifact.downloaded`, ids only).
//
// BUNDLE STATE of a run: `ready` (the `bundle` row exists), `building` (a `runbook.artifacts.bundle` job is
// pending or running), `none`. Asking for a bundle of a run that has one answers the existing artifact id;
// a run that has not finished answers 409 RUNBOOK_RUN_STATE; the job is deduplicated per run.
// =============================================================================

import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER, type StorageProvider } from '@marinoscar/platform-api/storage';

import { recordAudit } from '../../common/audit/record-audit';
import { PrismaService } from '../../prisma/prisma.service';
import { RUNBOOK_JOB_REASON, RUNBOOK_ARTIFACTS_BUNDLE_TYPE, RUNBOOK_ARTIFACTS_SUBJECT } from '../engine/engine.constants';
import { RUNBOOK_RUN_ERROR_CODES } from '../engine/engine.error-codes';
import { RunbookRunsService } from '../engine/runbook-runs.service';
import { safeSegment } from './bundle-builder';

/** How long a presigned download URL works. */
export const DOWNLOAD_URL_TTL_SEC = 15 * 60;

const FINAL_STATUSES = ['succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'] as const;

export interface ArtifactView {
  id: string;
  kind: 'target_archive' | 'bundle';
  runTargetId: string | null;
  runStepId: string | null;
  /** The server's name as the run snapshotted it (a target archive). */
  serverName: string | null;
  /** The definition's step id and index (a target archive). */
  stepId: string | null;
  stepIndex: number | null;
  fileCount: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ArtifactList {
  items: ArtifactView[];
  bundle: { status: 'ready' | 'building' | 'none'; artifactId: string | null; sizeBytes: number | null; createdAt: string | null };
}

export interface SignedDownload {
  url: string;
  expiresAt: string;
}

@Injectable()
export class RunbookArtifactsService {
  private readonly logger = new Logger(RunbookArtifactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunbookRunsService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  private orgOf(principal: Principal): string {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return principal.activeOrgId;
  }

  async list(principal: Principal, runId: string): Promise<ArtifactList> {
    await this.runs.requireVisible(principal, runId);
    const orgId = this.orgOf(principal);
    const { rows, building } = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const found = await tx.runbookArtifact.findMany({
        where: { runId },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        include: { target: { select: { serverName: true, position: true } }, step: { select: { stepId: true, stepIndex: true } } },
      });
      const job = await tx.job.findFirst({
        where: { type: RUNBOOK_ARTIFACTS_BUNDLE_TYPE, subjectType: RUNBOOK_ARTIFACTS_SUBJECT, subjectId: runId, status: { in: ['pending', 'running'] } },
        select: { id: true },
      });
      return { rows: found, building: job !== null };
    });
    const bundle = rows.find((row) => row.kind === 'bundle') ?? null;
    return {
      items: rows
        .filter((row) => row.kind === 'target_archive')
        .sort((a, b) => (a.target?.position ?? 0) - (b.target?.position ?? 0) || (a.step?.stepIndex ?? 0) - (b.step?.stepIndex ?? 0))
        .map((row) => this.view(row)),
      bundle: bundle
        ? { status: 'ready', artifactId: bundle.id, sizeBytes: Number(bundle.sizeBytes), createdAt: bundle.createdAt.toISOString() }
        : { status: building ? 'building' : 'none', artifactId: null, sizeBytes: null, createdAt: null },
    };
  }

  private view(row: {
    id: string;
    kind: string;
    runTargetId: string | null;
    runStepId: string | null;
    fileCount: number;
    sizeBytes: bigint;
    sha256: string;
    createdAt: Date;
    target?: { serverName: string } | null;
    step?: { stepId: string; stepIndex: number } | null;
  }): ArtifactView {
    return {
      id: row.id,
      kind: row.kind as ArtifactView['kind'],
      runTargetId: row.runTargetId,
      runStepId: row.runStepId,
      serverName: row.target?.serverName ?? null,
      stepId: row.step?.stepId ?? null,
      stepIndex: row.step?.stepIndex ?? null,
      fileCount: row.fileCount,
      sizeBytes: Number(row.sizeBytes),
      sha256: row.sha256,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** A presigned download of one artifact, valid {@link DOWNLOAD_URL_TTL_SEC} seconds. Audited. */
  async download(principal: Principal, runId: string, artifactId: string): Promise<SignedDownload> {
    await this.runs.requireVisible(principal, runId);
    const orgId = this.orgOf(principal);
    const artifact = await runInOrg(this.prisma, { orgId }, (tx) =>
      tx.runbookArtifact.findFirst({
        where: { id: artifactId, runId },
        include: { target: { select: { serverName: true } }, step: { select: { stepIndex: true } }, run: { select: { runbook: { select: { name: true } } } } },
      }),
    );
    if (!artifact) throw new NotFoundException('Artifact not found');
    const filename =
      artifact.kind === 'bundle'
        ? `${safeSegment(artifact.run.runbook.name, 48)}-${runId.slice(0, 8)}-logs.zip`
        : `${safeSegment(artifact.target?.serverName ?? 'server', 48)}-step${artifact.step?.stepIndex ?? 0}.tar.gz`;
    const url = await this.storage.getSignedDownloadUrl(artifact.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL_SEC,
      responseContentDisposition: `attachment; filename="${filename}"`,
    });
    await recordAudit(this.audit, this.logger, {
      action: 'runbook_artifact.downloaded',
      actorUserId: principal.userId,
      targetType: 'runbook_artifact',
      targetId: artifact.id,
      meta: { runId, kind: artifact.kind },
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SEC * 1000).toISOString() };
  }

  /**
   * The post-commit hook of a finished run (`RunbookRunFinished`): queues the bundle when the run stored at
   * least one log archive. Never throws: a missing bundle is built on demand, and the retention sweeps clean up.
   */
  async bundleIfCollected(orgId: string, runId: string): Promise<void> {
    try {
      const archives = await runInOrg(this.prisma, { orgId }, (tx) => tx.runbookArtifact.count({ where: { runId, kind: 'target_archive' } }));
      if (archives > 0) await enqueueBundle(this.jobs, orgId, runId);
    } catch (error) {
      this.logger.warn(`bundle not queued: ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  /** Queues the bundle of a finished run (deduplicated). An existing bundle is answered, not rebuilt. */
  async requestBundle(principal: Principal, runId: string): Promise<{ jobId: string | null; artifactId: string | null }> {
    await this.runs.requireVisible(principal, runId);
    const orgId = this.orgOf(principal);
    const state = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const run = await tx.runbookRun.findFirst({ where: { id: runId }, select: { status: true, dryRun: true } });
      const bundle = await tx.runbookArtifact.findFirst({ where: { runId, kind: 'bundle' }, select: { id: true } });
      return { run, bundle };
    });
    if (!state.run) throw new NotFoundException('Run not found');
    if (state.bundle) return { jobId: null, artifactId: state.bundle.id };
    if (!(FINAL_STATUSES as readonly string[]).includes(state.run.status) || state.run.dryRun) {
      throw new ConflictException({ code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE, message: 'The run has not finished (or is a dry run): there is nothing to bundle yet' });
    }
    const job = await enqueueBundle(this.jobs, orgId, runId);
    return { jobId: job.id, artifactId: null };
  }
}

/** Queues `runbook.artifacts.bundle` for a run: deduplicated by subject (one in flight per run). */
export function enqueueBundle(jobs: JobsService, orgId: string, runId: string) {
  return jobs.enqueue({
    type: RUNBOOK_ARTIFACTS_BUNDLE_TYPE,
    reason: RUNBOOK_JOB_REASON,
    orgId,
    subjectType: RUNBOOK_ARTIFACTS_SUBJECT,
    subjectId: runId,
    payload: { runId, orgId },
  });
}
