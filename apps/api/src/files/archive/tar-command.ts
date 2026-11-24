// =============================================================================
// The remote tar command of a folder archive (issue #158)
// =============================================================================
//
// THE ONLY PLACE A PATH BECOMES PART OF A COMMAND LINE. The path was resolved to an absolute POSIX path
// (NUL refused) and checked to be a directory over SFTP; here it is split into parent and base name and
// each is single-quoted: inside single quotes nothing is special to a POSIX shell, and a quote in the
// value is written `'\''` (close, escaped quote, reopen). `--` ends tar's options, so a name that starts
// with `-` is a file name. No other user string is ever interpolated.
//
//   tar -czf - -C '<parent>' -- '<base>'
// =============================================================================

import { posix } from 'node:path';

import { fileError } from '../files-error';

/** POSIX single-quote quoting: safe for any value except NUL (refused before), including quotes, spaces and newlines. */
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw fileError('FILE_PATH_INVALID', 'The path holds a NUL byte');
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The folder's parent and the entry name tar archives. The root archives `.` of `/`. */
export function splitArchivePath(path: string): { parent: string; base: string } {
  if (!path.startsWith('/')) throw fileError('FILE_PATH_INVALID', 'The archive path must be absolute');
  if (path === '/') return { parent: '/', base: '.' };
  return { parent: posix.dirname(path), base: posix.basename(path) };
}

/** The exec line for a folder: gzip-compressed tar on stdout. */
export function buildTarCommand(path: string): string {
  const { parent, base } = splitArchivePath(path);
  return `tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(base)}`;
}

/** The download file name: `<folder>.tar.gz`, `archive.tar.gz` for the root. */
export function archiveFileName(path: string): string {
  const { base } = splitArchivePath(path);
  return `${base === '.' ? 'archive' : base}.tar.gz`;
}
