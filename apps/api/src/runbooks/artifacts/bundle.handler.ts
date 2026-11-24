// =============================================================================
// `runbook.artifacts.bundle` (issue #63): the zip bundle of a run
// =============================================================================
//
// Payload `{ runId, orgId }`; one job per run (deduplicated by subject `runbook_artifacts` / run id). It
// gathers what a finished run left and streams it into ONE zip with `archiver`, never buffering a file:
//
//   <serverName>__<targetId>/<stepId>.tar.gz     each `target_archive` (already redacted when it was stored)
//   logs/<serverName>__<targetId>/<stepIndex>.log   each step log (already redacted by the `LogSink`)
//   manifest.json                                the run, its targets and steps, and every file's sha256
//
// The zip goes to a platform temp file (`jobTempPath`), is uploaded to
// `runbook-artifacts/<orgId>/<runId>/bundle.zip` and recorded as the run's `bundle` row (at most one per
// run: a partial unique index). The job is IDEMPOTENT: a run that already has a bundle is a no-op, and a
// concurrent insert that loses the race is success (the key is the same).
//
// NODE-ELIGIBLE by declaration (`nodeResultSchema` + `persistNodeResult`, no `nodeSecretBroker`: storage is
// reached through `NODE_OBJECT_STORE`, the node holds no credential). `persistNodeResult` only records the
// row for the object the node uploaded to the key `deriveOutputKey` named. The CLI ships no executor for
// the type yet, so no node declares it and the server builds every bundle (`process`).
// =============================================================================

import { unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, jobTempPath, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER, buildObjectKey, type StorageProvider } from '@marinoscar/platform-api/storage';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';
import { EngineMetricsService } from '../engine/engine-metrics.service';
import { RUNBOOK_ARTIFACTS_BUNDLE_TYPE } from '../engine/engine.constants';
import { LogArchiveService } from '../engine/log-archive.service';
import { RUNBOOK_ARTIFACTS_PREFIX } from '../engine/steps/collect-logs.step';
import { buildBundleZip, safeSegment, type BundleInput } from './bundle-builder';

export const BUNDLE_PAYLOAD = z.object({ runId: z.string().uuid(), orgId: z.string().uuid() });

/** What a node would report after uploading the zip to {@link bundleKey}. */
export const BUNDLE_NODE_RESULT = z.object({
  objectKey: z.string(),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fileCount: z.number().int().min(0),
});
export type BundleNodeResult = z.infer<typeof BUNDLE_NODE_RESULT>;

export const bundleKey = (orgId: string, runId: string): string => buildObjectKey(RUNBOOK_ARTIFACTS_PREFIX, { orgId }, runId, 'bundle.zip');

const FINAL = ['succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'];

const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === 'P2002' || /runbook_artifacts_bundle_uniq_idx/.test(String((error as Error | null)?.message ?? ''));

