// =============================================================================
// Building the zip bundle of a run (issue #63)
// =============================================================================
//
// `buildBundleZip` streams a list of files into ONE zip on disk (a platform temp file path the caller owns),
// with `archiver`. Nothing is buffered: each input is a stream, hashed and counted as it passes. The
// MANIFEST is appended last, once every file's sha256 and size are known, as `manifest.json`; it lists
// every other entry, so a recipient can verify the bundle without ShellKeep.
//
// Entry names are built from sanitised segments only (`safeSegment`): no `..`, no separators, no control
// characters, whatever a server or a runbook was called.
// =============================================================================

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { PassThrough, Transform, type Readable } from 'node:stream';

import archiver from 'archiver';

export interface BundleInput {
  /** The entry name inside the zip (forward slashes, safe segments). */
  path: string;
  /** Opens the bytes; called once, when the entry is reached. */
  open(): Promise<Readable>;
  /** An already compressed input (a tar.gz) is stored, not deflated again. */
  store?: boolean;
}

export interface BundleEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface BundleResult {
  sizeBytes: number;
  sha256: string;
  /** Every entry except `manifest.json`. */
  entries: BundleEntry[];
}

/** One path segment of a name a person chose: letters, digits, `.`, `_`, `-`; never `..`; at most `max` characters. */
export function safeSegment(value: string, max = 64): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, max);
  return cleaned === '' ? 'unnamed' : cleaned;
}

/**
 * Streams `inputs` into a zip at `outPath`, then appends `manifest.json` (the object `manifest(entries)`
 * returns, pretty printed). Resolves when the file is complete and closed.
 */
export async function buildBundleZip(inputs: readonly BundleInput[], manifest: (entries: BundleEntry[]) => unknown, outPath: string): Promise<BundleResult> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const out = createWriteStream(outPath, { mode: 0o600 });
  const zipHash = createHash('sha256');
  let sizeBytes = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      zipHash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('error', reject);
    counted.on('error', reject);
    out.on('error', reject);
    out.on('close', () => resolve());
  });
  // A failure that happens after the caller gave up (a destroyed file stream) must not be an unhandled rejection.
  finished.catch(() => undefined);
  archive.pipe(counted).pipe(out);

  const entries: BundleEntry[] = [];
  try {
    for (const input of inputs) {
      const source = await input.open();
      const hash = createHash('sha256');
      let bytes = 0;
      const tee = new PassThrough();
      source.on('data', (chunk: Buffer) => {
        hash.update(chunk);
        bytes += chunk.length;
      });
      source.on('error', (error) => tee.destroy(error));
      source.pipe(tee);
      const appended = new Promise<void>((resolve, reject) => {
        const onEntry = (entry: { name: string }): void => {
          if (entry.name !== input.path) return;
          archive.off('entry', onEntry);
          archive.off('error', reject);
          resolve();
        };
        archive.on('entry', onEntry);
        archive.once('error', reject);
        tee.once('error', reject);
      });
      archive.append(tee, { name: input.path, store: input.store === true });
      await appended;
      entries.push({ path: input.path, sha256: hash.digest('hex'), bytes });
    }
    archive.append(Buffer.from(`${JSON.stringify(manifest(entries), null, 2)}\n`, 'utf8'), { name: 'manifest.json' });
    await archive.finalize();
    await finished;
  } catch (error) {
    archive.abort();
    out.destroy();
    throw error;
  }
  return { sizeBytes, sha256: zipHash.digest('hex'), entries };
}
