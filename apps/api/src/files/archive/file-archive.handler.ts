// =============================================================================
// `files.archive` (issue #158, epic #151): a server folder as a tar.gz in object storage
// =============================================================================
//
// Queued by `POST /api/server-profiles/:id/files/archive` (`FileArchivesService.request`) with
// `{ archiveId, orgId, userId, serverProfileId, path }`: ids and the resolved folder path, no secret. The
// handler:
//
//   1. re-checks access for the requester AS THEY ARE NOW (active, in the organization, `sessions:write`,
//      the connect rule), so a share revoked while the job waited stops it;
//   2. opens an SSH connection through `SshConnectionFactory` (host key verified before any credential)
//      and runs ONE exec: `tar -czf - -C '<parent>' -- '<base>'` (`tar-command.ts`: the path is
//      single-quoted, nothing else is interpolated);
//   3. streams stdout through a byte counter straight into `StorageProvider.upload` under
//      `file-archives/<orgId>/<archiveId>/archive.tar.gz`. NOTHING IS BUFFERED beyond the upload's part
//      size, and no temp file is written. The counter fails the stream the moment it passes
//      `files.downloadMaxBytes`: the upload aborts, the remote tar is closed and the job fails
//      ARCHIVE_TOO_LARGE;
//   4. awaits BOTH the upload and the exit status. tar exit 1 ("a file changed as we read it") is success
//      with a warning; 2 or more, a signal or no status fails the job and deletes the object;
//   5. records the result on the `file_archives` row (the browser polls it), writes the audit event
//      `server_profile.folder_archive` and sends the notification, both AFTER the row's write committed.
//
// SERVER-ONLY, permanently: it carries neither `nodeResultSchema` nor `persistNodeResult` (it holds an
// SSH connection; SSH credentials are never brokered to a node). `maxAttempts: 1`: a retry would stream
// the same folder again for a result the person already saw fail, and the person can simply ask again.
// `maxRuntimeMs` is 30 minutes: a 2 GB archive at a conservative 2 MB/s is 17 minutes; the handler's own
// deadline is a minute shorter so it fails with a reason instead of the lease reaper doing it silently.
//
// Idempotent under at-least-once delivery: a row that is gone, `ready` or `failed` is a no-op.
// LOGGING: ids and counts only. A path, a host and tar's stderr never reach a log line or a span; tar's
// first stderr line goes to the row (the owner's own record), trimmed.
// =============================================================================

import { Transform } from 'node:stream';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_PROVIDER, buildObjectKey, type StorageProvider } from '@marinoscar/platform-api/storage';
import type { Client, ClientChannel } from 'ssh2';
import { z } from 'zod';

import { recordAudit } from '../../common/audit/record-audit';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import {
  FILES_ARCHIVE_FAILED_EVENT,
  FILES_ARCHIVE_READY_EVENT,
  FILE_ARCHIVES_PATH,
  type FileArchiveNotificationData,
} from '../../notifications-registry/files.notifications';
import { PrismaService } from '../../prisma/prisma.service';
import { ServerProfilesService } from '../../server-profiles/server-profiles.service';
import { HostKeyError } from '../../ssh/host-key.error';
import { SshConnectionFactory } from '../../ssh/ssh-connection.factory';
import { FilesPrincipalResolver } from '../files-principal.resolver';
import {
  ARCHIVE_DEADLINE_MS,
  ARCHIVE_FAILURE,
  ARCHIVE_MAX_RUNTIME_MS,
  ARCHIVE_TTL_MS,
  FILES_ARCHIVE_JOB_TYPE,
  FILE_ARCHIVES_KEY_PREFIX,
  ARCHIVE_CREATED_AT_METADATA,
  type ArchiveFailureCode,
} from './archive.constants';
import { buildTarCommand, splitArchivePath } from './tar-command';

export const FILES_ARCHIVE_PAYLOAD = z.object({
  archiveId: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  serverProfileId: z.string().uuid(),
  path: z.string().min(1).max(4096).startsWith('/'),
});
export type FilesArchivePayload = z.infer<typeof FILES_ARCHIVE_PAYLOAD>;

export const archiveObjectKey = (orgId: string, archiveId: string): string =>
  buildObjectKey(FILE_ARCHIVES_KEY_PREFIX, { orgId }, archiveId, 'archive.tar.gz');

/** A failure the person is told about: a stable code and a message with no secret in it. */
export class ArchiveFailure extends Error {
  constructor(
    readonly code: ArchiveFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveFailure';
  }
}

