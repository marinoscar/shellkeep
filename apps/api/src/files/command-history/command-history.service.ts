// =============================================================================
// Command history of a session's server (issue #173, epic #171)
// =============================================================================
//
// The shell's own history file, read over SFTP (a path from a fixed list, relative to the login
// home; no exec, so no user input ever reaches a command). ACCESS IS THE TERMINAL'S: the
// caller's own session (`SessionsService.findOne`, 404 otherwise) and the right to connect to
// its server (`getDecryptedProfile(..., 'connect')`); `sessions:write` is on the controller.
//
// Only the last 256 KB of the file is read. Every entry is redacted (`history-redact.ts`)
// BEFORE it is cached or searched. The result is cached for 30 s per user and session, in
// memory (single instance). Entries never reach a log or a span; nothing here goes to a model.
// =============================================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import type { OwnerScope } from '../../common/types/owner-scope';
import { ServerProfilesService } from '../../server-profiles/server-profiles.service';
import { HostKeyError } from '../../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../../ssh/host-key-http';
import { SessionsService } from '../../terminal/sessions.service';
import { FilesRateLimiter } from '../files-rate-limiter';
import { SftpService, type SftpSession } from '../sftp.service';
import {
  HISTORY_FILES,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_TAIL_BYTES,
  type HistoryShell,
  normalizeHistory,
  parseHistory,
  tailText,
} from './history-parse';
import { redactHistory } from './history-redact';

/** Reads per user and minute; the list is cached, so a busy panel costs little. */
export const HISTORY_REQUESTS_PER_MINUTE = 30;
export const HISTORY_CACHE_TTL_MS = 30_000;
const MAX_CACHED = 500;

export interface HistoryEntry {
  command: string;
  /** Part of the command was masked as a secret; running it as shown will not work. */
  masked: boolean;
}

export interface CommandHistory {
  /** The shell whose history file was read, or `null` when none exists. */
  shell: HistoryShell | null;
  entries: HistoryEntry[];
  /** True when the file was longer than the part read (older commands exist). */
  truncated: boolean;
  /** How many entries were dropped for being entirely a secret (a count only). */
  dropped: number;
}

interface Cached {
  at: number;
  value: CommandHistory;
}

@Injectable()
export class CommandHistoryService {
  private readonly cache = new Map<string, Cached>();

  /** The clock; a spec replaces it. */
  now: () => number = Date.now;

  constructor(
    private readonly profiles: ServerProfilesService,
    private readonly sessions: SessionsService,
    private readonly sftp: SftpService,
    private readonly settings: SystemSettingsService,
    private readonly limiter: FilesRateLimiter,
  ) {}

  async list(
    sessionId: string,
    principal: Principal,
    input: { query?: string; limit?: number },
  ): Promise<CommandHistory> {
    if (!principal.activeOrgId) throw new NotFoundException('Terminal session not found');
    const scope: OwnerScope = { userId: principal.userId, orgId: principal.activeOrgId };
    const session = await this.sessions.findOne(sessionId, scope);
    if (session.status === 'terminated') throw new BadRequestException('Cannot read history of a terminated session');
    const profile = await this.profiles.getDecryptedProfile(session.serverProfileId, principal, 'connect');
    this.limiter.hit(scope.userId, 'history', HISTORY_REQUESTS_PER_MINUTE);

    const key = `${scope.userId}:${sessionId}`;
    const now = this.now();
    let hit = this.cache.get(key);
    if (!hit || now - hit.at > HISTORY_CACHE_TTL_MS) {
      const settings = await this.settings.getNamespace('files');
      let value: CommandHistory;
      try {
        value = await this.sftp.withSession(profile, settings.sftpTimeoutSeconds, 'command_history', (sftp) => this.read(sftp));
      } catch (error) {
        // A refused host key is the 409 the rest of the SSH routes answer.
        if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error, session.serverProfileId);
        throw error;
      }
      hit = { at: now, value };
      this.cache.set(key, hit);
      if (this.cache.size > MAX_CACHED) this.prune(now);
    }
    return filterHistory(hit.value, input.query, input.limit ?? 200);
  }

  /** Picks the most recently written history file and parses the tail of it. */
  private async read(sftp: SftpSession): Promise<CommandHistory> {
    const home = await sftp.home();
    let best: { shell: HistoryShell; path: string; size: number; mtime: number } | null = null;
    for (const file of HISTORY_FILES) {
      const path = `${home.replace(/\/$/, '')}/${file.path}`;
      try {
        const stats = await sftp.stat(path);
        if (!stats.isFile() || stats.size === 0) continue;
        if (!best || stats.mtime > best.mtime) best = { shell: file.shell, path, size: stats.size, mtime: stats.mtime };
      } catch (error) {
        if (isMissingOrDenied(error)) continue;
        throw error;
      }
    }
    if (!best) return { shell: null, entries: [], truncated: false, dropped: 0 };

    const start = Math.max(0, best.size - MAX_HISTORY_TAIL_BYTES);
    const buffer = await sftp.readRange(best.path, start, best.size - start);
    const commands = normalizeHistory(parseHistory(best.shell, tailText(buffer, start === 0)));
    const { entries, dropped } = redactHistory(commands);
    return { shell: best.shell, entries: entries.slice(0, MAX_HISTORY_ENTRIES), truncated: start > 0, dropped };
  }

  private prune(now: number): void {
    for (const [key, value] of this.cache) {
      if (now - value.at > HISTORY_CACHE_TTL_MS) this.cache.delete(key);
    }
    if (this.cache.size > MAX_CACHED) this.cache.clear();
  }
}

function isMissingOrDenied(error: unknown): boolean {
  const code = (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code;
  return code === 'FILE_NOT_FOUND' || code === 'FILE_PERMISSION_DENIED';
}

/** The cached list narrowed by a case-insensitive substring and a limit (the search sees redacted text only). */
export function filterHistory(history: CommandHistory, query: string | undefined, limit: number): CommandHistory {
  const needle = query?.trim().toLowerCase();
  const entries = (needle ? history.entries.filter((e) => e.command.toLowerCase().includes(needle)) : history.entries).slice(0, limit);
  return { ...history, entries };
}

