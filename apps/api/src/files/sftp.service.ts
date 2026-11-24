// =============================================================================
// SFTP over the shared SSH connection factory (issue #153)
// =============================================================================
//
// Every call opens its own connection through `SshConnectionFactory` (host key verified before
// any credential is sent), one SFTP session on it, and closes both in `finally`. A deadline
// destroys the connection when the server stops answering. A path goes to SFTP calls only,
// never into a command. No file content, path or credential reaches a log or a span.
// =============================================================================

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { Readable } from 'node:stream';

import { HostKeyError } from '../ssh/host-key.error';
import { SshConnectionFactory } from '../ssh/ssh-connection.factory';
import type { DecryptedServerProfile } from '../ssh/ssh-profile';
import { fileError } from './files-error';

const tracer = trace.getTracer('shellkeep.files');

const STATUS_NO_SUCH_FILE = 2;
const STATUS_PERMISSION_DENIED = 3;
export const MAX_LIST_ENTRIES = 5000;
const MAX_SYMLINKS_RESOLVED = 500;
const STREAM_CHUNK_BYTES = 64 * 1024;

export type FileKind = 'file' | 'dir' | 'symlink' | 'other';

export interface FileEntry {
  name: string;
  type: FileKind;
  size: number;
  /** ISO 8601. */
  mtime: string;
  /** Permission bits as octal, e.g. `0644`. */
  mode: string;
  /** The link's target for a symlink, else null. */
  symlinkTarget: string | null;
  /** What a symlink resolves to (`null` when broken); null for a non-link. */
  targetType: FileKind | null;
}

export function kindOf(stats: Pick<Stats, 'isFile' | 'isDirectory' | 'isSymbolicLink'>): FileKind {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  return 'other';
}

const octal = (mode: number): string => `0${(mode & 0o7777).toString(8).padStart(3, '0')}`;

function entryOf(name: string, lstats: Stats, link: { target: string | null; resolved: Stats | null | undefined }): FileEntry {
  const isLink = lstats.isSymbolicLink();
  const shown = isLink && link.resolved ? link.resolved : lstats;
  return {
    name,
    type: kindOf(lstats),
    size: shown.size,
    mtime: new Date(shown.mtime * 1000).toISOString(),
    mode: octal(shown.mode),
    symlinkTarget: isLink ? link.target : null,
    targetType: isLink ? (link.resolved ? kindOf(link.resolved) : null) : null,
  };
}

/** The SFTP calls the files API needs, over one open session. */
export class SftpSession {
  constructor(private readonly sftp: SFTPWrapper) {}

  private call<T>(fn: (done: (err: Error | undefined | null, value: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) =>
      fn((err, value) => (err ? reject(mapSftpError(err)) : resolve(value))),
    );
  }

  /** The login user's home directory. */
  home(): Promise<string> {
    return this.call<string>((done) => this.sftp.realpath('.', done));
  }

  stat(path: string): Promise<Stats> {
    return this.call<Stats>((done) => this.sftp.stat(path, done));
  }

  lstat(path: string): Promise<Stats> {
    return this.call<Stats>((done) => this.sftp.lstat(path, done));
  }

  readlink(path: string): Promise<string> {
    return this.call<string>((done) => this.sftp.readlink(path, done));
  }

  /** One entry as `list` would show it, for a path (a link is described, with its resolved target facts). */
  async describe(path: string, name: string): Promise<FileEntry> {
    const lstats = await this.lstat(path);
    if (!lstats.isSymbolicLink()) return entryOf(name, lstats, { target: null, resolved: null });
    const [target, resolved] = await Promise.all([
      this.readlink(path).catch(() => null),
      this.stat(path).catch(() => null),
    ]);
    return entryOf(name, lstats, { target, resolved });
  }

  /** The directory's entries, directories first, then by name. `truncated` when it held more than the cap. */
  async list(path: string): Promise<{ entries: FileEntry[]; truncated: boolean }> {
    const raw = await this.call<Array<{ filename: string; attrs: Stats }>>((done) =>
      this.sftp.readdir(path, done as never),
    );
    const named = raw.filter((e) => e.filename !== '.' && e.filename !== '..');
    const truncated = named.length > MAX_LIST_ENTRIES;
    const kept = named.slice(0, MAX_LIST_ENTRIES);
    const joined = (name: string): string => (path.endsWith('/') ? `${path}${name}` : `${path}/${name}`);

    const entries: FileEntry[] = new Array(kept.length);
    const links: number[] = [];
    kept.forEach((e, i) => {
      if (e.attrs.isSymbolicLink() && links.length < MAX_SYMLINKS_RESOLVED) links.push(i);
      else entries[i] = entryOf(e.filename, e.attrs, { target: null, resolved: null });
    });
    // Resolve links a few at a time: one readlink and one stat each.
    for (let at = 0; at < links.length; at += 8) {
      await Promise.all(
        links.slice(at, at + 8).map(async (i) => {
          const e = kept[i];
          const [target, resolved] = await Promise.all([
            this.readlink(joined(e.filename)).catch(() => null),
            this.stat(joined(e.filename)).catch(() => null),
          ]);
          entries[i] = entryOf(e.filename, e.attrs, { target, resolved });
        }),
      );
    }
    kept.forEach((e, i) => {
      entries[i] ??= entryOf(e.filename, e.attrs, { target: null, resolved: null });
    });

    const isDir = (e: FileEntry): boolean => e.type === 'dir' || e.targetType === 'dir';
    entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : 1));
    return { entries, truncated };
  }

  /** Reads bytes `[start, start + length)` into memory; the caller bounds `length` by the full-view cap. */
  readRange(path: string, start: number, length: number): Promise<Buffer> {
    if (length <= 0) return Promise.resolve(Buffer.alloc(0));
    return new Promise<Buffer>((resolve, reject) => {
      const stream = this.sftp.createReadStream(path, { start, end: start + length - 1, highWaterMark: STREAM_CHUNK_BYTES });
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > length) {
          stream.destroy();
          reject(fileError('SFTP_FAILED', 'The server returned more data than requested'));
        }
      });
      stream.on('error', (error: Error) => reject(mapSftpError(error)));
      stream.on('close', () => resolve(Buffer.concat(chunks)));
    });
  }

  /** A stream of the whole file. The caller owns it and the connection (see `SftpService.openDownload`). */
  createReadStream(path: string): Readable {
    return this.sftp.createReadStream(path, { highWaterMark: STREAM_CHUNK_BYTES });
  }

  end(): void {
    try {
      this.sftp.end();
    } catch {
      // already closed
    }
  }
}

