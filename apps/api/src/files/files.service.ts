// =============================================================================
// The files API service (issue #153, epic #151)
// =============================================================================
//
// ACCESS IS THE TERMINAL'S: a route needs `sessions:write` (what the WebSocket gateway
// requires) and `ServerProfilesService.getDecryptedProfile(..., 'connect')`, which runs
// `AccessPolicy` `connect` (the owner, or a share that allows connecting) on every request.
// A refusal is a 404. There is no `files:*` permission.
//
// File content, and paths, never reach a log or span. The audit event of a download carries
// the path (the epic requires it); nothing else does.
// =============================================================================

import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { AUDIT_SINK, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { recordAudit } from '../common/audit/record-audit';
import type { OwnerScope } from '../common/types/owner-scope';
import { ServerProfilesService } from '../server-profiles/server-profiles.service';
import { SessionHistoryService } from '../terminal/session-history.service';
import { SessionsService } from '../terminal/sessions.service';
import { FilesPrincipalResolver } from './files-principal.resolver';
import { DownloadTokenStore } from './download-token.store';
import { fileError } from './files-error';
import { FilesRateLimiter } from './files-rate-limiter';
import type { FilesSystemSettings } from './settings/files.system-settings';
import { guessMime } from './mime';
import { computeRange } from './range';
import { baseName, needsBases, resolveRemotePath } from './remote-path';
import { SftpService, SftpSession, type FileEntry, type OpenedDownload } from './sftp.service';
import { assertUploadName, uploadTempName } from './upload-name';
import { BINARY_SNIFF_BYTES, decodeUtf8Window, looksBinary } from './text-detect';

export interface FilesTarget {
  profile: Awaited<ReturnType<ServerProfilesService['getDecryptedProfile']>>;
  scope: OwnerScope;
  settings: FilesSystemSettings;
  cwd: string | null;
}

export interface FileStat extends FileEntry {
  path: string;
  mime: string;
  isText: boolean;
}

export interface FileContent {
  text: string;
  offset: number;
  length: number;
  size: number;
  eof: boolean;
}

export interface UploadInput {
  /** The target directory (absolute, `~`, or relative to the session's working directory / home). */
  path: string;
  name: string;
  overwrite: boolean;
  sessionId?: string;
  contentType?: string;
  /** The declared Content-Length, when the client sent one. */
  contentLength: number | null;
  /** The request body, unread. */
  body: Readable;
}

export interface UploadResult {
  path: string;
  name: string;
  size: number;
  overwritten: boolean;
}

/** SFTP WRITEs in flight at once: one round trip per chunk would cap the speed at chunk / RTT. */
const UPLOAD_WRITE_WINDOW = 16;

export interface PreparedDownload extends OpenedDownload {
  filename: string;
  mime: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly profiles: ServerProfilesService,
    private readonly sessions: SessionsService,
    private readonly history: SessionHistoryService,
    private readonly sftp: SftpService,
    private readonly settings: SystemSettingsService,
    private readonly tokens: DownloadTokenStore,
    private readonly limiter: FilesRateLimiter,
    private readonly principals: FilesPrincipalResolver,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  // ---------------------------------------------------------------------------

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new NotFoundException('Server profile not found');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  /** The terminal's connect rule, the files settings and (when named) the session's working directory. */
  private async target(profileId: string, principal: Principal, input: { path: string; sessionId?: string }): Promise<FilesTarget> {
    const scope = this.scopeOf(principal);
    const profile = await this.profiles.getDecryptedProfile(profileId, principal, 'connect');
    const settings = await this.settings.getNamespace('files');
    let cwd: string | null = null;
    if (input.sessionId && needsBases(input.path).cwd) {
      // The caller's own session, on this very profile; anything else is a 404.
      const session = await this.sessions.findOne(input.sessionId, scope);
      if (session.serverProfileId !== profileId) throw new NotFoundException('Terminal session not found');
      cwd = await this.history.currentPath(session, scope);
    } else if (input.sessionId) {
      const session = await this.sessions.findOne(input.sessionId, scope);
      if (session.serverProfileId !== profileId) throw new NotFoundException('Terminal session not found');
    }
    return { profile, scope, settings, cwd };
  }

  private async resolve(sftp: SftpSession, t: FilesTarget, input: string): Promise<string> {
    const home = needsBases(input).home ? await sftp.home() : '/';
    return resolveRemotePath(input, { home, cwd: t.cwd });
  }

  // ---------------------------------------------------------------------------

  async list(profileId: string, principal: Principal, input: { path: string; sessionId?: string }) {
    const t = await this.target(profileId, principal, input);
    return this.sftp.withSession(t.profile, t.settings.sftpTimeoutSeconds, 'list', async (sftp) => {
      const path = await this.resolve(sftp, t, input.path);
      const stats = await sftp.stat(path);
      if (!stats.isDirectory()) throw fileError('FILE_NOT_A_DIRECTORY', 'The path is not a directory');
      const { entries, truncated } = await sftp.list(path);
      return { path, entries, truncated };
    });
  }

  async stat(profileId: string, principal: Principal, input: { path: string; sessionId?: string }): Promise<FileStat> {
    const t = await this.target(profileId, principal, input);
    return this.sftp.withSession(t.profile, t.settings.sftpTimeoutSeconds, 'stat', async (sftp) => {
      const path = await this.resolve(sftp, t, input.path);
      const entry = await sftp.describe(path, path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1));
      const effective = entry.type === 'symlink' ? entry.targetType : entry.type;
      let isText = false;
      if (effective === 'file') {
        const head = await sftp.readRange(path, 0, Math.min(BINARY_SNIFF_BYTES, entry.size));
        isText = !looksBinary(head, entry.size > head.length);
      }
      const mime = effective === 'dir' ? 'inode/directory' : guessMime(path);
      return { ...entry, path, mime, isText };
    });
  }

  async content(
    profileId: string,
    principal: Principal,
    input: { path: string; sessionId?: string; offset?: number; length?: number },
  ): Promise<FileContent> {
    const t = await this.target(profileId, principal, input);
    this.limiter.hit(t.scope.userId, 'content', t.settings.contentRequestsPerMinute);
    return this.sftp.withSession(t.profile, t.settings.sftpTimeoutSeconds, 'content', async (sftp) => {
      const path = await this.resolve(sftp, t, input.path);
      const stats = await sftp.stat(path);
      if (!stats.isFile()) throw fileError('FILE_NOT_A_FILE', 'The path is not a regular file');
      const size = stats.size;
      const range = computeRange(size, input, t.settings);

      const window = await sftp.readRange(path, range.offset, range.length);
      const eof = range.offset + window.length >= size;
      // The first 8 KB of the FILE decide text or binary, wherever the window is.
      const headLength = Math.min(BINARY_SNIFF_BYTES, size);
      const head = range.offset === 0 && window.length >= headLength ? window.subarray(0, headLength) : await sftp.readRange(path, 0, headLength);
      if (looksBinary(head, size > head.length)) throw fileError('FILE_IS_BINARY', 'The file is binary; download it instead', { size });

      const decoded = decodeUtf8Window(window, eof);
      if (!decoded) throw fileError('FILE_IS_BINARY', 'The file is not valid UTF-8; download it instead', { size });
      const offset = range.offset + decoded.skipped;
      return {
        text: decoded.text,
        offset,
        length: decoded.length,
        size,
        eof: offset + decoded.length >= size,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Downloads
  // ---------------------------------------------------------------------------

  async issueDownloadToken(
    profileId: string,
    principal: Principal,
    input: { path: string; sessionId?: string },
  ): Promise<{ token: string; expiresAt: string }> {
    const t = await this.target(profileId, principal, input);
    this.limiter.hit(t.scope.userId, 'download', t.settings.downloadsPerMinute);
    const { path, size } = await this.sftp.withSession(t.profile, t.settings.sftpTimeoutSeconds, 'download_token', async (sftp) => {
      const resolved = await this.resolve(sftp, t, input.path);
      const stats = await sftp.stat(resolved);
      if (!stats.isFile()) throw fileError('FILE_NOT_A_FILE', 'The path is not a regular file');
      if (stats.size > t.settings.downloadMaxBytes) {
        throw fileError('FILE_TOO_LARGE', 'The file is larger than the download limit', { size: stats.size, limit: t.settings.downloadMaxBytes });
      }
      return { path: resolved, size: stats.size };
    });
    const { token, expiresAt } = this.tokens.issue({ userId: t.scope.userId, orgId: t.scope.orgId, serverProfileId: profileId, path, size });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Redeems a token (public route: the token is the credential). The connect rule is checked AGAIN
   * for the token's user, so a share revoked, a role that lost `sessions:write` or a deactivated user within the minute stops the download. Every refusal
   * of the token itself is the same 404.
   */
  async openDownload(token: string): Promise<PreparedDownload> {
    const grant = this.tokens.consume(token);
    if (!grant) throw fileError('FILE_DOWNLOAD_NOT_FOUND', 'Download not found or expired');
    // The token user as they are NOW: active, still in the organization, still holding the
    // terminal permission, and still allowed to connect to the server. Every refusal is the same 404.
    const principal = await this.principals.resolve(grant.userId, grant.orgId);
    if (!principal || !principal.permissions.includes(PERMISSIONS.SESSIONS_WRITE)) {
      throw fileError('FILE_DOWNLOAD_NOT_FOUND', 'Download not found or expired');
    }
    let profile;
    try {
      profile = await this.profiles.getDecryptedProfile(grant.serverProfileId, principal, 'connect');
    } catch (error) {
      if (error instanceof NotFoundException) throw fileError('FILE_DOWNLOAD_NOT_FOUND', 'Download not found or expired');
      throw error;
    }
    const settings = await this.settings.getNamespace('files');
    const release = this.limiter.acquireStream(grant.userId, settings.maxConcurrentDownloads);
    let opened: OpenedDownload;
    try {
      opened = await this.sftp.openDownload(profile, grant.path, settings.sftpTimeoutSeconds, (size) => {
        if (size > settings.downloadMaxBytes) {
          throw fileError('FILE_TOO_LARGE', 'The file is larger than the download limit', { size, limit: settings.downloadMaxBytes });
        }
        if (size !== grant.size) throw fileError('FILE_CHANGED', 'The file changed since the download was requested');
      });
    } catch (error) {
      release();
      throw error;
    }
    const close = (): void => {
      opened.close();
      release();
    };
    opened.stream.once('close', release);

    await recordAudit(this.audit, this.logger, {
      action: 'server_profile.file_download',
      actorUserId: grant.userId,
      targetType: 'server_profile',
      targetId: grant.serverProfileId,
      meta: { path: grant.path, size: opened.size, hostname: profile.hostname },
    });
    return { ...opened, close, filename: baseName(grant.path), mime: guessMime(grant.path) };
  }

  // ---------------------------------------------------------------------------
  // Uploads
  // ---------------------------------------------------------------------------

  /**
   * Streams the request body into `<dir>/<name>` over SFTP: into a temporary name in the same
   * directory, then a rename onto the final name, so a reader never sees a half-written file.
   * The body is never buffered (at most `UPLOAD_WRITE_WINDOW` chunks are in flight) and the byte
   * count is enforced while streaming. Any failure, abort or overflow removes the temp file.
   * Order: access (404), media type (415), name (400), declared size (413), limits (429).
   */
  async upload(profileId: string, principal: Principal, input: UploadInput): Promise<UploadResult> {
    const t = await this.target(profileId, principal, input);
    if (!/^application\/octet-stream\s*(;|$)/i.test(input.contentType ?? '')) {
      throw new UnsupportedMediaTypeException('An upload is sent as application/octet-stream');
    }
    assertUploadName(input.name);
    const limit = t.settings.uploadMaxBytes;
    const tooLarge = (size: number) => fileError('FILE_TOO_LARGE', 'The file is larger than the upload limit', { size, limit });
    if (input.contentLength !== null && input.contentLength > limit) throw tooLarge(input.contentLength);
    // Uploads share the download limits: one per-minute budget and one concurrency cap each.
    this.limiter.hit(t.scope.userId, 'upload', t.settings.downloadsPerMinute);
    const release = this.limiter.acquireStream(t.scope.userId, t.settings.maxConcurrentDownloads, 'upload');

    try {
      const result = await this.sftp.withTransferSession(
        t.profile,
        t.settings.sftpTimeoutSeconds,
        'upload',
        async (sftp, touch) => {
          const dir = await this.resolve(sftp, t, input.path);
          const dirStats = await sftp.stat(dir);
          if (!dirStats.isDirectory()) throw fileError('FILE_NOT_A_DIRECTORY', 'The target is not a directory');
          const finalPath = dir === '/' ? `/${input.name}` : `${dir}/${input.name}`;

          const existing = await sftp.lstatOrNull(finalPath);
          if (existing) {
            // A link to a directory is a directory; nothing is ever uploaded over one.
            const followed = existing.isSymbolicLink() ? await sftp.stat(finalPath).catch(() => null) : existing;
            if (followed?.isDirectory()) throw fileError('FILE_NOT_A_FILE', 'A folder with that name already exists');
            if (!input.overwrite) {
              const entry = await sftp.describe(finalPath, input.name);
              throw fileError('FILE_EXISTS', 'A file with that name already exists', {
                name: input.name,
                path: finalPath,
                size: entry.size,
                mtime: entry.mtime,
              });
            }
          }

          const tempPath = `${dir === '/' ? '' : dir}/${uploadTempName(input.name, randomBytes(6).toString('hex'))}`;
          const handle = await sftp.openNewForWrite(tempPath);
          let handleOpen = true;
          const pending = new Set<Promise<void>>();
          let failure: unknown;
          let received = 0;
          const settle = async (): Promise<void> => {
            await Promise.allSettled([...pending]);
          };
          try {
            let position = 0;
            // Not destroyed on early exit: destroying the request would reset the socket before the error response.
            for await (const chunk of input.body.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
              touch();
              received += chunk.length;
              if (received > limit) throw tooLarge(received);
              if (failure) throw failure;
              const at = position;
              position += chunk.length;
              const write: Promise<void> = sftp.write(handle, chunk, at).then(
                () => {
                  touch();
                },
                (error) => {
                  failure ??= error;
                },
              );
              pending.add(write);
              void write.finally(() => pending.delete(write));
              if (pending.size >= UPLOAD_WRITE_WINDOW) await Promise.race([...pending]);
            }
            await settle();
            if (failure) throw failure;
            handleOpen = false;
            await sftp.closeHandle(handle);
            if (input.overwrite && existing) await sftp.renameReplacing(tempPath, finalPath);
            else {
              try {
                await sftp.rename(tempPath, finalPath);
              } catch (error) {
                // Somebody created the name while we streamed: the same answer as the up-front check.
                const now = await sftp.lstatOrNull(finalPath).catch(() => null);
                if (now) throw fileError('FILE_EXISTS', 'A file with that name already exists', { name: input.name, path: finalPath, size: now.size });
                throw error;
              }
            }
            return { path: finalPath, name: input.name, size: received, overwritten: Boolean(existing) };
          } catch (error) {
            // Best effort, on a connection that may already be gone: close the handle, drop the temp file.
            await settle();
            if (handleOpen) await sftp.closeHandle(handle).catch(() => undefined);
            await sftp.unlink(tempPath).catch(() => undefined);
            throw error;
          }
        },
        () => input.body.destroy(),
      );
      await recordAudit(this.audit, this.logger, {
        action: 'server_profile.file_upload',
        actorUserId: t.scope.userId,
        targetType: 'server_profile',
        targetId: profileId,
        meta: { path: result.path, size: result.size, hostname: t.profile.hostname },
      });
      return result;
    } finally {
      release();
    }
  }
}
