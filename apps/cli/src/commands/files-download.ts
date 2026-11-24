import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { UsageError } from '@marinoscar/platform-cli/commands';

import { CommandExit } from './exit.js';
import { type FilesDeps, Progress } from './files-http.js';

// Streaming a response body to a file  (issue #159)
//
// Shared by `files get` and `files archive`. The body goes through a byte counter into a
// temporary file next to the destination (`.<name>.shellkeep-<hex>.part`) and is renamed onto
// the destination only when it has arrived whole, so a reader never sees a half-written file
// and an interrupted download leaves nothing behind. Never buffered: memory is one chunk.

/** The last path segment of a remote path, or `undefined` when it has none (`~`, `/`, `..`). */
export function remoteBaseName(path: string): string | undefined {
  const trimmed = path.replace(/\/+$/, '');
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return name === '' || name === '~' || name === '.' || name === '..' ? undefined : name;
}

async function kind(path: string): Promise<'dir' | 'file' | 'none'> {
  try {
    return (await stat(path)).isDirectory() ? 'dir' : 'file';
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
    throw cause;
  }
}

/**
 * Where a download is written: `dest` when it is a file path, `dest/<name>` when it is a
 * directory, `<cwd>/<name>` when omitted.
 *
 * @param name - the file name to use inside a directory (the remote base name, or the archive's).
 * @throws UsageError when `dest` ends in a separator that is not a directory, its parent does
 *   not exist, or no name can be derived.
 */
export async function resolveDestination(deps: FilesDeps, dest: string | undefined, name: string | undefined): Promise<string> {
  const need = (): string => {
    if (name === undefined) throw new UsageError('cannot tell a file name from that path; give a destination file');
    return name;
  };
  if (dest === undefined) return resolve(deps.cwd(), need());
  const target = resolve(deps.cwd(), dest);
  const existing = await kind(target);
  if (existing === 'dir') return join(target, need());
  if (/[\\/]$/.test(dest)) throw new UsageError(`${dest} is not an existing directory`);
  if ((await kind(dirname(target))) !== 'dir') throw new UsageError(`the directory ${dirname(target)} does not exist`);
  return target;
}

/** Refuses an existing destination unless `force`. */
export async function assertWritable(destination: string, force: boolean): Promise<void> {
  if (!force && (await kind(destination)) !== 'none') throw new CommandExit(`${destination} already exists; use --force to replace it`, 1);
}

/**
 * Streams `response` to `destination` atomically.
 *
 * @param force - replace an existing file; without it an existing file is an error (checked
 *   before the transfer and again, atomically, at the end).
 * @param label - the progress line's prefix.
 * @returns the number of bytes written.
 * @throws CommandExit (1) when the file exists, or the body ends short of its Content-Length.
 */
export async function streamToFile(
  deps: FilesDeps,
  response: Response,
  destination: string,
  options: { force: boolean; label: string },
): Promise<number> {
  await assertWritable(destination, options.force);
  if (response.body === null) throw new CommandExit('the server sent no body', 1);

  const declared = response.headers.get('content-length');
  const total = declared !== null && /^\d+$/.test(declared) ? Number(declared) : undefined;
  const temp = join(dirname(destination), `.${basename(destination)}.shellkeep-${randomBytes(6).toString('hex')}.part`);
  const progress = new Progress(deps, options.label, total);
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      progress.update(received);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), counter, createWriteStream(temp, { flags: 'wx' }));
    if (total !== undefined && received !== total) throw new CommandExit(`the download ended after ${received} of ${total} bytes`, 1);
    await place(temp, destination, options.force);
    progress.finish(received);
    return received;
  } catch (error) {
    progress.abort();
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Moves the finished temp file onto the destination; without `force` never replaces anything. */
async function place(temp: string, destination: string, force: boolean): Promise<void> {
  if (force) {
    await rename(temp, destination);
    return;
  }
  try {
    await link(temp, destination);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new CommandExit(`${destination} already exists; use --force to replace it`, 1);
    // A file system without hard links: check, then rename.
    if ((await kind(destination)) !== 'none') throw new CommandExit(`${destination} already exists; use --force to replace it`, 1);
    await rename(temp, destination);
    return;
  }
  await unlink(temp);
}
