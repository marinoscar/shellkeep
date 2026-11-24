import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_PROVIDER, type StorageProvider } from '@marinoscar/platform-api/storage';
import type { ResolvedLinkGrant } from '@marinoscar/platform-api/sharing';
import type { Prisma } from '@prisma/client';

import { DOWNLOAD_URL_TTL_SEC } from './runbook-artifacts.service';
import { safeSegment } from './bundle-builder';

export interface PublicBundle {
  runbook: string;
  finishedAt: string | null;
  sizeBytes: number;
  url: string;
  urlExpiresAt: string;
}

/**
 * Reads a shared run's bundle INSIDE the link's scope (one transaction in the run's organization, no user,
 * row-level security on) and mints the presigned URL. The query is limited to the one run the link names.
 */
@Injectable()
export class PublicRunbookBundleService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async resolve(link: ResolvedLinkGrant, scoped: <R>(fn: (tx: unknown) => Promise<R>) => Promise<R>): Promise<PublicBundle | null> {
    const row = await scoped((tx) =>
      (tx as Prisma.TransactionClient).runbookArtifact.findFirst({
        where: { runId: link.resourceId, kind: 'bundle' },
        select: { storageKey: true, sizeBytes: true, run: { select: { finishedAt: true, runbook: { select: { name: true } } } } },
      }),
    );
    if (!row) return null;
    const url = await this.storage.getSignedDownloadUrl(row.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL_SEC,
      responseContentDisposition: `attachment; filename="${safeSegment(row.run.runbook.name, 48)}-${link.resourceId.slice(0, 8)}-logs.zip"`,
    });
    return {
      runbook: row.run.runbook.name,
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      sizeBytes: Number(row.sizeBytes),
      url,
      urlExpiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SEC * 1000).toISOString(),
    };
  }
}
