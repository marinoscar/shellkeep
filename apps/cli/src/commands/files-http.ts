import { ApiClient, ApiError, NetworkError, buildUrl, resolveApiBaseUrl } from '@marinoscar/platform-cli/api-client';
import { UsageError } from '@marinoscar/platform-cli/commands';

import { loadCredentials } from '../credentials.js';

import { type CommandDeps, fetchAllPages } from './deps.js';
import { CommandExit } from './exit.js';

// The seams and helpers of the `files` commands  (issue #159)
//
// `ApiClient` reads JSON. A download, an upload and an archive fetch are streams, so they go
// through `deps.fetch` (an authenticated request relative to `/api`) and `deps.fetchUrl` (an
// absolute URL with NO credential: the archive's presigned storage link). The token is added
// inside the default implementation and is never returned, logged or put in an error message,
// and an error's URL is stripped of its query (a presigned link carries a signature).

/** What a raw request may carry. */
export interface FilesRequestInit {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

/** What the `files` commands reach outside themselves for; tests substitute them. */
export interface FilesDeps extends CommandDeps {
  /** An authenticated request to an API route (`path` is relative to `/api`). */
  fetch(path: string, init?: FilesRequestInit): Promise<Response>;
  /** A request to an absolute URL, sent WITHOUT the bearer token (a presigned storage link). */
  fetchUrl(url: string, init?: FilesRequestInit): Promise<Response>;
  /** Waits; a test makes it instant. */
  sleep(ms: number): Promise<void>;
  /** A monotonic clock in milliseconds. */
  now(): number;
  /** The working directory `dest` is resolved against. */
  cwd(): string;
  /** Whether stderr is a terminal: progress and dots are drawn only then. */
  isTty: boolean;
}

/** Builds the deps over a source of the API base URL (including `/api`) and token. */
export function filesDepsFor(credentials: () => { baseUrl: string; token: string }, overrides: Partial<FilesDeps> = {}): FilesDeps {
  const send = async (url: string, init: FilesRequestInit, token: string | undefined): Promise<Response> => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const request: RequestInit & { duplex?: 'half' } = { method: init.method ?? 'GET', headers };
    if (init.body !== undefined && init.body !== null) {
      request.body = init.body;
      request.duplex = 'half';
    }
    if (init.signal !== undefined) request.signal = init.signal;
    return fetch(url, request);
  };
  return {
    client: () => {
      const { baseUrl, token } = credentials();
      return new ApiClient({ baseUrl, token });
    },
    fetch: (path, init = {}) => {
      const { baseUrl, token } = credentials();
      return send(buildUrl(baseUrl, path, init.query), init, token);
    },
    fetchUrl: (url, init = {}) => send(url, init, undefined),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    cwd: () => process.cwd(),
    isTty: process.stderr.isTTY === true,
    stdout: process.stdout,
    stderr: process.stderr,
    ...overrides,
  };
}

/** The real thing: the stored login, real time and the process's streams. */
export function defaultFilesDeps(): FilesDeps {
  return filesDepsFor(() => {
    const { serverUrl, token } = loadCredentials();
    return { baseUrl: resolveApiBaseUrl(serverUrl), token };
  });
}

/** A URL without its query or fragment, safe to put in an error. */
export function redactUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Sends a raw request and returns the response only when it is a 2xx; any other answer is an
 * `ApiError` (exit 3, or 5 for a 401) and a transport failure a `NetworkError` (exit 4).
 */
export async function requestOk(deps: FilesDeps, target: { path: string } | { url: string }, init: FilesRequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const shown = 'path' in target ? `/api${target.path}` : redactUrl(target.url);
  let response: Response;
  try {
    response = 'path' in target ? await deps.fetch(target.path, init) : await deps.fetchUrl(target.url, init);
  } catch (cause) {
    if (init.signal?.aborted === true) throw cause;
    throw NetworkError.fromCause({ cause, method, url: shown, timeoutMs: 0, callerAborted: false });
  }
  if (response.ok) return response;
  const rawBody = await response.text().catch(() => '');
  throw ApiError.fromBody({ status: response.status, statusText: response.statusText, rawBody, method, url: shown });
}

/** Reads a 2xx JSON answer and unwraps the `{ data }` envelope. */
export async function readData<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (body !== null && typeof body === 'object' && 'data' in body) return (body as { data: T }).data;
  return body as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProfileRef {
  id: string;
  name: string;
}

/**
 * Resolves `<server>` to a profile id: a UUID is taken as the id; anything else is a profile
 * name (exact, then case-insensitive), looked up in the caller's profiles.
 *
 * @throws UsageError when no profile has that name or several do.
 */
export async function resolveServer(deps: CommandDeps, ref: string): Promise<string> {
  if (UUID.test(ref)) return ref;
  const profiles = await fetchAllPages<ProfileRef>(deps.client(), '/server-profiles');
  const exact = profiles.filter((profile) => profile.name === ref);
  const matches = exact.length > 0 ? exact : profiles.filter((profile) => profile.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1 && matches[0] !== undefined) return matches[0].id;
  if (matches.length === 0) throw new UsageError(`no server profile is named "${ref}" (see \`servers list\`)`);
  throw new UsageError(`"${ref}" names ${matches.length} server profiles; use one of these ids: ${matches.map((m) => m.id).join(', ')}`);
}

/** The API error code of a thrown value, when it is one. */
export function apiCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/**
 * Re-throws an API error with advice for the codes the files commands know, keeping the exit
 * code of an API error (3); anything else passes through untouched.
 */
export function withHint(error: unknown, hints: Record<string, string>): never {
  const code = apiCode(error);
  if (error instanceof ApiError && code !== undefined && hints[code] !== undefined) {
    throw new CommandExit(`${error.serverMessage} (${code}). ${hints[code]}`, error.exitCode);
  }
  throw error;
}

/** `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** A one-line progress meter on stderr; draws only on a terminal, at most every 100 ms. */
export class Progress {
  private last = Number.NEGATIVE_INFINITY;
  private drawn = false;

  constructor(
    private readonly deps: FilesDeps,
    private readonly label: string,
    private readonly total: number | undefined,
  ) {}

  update(done: number): void {
    if (!this.deps.isTty) return;
    const at = this.deps.now();
    if (at - this.last < 100) return;
    this.last = at;
    this.draw(done);
  }

  finish(done: number): void {
    if (!this.deps.isTty) return;
    this.draw(done);
    this.deps.stderr.write('\n');
    this.drawn = false;
  }

  /** Ends a half-drawn line before an error is printed. */
  abort(): void {
    if (this.deps.isTty && this.drawn) this.deps.stderr.write('\n');
    this.drawn = false;
  }

  private draw(done: number): void {
    this.drawn = true;
    const of = this.total !== undefined && this.total > 0 ? ` / ${formatBytes(this.total)} (${Math.min(100, Math.floor((done / this.total) * 100))}%)` : '';
    this.deps.stderr.write(`\r${this.label} ${formatBytes(done)}${of}   `);
  }
}

