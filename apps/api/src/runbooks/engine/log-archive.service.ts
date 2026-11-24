// =============================================================================
// Step logs: chunks to storage and back (issue #62)
// =============================================================================
//
// While a step runs its output lives in `runbook_run_log_chunks` (already redacted). When the step ends
// `archiveStep` joins the chunks in `seq` order, uploads them to
// `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.log` (the prefix #50 registered, organization
// scoped) and, only after the upload succeeded, records the key on the step and deletes the chunks. A
// storage fault leaves the chunks where they are: nothing is lost, and the reconcile job moves them
// later (`runbook.logs.compact`, orphans older than an hour).
//
// `readStepLog` answers the log route: from storage once moved, else from the chunks; `tail` keeps the
// last N lines.
// =============================================================================

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { STORAGE_PROVIDER, buildObjectKey, type StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../prisma/prisma.service';

export const RUNBOOK_ARTIFACTS_PREFIX_ID = 'runbook-artifacts';

export const stepLogKey = (orgId: string, runId: string, targetId: string, stepIndex: number): string =>
  buildObjectKey(RUNBOOK_ARTIFACTS_PREFIX_ID, { orgId }, runId, targetId, `${stepIndex}.log`);

/** The last `lines` lines of `text` (all of it when `lines` is not positive). */
export function tailLines(text: string, lines: number): string {
  if (!(lines > 0)) return text;
  const parts = text.split('\n');
  const hadTrailingNewline = parts[parts.length - 1] === '';
  const body = hadTrailingNewline ? parts.slice(0, -1) : parts;
  return body.slice(-lines).join('\n') + (hadTrailingNewline && body.length > 0 ? '\n' : '');
}

@Injectable()
export class LogArchiveService {
  private readonly logger = new Logger(LogArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Moves one step's chunks to storage. Returns the key, or `null` when there was nothing to move or storage failed. */
  async archiveStep(orgId: string, stepRowId: string): Promise<string | null> {
    try {
      const loaded = await runInOrg(this.prisma, { orgId }, async (tx) => {
        const step = await tx.runbookRunStep.findFirst({
          where: { id: stepRowId },
          select: { id: true, runId: true, runTargetId: true, stepIndex: true, logStorageKey: true },
        });
        if (!step) return null;
        const chunks = await tx.runbookRunLogChunk.findMany({
          where: { runStepId: stepRowId },
          orderBy: { seq: 'asc' },
          select: { seq: true, data: true },
        });
        return { step, chunks };
      });
      if (!loaded || loaded.chunks.length === 0) return loaded?.step.logStorageKey ?? null;

      const { step, chunks } = loaded;
      const key = stepLogKey(orgId, step.runId, step.runTargetId, step.stepIndex);
      const body = Buffer.from(chunks.map((c) => c.data).join(''), 'utf8');
      await this.storage.upload(key, Readable.from([body]), { mimeType: 'text/plain; charset=utf-8', contentLength: body.length });

      const lastSeq = chunks[chunks.length - 1]!.seq;
      await runInOrg(this.prisma, { orgId }, async (tx) => {
        await tx.runbookRunStep.update({ where: { id: stepRowId }, data: { logStorageKey: key } });
        // Only what was uploaded: a chunk that arrived meanwhile stays for the next pass.
        await tx.runbookRunLogChunk.deleteMany({ where: { runStepId: stepRowId, seq: { lte: lastSeq } } });
      });
      return key;
    } catch (error) {
      this.logger.warn(`step log not archived (the chunks are kept): ${error instanceof Error ? error.name : 'error'}`);
      return null;
    }
  }

  /**
   * Uploads a local file (a `collect_logs` archive, already redacted) to `key`, streaming it: the bytes are
   * never held in memory. A failure propagates (the caller fails its step); nothing is half-recorded.
   */
  async uploadFile(key: string, path: string, sizeBytes: number, mimeType: string): Promise<void> {
    await this.storage.upload(key, createReadStream(path), { mimeType, contentLength: sizeBytes });
  }

  /** The (redacted) log of one step, or `null` when the step does not exist. */
  async readStepLog(orgId: string, stepRowId: string, tail?: number): Promise<string | null> {
    const loaded = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const step = await tx.runbookRunStep.findFirst({ where: { id: stepRowId }, select: { logStorageKey: true } });
      if (!step) return null;
      const chunks = step.logStorageKey
        ? []
        : await tx.runbookRunLogChunk.findMany({ where: { runStepId: stepRowId }, orderBy: { seq: 'asc' }, select: { data: true } });
      return { key: step.logStorageKey, chunks };
    });
    if (!loaded) return null;
    let text: string;
    if (loaded.key) {
      const stream = await this.storage.download(loaded.key);
      const parts: Buffer[] = [];
      for await (const part of stream) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
      text = Buffer.concat(parts).toString('utf8');
    } else {
      text = loaded.chunks.map((c) => c.data).join('');
    }
    return tail ? tailLines(text, tail) : text;
  }
}