/** Counts the bytes that pass and fails the stream the moment they exceed `cap`. */
export class ByteCap extends Transform {
  total = 0;
  constructor(private readonly cap: number) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length;
    if (this.total > this.cap) {
      callback(new ArchiveFailure(ARCHIVE_FAILURE.TOO_LARGE, 'The archive is larger than the download limit.'));
      return;
    }
    callback(null, chunk);
  }
}

/** The first stderr line of tar, without its `tar: ` prefix and control characters, at most 200 characters. */
export function stderrReason(stderr: string): string {
  const line = stderr.split('\n').find((l) => l.trim() !== '') ?? '';
  return line
    .replace(/^tar:\s*/, '')
    .replace(/[^\x20-\x7e\u00a1-\uffff]/g, '')
    .trim()
    .slice(0, 200);
}

export interface StreamedArchive {
  sizeBytes: number;
  warning: string | null;
}

@Injectable()
export class FileArchiveHandler implements JobHandler, OnModuleInit {
  readonly type = FILES_ARCHIVE_JOB_TYPE;
  readonly label = 'Archive a server folder';
  readonly profile = { maxRuntimeMs: ARCHIVE_MAX_RUNTIME_MS, maxAttempts: 1 } as const;

  /** The handler's own deadline (a test shortens it). */
  deadlineMs = ARCHIVE_DEADLINE_MS;
  /** How long to wait for the exit status once the upload finished (a test shortens it). */
  exitGraceMs = 30_000;

  private readonly logger = new Logger(FileArchiveHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly profiles: ServerProfilesService,
    private readonly principals: FilesPrincipalResolver,
    private readonly factory: SshConnectionFactory,
    private readonly settings: SystemSettingsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly notifications: NotificationsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const payload = FILES_ARCHIVE_PAYLOAD.parse(job.payload);
    if (job.orgId && job.orgId !== payload.orgId) throw new Error('The job organization does not match its payload');
    const { orgId, archiveId } = payload;

    const row = await runInOrg(this.prisma, { orgId }, (tx) => tx.fileArchive.findFirst({ where: { id: archiveId } }));
    if (!row || row.status === 'ready' || row.status === 'failed') return; // purged, or already settled
    const key = archiveObjectKey(orgId, archiveId);
    await runInOrg(this.prisma, { orgId }, (tx) =>
      tx.fileArchive.update({ where: { id: archiveId }, data: { status: 'running', storageKey: key } }),
    );

    let serverName = 'a server';
    try {
      const prepared = await this.prepare(payload);
      serverName = prepared.serverName;
      const result = await this.stream(prepared, payload, key);
      await runInOrg(this.prisma, { orgId }, (tx) =>
        tx.fileArchive.update({
          where: { id: archiveId },
          data: {
            status: 'ready',
            sizeBytes: BigInt(result.sizeBytes),
            warning: result.warning,
            finishedAt: new Date(),
            expiresAt: new Date(Date.now() + ARCHIVE_TTL_MS),
          },
        }),
      );
      // After the commit: the audit event and the notification.
      await recordAudit(this.audit, this.logger, {
        action: 'server_profile.folder_archive',
        actorUserId: payload.userId,
        targetType: 'server_profile',
        targetId: payload.serverProfileId,
        meta: { path: payload.path, size: result.sizeBytes, hostname: prepared.hostname },
      });
      await this.notifications.notify(FILES_ARCHIVE_READY_EVENT, payload.userId, this.notice(payload, serverName, { sizeBytes: result.sizeBytes }));
      this.logger.log(`files.archive job ${job.id}: archive ${archiveId} ready, ${result.sizeBytes} bytes`);
    } catch (error) {
      const failure =
        error instanceof ArchiveFailure
          ? error
          : new ArchiveFailure(ARCHIVE_FAILURE.INTERNAL, 'The archive could not be built.');
      // The object (or its multipart pieces) may exist: best effort, the expiry sweep retries by key.
      await this.storage.delete(key).catch(() => undefined);
      await runInOrg(this.prisma, { orgId }, (tx) =>
        tx.fileArchive.update({
          where: { id: archiveId },
          data: {
            status: 'failed',
            errorCode: failure.code,
            errorMessage: failure.message.slice(0, 500),
            finishedAt: new Date(),
            expiresAt: new Date(Date.now() + ARCHIVE_TTL_MS),
          },
        }),
      );
      await this.notifications.notify(FILES_ARCHIVE_FAILED_EVENT, payload.userId, this.notice(payload, serverName, { reason: failure.message }));
      this.logger.warn(`files.archive job ${job.id}: archive ${archiveId} failed (${failure.code})`);
      // Visible on the Jobs page; the person already has the reason on the row.
      throw new Error(failure.code, { cause: error });
    }
  }