/** Maps an SFTP or transport failure to a coded HTTP error. Nothing from the server's text is echoed. */
export function mapSftpError(error: unknown): Error {
  if (error instanceof HostKeyError) return error;
  if (error instanceof HttpException) return error;
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === STATUS_NO_SUCH_FILE) return fileError('FILE_NOT_FOUND', 'Nothing exists at that path');
  if (code === STATUS_PERMISSION_DENIED) return fileError('FILE_PERMISSION_DENIED', 'The server user may not read that path');
  const text = typeof message === 'string' ? message : '';
  if (/timed out|timeout/i.test(text)) return fileError('SFTP_TIMEOUT', 'The server did not answer in time');
  return fileError('SFTP_FAILED', 'The SFTP request failed');
}

export interface OpenedDownload {
  stream: Readable;
  size: number;
  /** Ends the SFTP session and the connection. Safe to call more than once. */
  close(): void;
}

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly factory: SshConnectionFactory) {}

  /** Opens SFTP on a verified connection. Failures are coded; a refused host key is a `HostKeyError`. */
  private async connect(profile: DecryptedServerProfile): Promise<{ client: Client; sftp: SftpSession }> {
    let client: Client;
    try {
      client = await this.factory.open(profile, { purpose: 'exec' });
    } catch (error) {
      if (error instanceof HostKeyError) throw error;
      this.logger.warn(`files.connect.failed profile=${profile.id}`);
      throw fileError('SFTP_FAILED', 'Could not connect to the server');
    }
    try {
      const wrapper = await new Promise<SFTPWrapper>((resolve, reject) =>
        client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
      );
      return { client, sftp: new SftpSession(wrapper) };
    } catch {
      this.destroy(client);
      throw fileError('SFTP_UNAVAILABLE', 'The server does not offer the SFTP subsystem');
    }
  }

  private destroy(client: Client): void {
    try {
      client.end();
      client.destroy();
    } catch {
      // already closed
    }
  }

  /**
   * Runs `fn` on one SFTP session and closes it. The deadline covers connect and `fn` together;
   * on expiry the connection is destroyed and the call fails with `SFTP_TIMEOUT`.
   */
  async withSession<T>(
    profile: DecryptedServerProfile,
    timeoutSeconds: number,
    operation: string,
    fn: (sftp: SftpSession) => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(`files.${operation}`, { attributes: { 'server_profile.id': profile.id } }, async (span) => {
      let client: Client | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            if (client) this.destroy(client);
            reject(fileError('SFTP_TIMEOUT', 'The server did not answer in time'));
          }, timeoutSeconds * 1000);
        });
        const work = (async () => {
          const opened = await this.connect(profile);
          client = opened.client;
          try {
            return await fn(opened.sftp);
          } finally {
            opened.sftp.end();
          }
        })();
        // Whichever loses must not become an unhandled rejection.
        work.catch(() => undefined);
        deadline.catch(() => undefined);
        const result = await Promise.race([work, deadline]);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        if (client) this.destroy(client);
        span.end();
      }
    });
  }

  /**
   * Opens the file for a streamed download. `check` sees the size first and may refuse (throw).
   * The stream is destroyed with an error when the server stays silent for `idleSeconds`. The
   * caller must call `close()` when the response ends or the client goes away.
   */
  async openDownload(
    profile: DecryptedServerProfile,
    path: string,
    idleSeconds: number,
    check: (size: number) => void,
  ): Promise<OpenedDownload> {
    const { client, sftp } = await this.connect(profile);
    let closed = false;
    let idle: NodeJS.Timeout | undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (idle) clearTimeout(idle);
      sftp.end();
      this.destroy(client);
    };
    try {
      const stats = await sftp.stat(path);
      if (!stats.isFile()) throw fileError('FILE_NOT_A_FILE', 'The path is not a regular file');
      check(stats.size);
      const stream = sftp.createReadStream(path);
      const arm = (): void => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => stream.destroy(fileError('SFTP_TIMEOUT', 'The server stopped sending data')), idleSeconds * 1000);
      };
      arm();
      stream.on('data', arm);
      stream.on('error', () => undefined);
      stream.once('close', close);
      stream.once('end', () => idle && clearTimeout(idle));
      return { stream, size: stats.size, close };
    } catch (error) {
      close();
      throw error;
    }
  }
}
