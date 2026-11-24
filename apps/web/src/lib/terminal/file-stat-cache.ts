/**
 * The existence check behind terminal file links (issue #155): one `stat` per
 * (session, path), only when a line is hovered or a link is tapped, cached
 * briefly, deduplicated while in flight, and at most a few requests at once.
 * Terminal output is never scanned against the server in bulk.
 */

/** What a link needs to know about a path; `null` means "not there" (no link). */
export interface FileStatLike {
  /** The absolute path the API resolved. */
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  targetType?: 'file' | 'dir' | 'symlink' | 'other' | null;
  isText?: boolean;
}

export interface FileStatCacheOptions<T extends FileStatLike> {
  /** Asks the server. Throws (404, refused, network) when the path cannot be used. */
  stat: (path: string) => Promise<T>;
  /** How long an answer is kept, either way. Default 30 s. */
  ttlMs?: number;
  /** Requests allowed in flight at once; the rest wait in order. Default 3. */
  maxInFlight?: number;
  /** Answers kept at most (oldest dropped first). Default 500. */
  maxEntries?: number;
  now?: () => number;
}

export interface FileStatCache<T extends FileStatLike> {
  /** The answer for `path`: from the cache, the request already running, or a new one. */
  get: (sessionKey: string, path: string) => Promise<T | null>;
  /** The cached answer without asking: `undefined` when unknown or expired. */
  peek: (sessionKey: string, path: string) => T | null | undefined;
  clear: () => void;
}

export const FILE_STAT_TTL_MS = 30_000;
export const FILE_STAT_MAX_IN_FLIGHT = 3;

export function createFileStatCache<T extends FileStatLike>(options: FileStatCacheOptions<T>): FileStatCache<T> {
  const ttl = options.ttlMs ?? FILE_STAT_TTL_MS;
  const maxInFlight = Math.max(1, options.maxInFlight ?? FILE_STAT_MAX_IN_FLIGHT);
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? (() => Date.now());
  const answers = new Map<string, { value: T | null; at: number }>();
  const pending = new Map<string, Promise<T | null>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  const keyOf = (sessionKey: string, path: string) => `${sessionKey}\u0000${path}`;

  const release = () => {
    running -= 1;
    const next = waiting.shift();
    if (next) next();
  };

  const acquire = (): Promise<void> => {
    if (running < maxInFlight) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        running += 1;
        resolve();
      });
    });
  };

  const remember = (key: string, value: T | null) => {
    answers.delete(key);
    answers.set(key, { value, at: now() });
    while (answers.size > maxEntries) {
      const oldest = answers.keys().next().value;
      if (oldest === undefined) break;
      answers.delete(oldest);
    }
  };

  const peek = (sessionKey: string, path: string): T | null | undefined => {
    const key = keyOf(sessionKey, path);
    const hit = answers.get(key);
    if (!hit) return undefined;
    if (now() - hit.at >= ttl) {
      answers.delete(key);
      return undefined;
    }
    return hit.value;
  };

  const get = (sessionKey: string, path: string): Promise<T | null> => {
    const cached = peek(sessionKey, path);
    if (cached !== undefined) return Promise.resolve(cached);
    const key = keyOf(sessionKey, path);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = acquire()
      .then(() =>
        Promise.resolve()
          .then(() => options.stat(path))
          .finally(release),
      )
      .then(
        (value) => value,
        // Missing, refused or unreachable: no link, and no retry until the entry expires.
        () => null,
      )
      .then((value) => {
        pending.delete(key);
        remember(key, value);
        return value;
      });
    pending.set(key, request);
    return request;
  };

  return {
    get,
    peek,
    clear: () => {
      answers.clear();
    },
  };
}

/** The type a link acts on: a symlink counts as what it points to. */
export function effectiveFileType(stat: FileStatLike): 'file' | 'dir' | 'other' {
  const type = stat.type === 'symlink' ? (stat.targetType ?? 'other') : stat.type;
  if (type === 'file' || type === 'dir') return type;
  return 'other';
}