  private notice(
    payload: FilesArchivePayload,
    serverName: string,
    extra: Pick<FileArchiveNotificationData, 'sizeBytes' | 'reason'>,
  ): FileArchiveNotificationData {
    const { base } = splitArchivePath(payload.path);
    return { folderName: base === '.' ? '/' : base, serverName, link: FILE_ARCHIVES_PATH, ...extra };
  }

  /** The requester as they are now, and the decrypted profile (the connect rule). */
  private async prepare(payload: FilesArchivePayload) {
    const principal = await this.principals.resolve(payload.userId, payload.orgId);
    if (!principal || !principal.permissions.includes(PERMISSIONS.SESSIONS_WRITE)) {
      throw new ArchiveFailure(ARCHIVE_FAILURE.ACCESS_LOST, 'You no longer have access to this server.');
    }
    try {
      const profile = await this.profiles.getDecryptedProfile(payload.serverProfileId, principal, 'connect');
      return { profile, serverName: profile.name, hostname: profile.hostname };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ArchiveFailure(ARCHIVE_FAILURE.ACCESS_LOST, 'You no longer have access to this server.');
      }
      throw error;
    }
  }

  /** Connects, runs tar and streams it into storage. Resolves with the size and a warning, or throws an `ArchiveFailure`. */
  private async stream(
    prepared: Awaited<ReturnType<FileArchiveHandler['prepare']>>,
    payload: FilesArchivePayload,
    key: string,
  ): Promise<StreamedArchive> {
    const { downloadMaxBytes } = await this.settings.getNamespace('files');
    let client: Client;
    try {
      client = await this.factory.open(prepared.profile, { purpose: 'exec' });
    } catch (error) {
      if (error instanceof HostKeyError) {
        throw new ArchiveFailure(ARCHIVE_FAILURE.HOST_KEY, 'The server\'s host key is not trusted (or changed). Verify it, then try again.');
      }
      throw new ArchiveFailure(ARCHIVE_FAILURE.CONNECT_FAILED, 'Could not connect to the server.');
    }
    let channel: ClientChannel | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      channel = await new Promise<ClientChannel>((resolve, reject) =>
        client.exec(buildTarCommand(payload.path), (error, stream) => (error ? reject(error) : resolve(stream))),
      ).catch(() => {
        throw new ArchiveFailure(ARCHIVE_FAILURE.CONNECT_FAILED, 'The server did not run the archive command.');
      });
      const exec = channel;

      let stderr = '';
      exec.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 4000) stderr += chunk.toString('utf8');
      });
      const exited = new Promise<{ code: number | null }>((resolve) => {
        exec.once('close', (code: number | null | undefined) => resolve({ code: typeof code === 'number' ? code : null }));
      });

      const counter = new ByteCap(downloadMaxBytes);
      exec.on('error', (error: Error) => counter.destroy(error));
      exec.pipe(counter);
      timer = setTimeout(
        () => counter.destroy(new ArchiveFailure(ARCHIVE_FAILURE.TIMEOUT, 'The archive took too long to build.')),
        this.deadlineMs,
      );

      try {
        await this.storage.upload(key, counter, { mimeType: 'application/gzip', metadata: { [ARCHIVE_CREATED_AT_METADATA]: new Date().toISOString() } });
      } catch (error) {
        exec.destroy();
        if (error instanceof ArchiveFailure) throw error;
        // The counter's own error surfaces through the upload's rejection, possibly wrapped.
        const cause = (error as { cause?: unknown } | null)?.cause;
        if (cause instanceof ArchiveFailure) throw cause;
        if (counter.errored instanceof ArchiveFailure) throw counter.errored;
        throw new ArchiveFailure(ARCHIVE_FAILURE.STORAGE_FAILED, 'The archive could not be stored.');
      }

      // BOTH the upload and the exit status.
      const status = await Promise.race([
        exited,
        new Promise<{ code: number | null }>((resolve) => setTimeout(() => resolve({ code: null }), this.exitGraceMs).unref()),
      ]);
      if (status.code === 0) return { sizeBytes: counter.total, warning: null };
      if (status.code === 1) {
        return { sizeBytes: counter.total, warning: 'Some files changed while they were being read; the archive may be inconsistent.' };
      }
      const reason = stderrReason(stderr);
      throw new ArchiveFailure(
        ARCHIVE_FAILURE.TAR_FAILED,
        `tar ${status.code === null ? 'did not finish' : `exited with status ${status.code}`}${reason ? `: ${reason}` : ''}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
      try {
        channel?.destroy();
        client.end();
        client.destroy();
      } catch {
        // already closed
      }
    }
  }
}
