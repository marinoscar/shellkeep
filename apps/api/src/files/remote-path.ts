// =============================================================================
// Remote path handling (issue #153)
// =============================================================================
//
// A client-supplied path is normalised here and then goes to SFTP and nowhere else:
// never into a shell command (the one exec that reads the pane's cwd uses the session's
// own tmux id, not a path). NUL bytes are refused; `..` is resolved lexically.
// =============================================================================

import { posix } from 'node:path';

import { fileError } from './files-error';

export const MAX_PATH_BYTES = 4096;

export interface PathBases {
  /** The shell's working directory (tmux `#{pane_current_path}`), when a session was named. */
  cwd?: string | null;
  /** The login user's home directory (SFTP `realpath('.')`). */
  home: string;
}

/**
 * Normalises `input` into an absolute POSIX path. `~` and `~/x` resolve against `home`; a
 * relative path against `cwd` when known, else `home`. Throws `FILE_PATH_INVALID`.
 */
export function resolveRemotePath(input: string, bases: PathBases): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw fileError('FILE_PATH_INVALID', 'A path is required');
  }
  if (input.includes('\0')) throw fileError('FILE_PATH_INVALID', 'The path holds a NUL byte');
  if (Buffer.byteLength(input, 'utf8') > MAX_PATH_BYTES) {
    throw fileError('FILE_PATH_INVALID', 'The path is too long');
  }
  const home = bases.home;
  const base = bases.cwd && bases.cwd.startsWith('/') ? bases.cwd : home;
  if (!home.startsWith('/') || !base.startsWith('/')) {
    throw fileError('FILE_PATH_INVALID', 'The server did not report an absolute home directory');
  }

  let absolute: string;
  if (input === '~') absolute = home;
  else if (input.startsWith('~/')) absolute = posix.join(home, input.slice(2));
  else if (input.startsWith('/')) absolute = input;
  else absolute = posix.join(base, input);

  const normalised = posix.normalize(absolute);
  // `posix.normalize` keeps a trailing slash; drop it except for the root.
  return normalised.length > 1 && normalised.endsWith('/') ? normalised.slice(0, -1) : normalised;
}

/** True when the path needs the home directory or the session's cwd to be resolved. */
export function needsBases(input: string): { home: boolean; cwd: boolean } {
  if (input === '~' || input.startsWith('~/')) return { home: true, cwd: false };
  if (input.startsWith('/')) return { home: false, cwd: false };
  return { home: true, cwd: true };
}

/** The last path segment, for `Content-Disposition`. */
export function baseName(path: string): string {
  return posix.basename(path) || 'download';
}
