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

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
}
