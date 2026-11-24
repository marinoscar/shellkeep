// =============================================================================
// Download tokens (issue #153)
// =============================================================================
//
// A token lets a browser's native download (a plain GET, no Authorization header) fetch one
// file: single use, 60 seconds, bound to user + organization + profile + path + size. Only the
// SHA-256 of a token is kept, so a heap dump holds no usable token. In memory: the API is a
// single instance (`check:single-instance`), and a restart voids the few tokens in flight.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const DOWNLOAD_TOKEN_TTL_MS = 60_000;
/** Pending tokens per user; the oldest is dropped beyond it. */
export const MAX_PENDING_TOKENS_PER_USER = 20;

export interface DownloadGrant {
  userId: string;
  orgId: string;
  serverProfileId: string;
  path: string;
  size: number;
}

interface StoredGrant extends DownloadGrant {
  expiresAt: number;
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class DownloadTokenStore {
  private readonly pending = new Map<string, StoredGrant>();

  /** The clock; a test replaces it. */
  now: () => number = Date.now;

  issue(grant: DownloadGrant): { token: string; expiresAt: Date } {
    this.sweep();
    const mine = [...this.pending.entries()].filter(([, g]) => g.userId === grant.userId);
    for (const [key] of mine.slice(0, Math.max(0, mine.length - MAX_PENDING_TOKENS_PER_USER + 1))) {
      this.pending.delete(key);
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + DOWNLOAD_TOKEN_TTL_MS;
    this.pending.set(digest(token), { userId: grant.userId, orgId: grant.orgId, serverProfileId: grant.serverProfileId, path: grant.path, size: grant.size, expiresAt });
    return { token, expiresAt: new Date(expiresAt) };
  }

  /** Returns the grant and deletes it, or `null` for an unknown, used or expired token. */
  consume(token: string): DownloadGrant | null {
    if (typeof token !== 'string' || token.length > 128) return null;
    const key = digest(token);
    const stored = this.pending.get(key);
    if (!stored) return null;
    this.pending.delete(key);
    if (stored.expiresAt <= this.now()) return null;
    return {
      userId: stored.userId,
      orgId: stored.orgId,
      serverProfileId: stored.serverProfileId,
      path: stored.path,
      size: stored.size,
    };
  }

  get size(): number {
    return this.pending.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, grant] of this.pending) {
      if (grant.expiresAt <= now) this.pending.delete(key);
    }
  }
}
