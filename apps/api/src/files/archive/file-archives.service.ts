// =============================================================================
// Folder archives: request, status, download link (issue #158)
// =============================================================================
//
// ACCESS: the same as every files route (`sessions:write`, set on the controller, plus the connect rule on the
// server). An archive is also the requester's own: another user's archive id, an archive of a server the
// caller can no longer connect to, and an archive that does not exist are all the same 404.
//
// The download is a PRESIGNED URL of the storage provider (15 minutes, `Content-Disposition: attachment`), like
// the runbook artifacts: the API never streams the bytes. Each link issued is audited.
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER, type StorageProvider } from '@marinoscar/platform-api/storage';

import { recordAudit } from '../../common/audit/record-audit';
import { PrismaService } from '../../prisma/prisma.service';
import { ServerProfilesService } from '../../server-profiles/server-profiles.service';
import { fileError } from '../files-error';
import { FilesService } from '../files.service';
import {
  ARCHIVE_DOWNLOAD_URL_TTL_SEC,
  ARCHIVE_TTL_MS,
  FILES_ARCHIVE_JOB_REASON,
  FILES_ARCHIVE_JOB_TYPE,
  FILES_ARCHIVE_SUBJECT,
} from './archive.constants';
import { archiveFileName } from './tar-command';

export type ArchiveViewStatus = 'pending' | 'running' | 'ready' | 'failed' | 'expired';

export interface ArchiveRequested {
  archiveId: string;
  jobId: string;
  status: 'pending';
}

export interface ArchiveView {
  archiveId: string;
  serverProfileId: string | null;
  path: string;
  status: ArchiveViewStatus;
  sizeBytes: number | null;
  warning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string;
}

export interface ArchiveDownload {
  url: string;
  filename: string;
  expiresAt: string;
}

@Injectable()
export class FileArchivesService {
  private readonly logger = new Logger(FileArchivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly profiles: ServerProfilesService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  /** Checks access and that the path is a directory, records the archive and queues the job. */
  async request(profileId: string, principal: Principal, input: { path: string; sessionId?: string }): Promise<ArchiveRequested> {
    const { path, scope, settings } = await this.files.prepareArchive(profileId, principal, input);
    const { orgId, userId } = scope;

    // A user may have only as many archives building as downloads open (`maxConcurrentDownloads`).
    const row = await runInOrg(this.prisma, { orgId }, async (tx) => {
      const building = await tx.fileArchive.count({ where: { userId, status: { in: ['pending', 'running'] } } });
      if (building >= settings.maxConcurrentDownloads) return null;
      return tx.fileArchive.create({
        data: { orgId, userId, serverProfileId: profileId, path, expiresAt: new Date(Date.now() + ARCHIVE_TTL_MS) },
        select: { id: true },
      });
    });
    if (!row) throw fileError('FILES_RATE_LIMITED', 'Too many folder archives are being built; wait for one to finish');

    try {
      const job = await this.jobs.enqueue({
        type: FILES_ARCHIVE_JOB_TYPE,
        reason: FILES_ARCHIVE_JOB_REASON,
        orgId,
        subjectType: FILES_ARCHIVE_SUBJECT,
        subjectId: row.id,
        payload: { archiveId: row.id, orgId, userId, serverProfileId: profileId, path },
      });
      await runInOrg(this.prisma, { orgId }, (tx) => tx.fileArchive.update({ where: { id: row.id }, data: { jobId: job.id } }));
      return { archiveId: row.id, jobId: job.id, status: 'pending' };
    } catch (error) {
      await runInOrg(this.prisma, { orgId }, (tx) => tx.fileArchive.delete({ where: { id: row.id } })).catch(() => undefined);
      throw error;
    }
  }

  /** The caller's archive on a server they may still connect to, else 404. */
  private async owned(principal: Principal, archiveId: string) {
    const orgId = principal.activeOrgId;
    if (!orgId) throw new NotFoundException('Archive not found');
    const row = await runInOrg(this.prisma, { orgId }, (tx) =>
      tx.fileArchive.findFirst({ where: { id: archiveId, userId: principal.userId } }),
    );
    if (!row || !row.serverProfileId) throw new NotFoundException('Archive not found');
    try {
      await this.profiles.assertCanConnect(row.serverProfileId, principal);
    } catch {
      throw new NotFoundException('Archive not found');
    }
    return row;
  }

  async get(principal: Principal, archiveId: string): Promise<ArchiveView> {
    const row = await this.owned(principal, archiveId);
    const expired = row.expiresAt.getTime() <= Date.now();
    return {
      archiveId: row.id,
      serverProfileId: row.serverProfileId,
      path: row.path,
      status: expired ? 'expired' : (row.status as ArchiveViewStatus),
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      warning: row.warning,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** A presigned link to the tar.gz of a ready archive. */
  async download(principal: Principal, archiveId: string): Promise<ArchiveDownload> {
    const row = await this.owned(principal, archiveId);
    if (row.expiresAt.getTime() <= Date.now()) throw new NotFoundException('Archive not found');
    if (row.status !== 'ready' || !row.storageKey) throw fileError('FILE_ARCHIVE_NOT_READY', 'The archive is not ready to download');
    const filename = archiveFileName(row.path);
    const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const url = await this.storage.getSignedDownloadUrl(row.storageKey, {
      expiresIn: ARCHIVE_DOWNLOAD_URL_TTL_SEC,
      responseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    await recordAudit(this.audit, this.logger, {
      action: 'server_profile.folder_archive_download',
      actorUserId: principal.userId,
      targetType: 'server_profile',
      targetId: row.serverProfileId as string,
      meta: { archiveId: row.id, path: row.path, size: row.sizeBytes === null ? null : Number(row.sizeBytes) },
    });
    return { url, filename, expiresAt: new Date(Date.now() + ARCHIVE_DOWNLOAD_URL_TTL_SEC * 1000).toISOString() };
  }
}
