// =============================================================================
// Per-user limits for the files API (issue #153)
// =============================================================================
//
// A sliding window per user and bucket, plus a count of streams open at once. In memory: the API
// is a single instance (`check:single-instance`). Limits come from the `files` system settings
// on every call, so a change applies at once.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { fileError } from './files-error';

export type FilesBucket = 'content' | 'download' | 'upload' | 'history';

@Injectable()
export class FilesRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly open = new Map<string, number>();

  /** The clock; a test replaces it. */
  now: () => number = Date.now;

  /** Counts one request, or throws `FILES_RATE_LIMITED` (429) when the user is over `perMinute`. */
  hit(userId: string, bucket: FilesBucket, perMinute: number): void {
    const key = `${bucket}:${userId}`;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      this.hits.set(key, recent);
      const retryAfterSeconds = Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1000));
      throw fileError('FILES_RATE_LIMITED', 'Too many requests; retry shortly', { retryAfterSeconds });
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
  }

  /**
   * Takes a stream slot, or throws `FILES_RATE_LIMITED`. Call the returned function once to free it.
   * Downloads and uploads count their own slots (`kind`), each against `max`.
   */
  acquireStream(userId: string, max: number, kind: 'download' | 'upload' = 'download'): () => void {
    const key = kind === 'download' ? userId : `${kind}:${userId}`;
    const current = this.open.get(key) ?? 0;
    if (current >= max) {
      throw fileError('FILES_RATE_LIMITED', `Too many ${kind}s in progress; wait for one to finish`);
    }
    this.open.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.open.get(key) ?? 1) - 1;
      if (left <= 0) this.open.delete(key);
      else this.open.set(key, left);
    };
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= 60_000)) this.hits.delete(key);
    }
  }
}
