import { Injectable } from '@nestjs/common';

import { snippetError } from './snippets.error-codes';

export type SnippetsBucket = 'read' | 'write';

/**
 * A per-user sliding window, in memory (the API is a single instance: `check:single-instance`). The same
 * shape as the files limiter; reads and writes count separately.
 */
@Injectable()
export class SnippetsRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** The clock; a test replaces it. */
  now: () => number = Date.now;

  /** Counts one request, or throws `SNIPPETS_RATE_LIMITED` (429) when the user is over `perMinute`. */
  hit(userId: string, bucket: SnippetsBucket, perMinute: number): void {
    const key = `${bucket}:${userId}`;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      this.hits.set(key, recent);
      const retryAfterSeconds = Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1000));
      throw snippetError('SNIPPETS_RATE_LIMITED', 'Too many snippet requests; retry shortly', { retryAfterSeconds });
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= 60_000)) this.hits.delete(key);
    }
  }
}
