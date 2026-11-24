// =============================================================================
// Redacting a collected archive (issue #63)
// =============================================================================
//
// A `collect_logs` step receives a tar.gz built on the server. Every byte of it passes through
// `redactText` (the shared secret patterns plus every secret value of the run as an exact literal)
// BEFORE it is stored, exactly as `LogSink` does for a step's console output. A gzip stream cannot be
// redacted in place, so the archive is unpacked entry by entry, each file's text is redacted and the
// entries are packed again into a new tar.gz.
//
//   - Only regular files are kept: a directory, a link or a device entry in the received archive is
//     dropped (the script writes only plain files; anything else is not ours).
//   - An entry name is normalised to a flat relative name: no `./` prefix, no `..`, no leading `/`.
//   - One file is held in memory at a time. Its size is bounded by the step's `maxBytesPerFile`, and
//     the total unpacked size by `maxUnpackedBytes` (a gzip bomb stops the unpack, it is never stored).
//   - The file is decoded as UTF-8: a byte that is not valid UTF-8 becomes U+FFFD. Logs are text; a
//     binary file is not a log, and keeping its bytes intact would let a secret hide in it.
//
// The result carries the sha256 and size of the NEW archive and its entries (for the manifest).
// =============================================================================

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';

import * as tar from 'tar-stream';

import { redactText } from '../../../command-safety';

export class ArchiveTooLargeError extends Error {
  constructor(readonly what: 'file' | 'unpacked') {
    super(`the collected archive is too large (${what})`);
    this.name = 'ArchiveTooLargeError';
  }
}

export interface RedactedArchive {
  /** Regular files in the new archive. */
  files: number;
  /** Size of the new tar.gz in bytes. */
  sizeBytes: number;
  /** sha256 (hex) of the new tar.gz. */
  sha256: string;
  /** The entries, in archive order (names are flat and relative). */
  entries: { name: string; bytes: number }[];
}

export interface RedactTarOptions {
  /** Exact secret values to remove from every file. */
  secrets: readonly string[];
  /** Largest file (bytes) accepted. */
  maxFileBytes: number;
  /** Largest total of unpacked file bytes accepted. */
  maxUnpackedBytes: number;
}

/** `./a/../b` and `/etc/x` become `b` and `etc/x`; an empty result is `null` (the entry is dropped). */
export function flatEntryName(name: string): string | null {
  const parts = name.split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
  const flat = parts.join('/');
  return flat === '' ? null : flat;
}

async function readAll(stream: Readable, limit: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of stream) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buffer.length;
    if (size > limit) {
      stream.resume();
      throw new ArchiveTooLargeError('file');
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts);
}

/** Unpacks `inputPath`, redacts every file, and writes the new tar.gz to `outputPath`. */
export async function redactTarGz(inputPath: string, outputPath: string, options: RedactTarOptions): Promise<RedactedArchive> {
  const literals = options.secrets.filter((secret) => secret.length > 0);
  const entries: { name: string; bytes: number }[] = [];
  const pack = tar.pack();
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const written = pipeline(pack, createGzip(), counter, createWriteStream(outputPath, { mode: 0o600 }));

  const extract = tar.extract();
  const input = createReadStream(inputPath);
  const gunzip = createGunzip();
  let unpacked = 0;
  const seen = new Set<string>();
  const reading = (async () => {
    try {
      for await (const entry of walk(extract)) {
        const { header, stream, done } = entry;
        const name = header.type === 'file' ? flatEntryName(header.name) : null;
        if (name === null || seen.has(name)) {
          stream.resume();
          await done();
          continue;
        }
        const body = await readAll(stream, options.maxFileBytes);
        unpacked += body.length;
        if (unpacked > options.maxUnpackedBytes) throw new ArchiveTooLargeError('unpacked');
        const redacted = Buffer.from(redactText(body.toString('utf8'), { extraLiterals: [...literals] }).text, 'utf8');
        seen.add(name);
        entries.push({ name, bytes: redacted.length });
        await new Promise<void>((resolve, reject) => {
          pack.entry({ name, size: redacted.length, mode: 0o640, mtime: new Date(0), type: 'file' }, redacted, (error) => (error ? reject(error) : resolve()));
        });
        await done();
      }
      pack.finalize();
    } catch (error) {
      // Stop every stage: a stalled extractor would hold the whole settle forever.
      pack.destroy(error instanceof Error ? error : new Error('unpack failed'));
      input.destroy();
      gunzip.destroy();
      extract.destroy();
      throw error;
    }
  })();

  const source = pipeline(input, gunzip, extract);
  const results = await Promise.allSettled([source, reading, written]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    // An ArchiveTooLargeError is the informative one; surface it over a follow-on stream error.
    const tooLarge = results.find((r): r is PromiseRejectedResult => r.status === 'rejected' && r.reason instanceof ArchiveTooLargeError);
    throw tooLarge ? tooLarge.reason : failed.reason;
  }
  return { files: entries.length, sizeBytes, sha256: hash.digest('hex'), entries };
}

interface WalkedEntry {
  header: tar.Headers;
  stream: PassThrough & Readable;
  done: () => Promise<void>;
}

/** The extractor's entries as an async sequence; the consumer calls `done()` to ask for the next. */
async function* walk(extract: tar.Extract): AsyncGenerator<WalkedEntry> {
  const queue: Array<WalkedEntry | Error | null> = [];
  let wake: (() => void) | null = null;
  const push = (item: WalkedEntry | Error | null) => {
    queue.push(item);
    wake?.();
  };
  extract.on('entry', (header, stream, next) => push({ header, stream: stream as PassThrough & Readable, done: async () => next() }));
  extract.on('finish', () => push(null));
  extract.on('error', (error) => push(error));
  for (;;) {
    while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
    const item = queue.shift()!;
    if (item === null) return;
    if (item instanceof Error) throw item;
    yield item;
  }
}