@Injectable()
export class BundleHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_ARTIFACTS_BUNDLE_TYPE;
  readonly label = 'Bundle the logs of a runbook run';
  readonly profile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 } as const;
  readonly nodeResultSchema = BUNDLE_NODE_RESULT;

  private readonly logger = new Logger(BundleHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly archive: LogArchiveService,
    private readonly metrics: EngineMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** The node's upload key: derived from the job's own payload, so every call names the same object. */
  async deriveOutputKey(job: Job): Promise<string> {
    const { runId, orgId } = BUNDLE_PAYLOAD.parse(job.payload);
    return bundleKey(orgId, runId);
  }

  /** Records the row for an object a node uploaded. The key must be the one `deriveOutputKey` names. */
  async persistNodeResult(job: Job, result: unknown): Promise<void> {
    const { runId, orgId } = BUNDLE_PAYLOAD.parse(job.payload);
    const parsed = BUNDLE_NODE_RESULT.parse(result);
    if (parsed.objectKey !== bundleKey(orgId, runId)) throw new Error('The uploaded bundle is not at the key the server named');
    await this.insertBundle(orgId, runId, parsed.objectKey, parsed.fileCount, parsed.sizeBytes, parsed.sha256);
    this.metrics.bundleBuild('built');
    this.metrics.artifactBytes('bundle', parsed.sizeBytes);
  }

  async process(job: Job): Promise<void> {
    const { runId, orgId } = BUNDLE_PAYLOAD.parse(job.payload);
    if (job.orgId && job.orgId !== orgId) throw new Error('The job organization does not match its payload');
    let outcome: 'built' | 'empty' | 'failed' = 'failed';
    try {
      outcome = await this.build(orgId, runId);
    } finally {
      this.metrics.bundleBuild(outcome);
    }
  }

  private async build(orgId: string, runId: string): Promise<'built' | 'empty'> {
    const data = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const run = await tx.runbookRun.findFirst({
        where: { id: runId },
        include: {
          runbook: { select: { name: true } },
          targets: { orderBy: { position: 'asc' } },
          steps: { orderBy: [{ runTargetId: 'asc' }, { stepIndex: 'asc' }] },
          artifacts: { where: { kind: { in: ['target_archive', 'bundle'] } } },
        },
      });
      return run;
    });
    if (!data) return 'empty'; // the run is gone: nothing to bundle
    if (data.artifacts.some((a) => a.kind === 'bundle')) return 'built'; // idempotent
    if (!FINAL.includes(data.status) || data.dryRun) {
      this.logger.warn('bundle skipped: the run has not finished (or is a dry run)');
      return 'empty';
    }

    const dirOf = new Map(data.targets.map((t) => [t.id, `${safeSegment(t.serverName)}__${t.id}`]));
    const inputs: BundleInput[] = [];
    for (const artifact of data.artifacts.filter((a) => a.kind === 'target_archive')) {
      const dir = artifact.runTargetId ? dirOf.get(artifact.runTargetId) : undefined;
      const step = data.steps.find((s) => s.id === artifact.runStepId);
      if (!dir || !step) continue;
      inputs.push({ path: `${dir}/${safeSegment(step.stepId)}.tar.gz`, store: true, open: () => this.storage.download(artifact.storageKey) });
    }
    for (const step of data.steps) {
      const dir = dirOf.get(step.runTargetId);
      if (!dir || (step.logBytes === 0 && !step.logStorageKey)) continue;
      inputs.push({
        path: `logs/${dir}/${step.stepIndex}.log`,
        open: async () => {
          const text = await this.archive.readStepLog(orgId, step.id);
          return Readable.from([Buffer.from(text ?? '', 'utf8')]);
        },
      });
    }

    const out = jobTempPath('.zip');
    try {
      const zip = await buildBundleZip(
        inputs,
        (entries) => ({
          manifestVersion: 1,
          generatedAt: new Date().toISOString(),
          run: {
            id: data.id,
            runbook: data.runbook.name,
            version: data.version,
            status: data.status,
            startedAt: data.startedAt?.toISOString() ?? null,
            finishedAt: data.finishedAt?.toISOString() ?? null,
            initiatedBy: data.initiatedBy,
          },
          targets: data.targets.map((t) => ({
            id: t.id,
            server: { name: t.serverName, hostname: t.hostname },
            status: t.status,
            steps: data.steps
              .filter((s) => s.runTargetId === t.id)
              .map((s) => ({ index: s.stepIndex, id: s.stepId, kind: s.kind, status: s.status, exitCode: s.exitCode, durationMs: s.durationMs })),
          })),
          files: entries.map((e) => ({ path: e.path, sha256: e.sha256, bytes: e.bytes })),
        }),
        out,
      );
      const key = bundleKey(orgId, runId);
      await this.storage.upload(key, createReadStream(out), { mimeType: 'application/zip', contentLength: zip.sizeBytes });
      await this.insertBundle(orgId, runId, key, zip.entries.length, zip.sizeBytes, zip.sha256);
      this.metrics.artifactBytes('bundle', zip.sizeBytes);
      return zip.entries.length === 0 ? 'empty' : 'built';
    } finally {
      await unlink(out).catch(() => undefined);
    }
  }

  private async insertBundle(orgId: string, runId: string, key: string, fileCount: number, sizeBytes: number, sha256: string): Promise<void> {
    try {
      await runInOrg(this.prisma, { orgId }, (tx) =>
        tx.runbookArtifact.create({
          data: { orgId, runId, kind: 'bundle', storageKey: key, fileCount, sizeBytes: BigInt(sizeBytes), sha256 },
        }),
      );
    } catch (error) {
      // A concurrent build (or a node and the server) recorded it first: the object key is the same.
      if (!isUniqueViolation(error)) throw error;
    }
  }
}
