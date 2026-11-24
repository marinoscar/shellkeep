/**
 * The file browser's pure helpers (issue #156, epic #151): paths and
 * breadcrumbs, the visible entries (hidden files, filter, sort), the size
 * guardrails a row shows, and the error text a listing failure gets.
 *
 * Remote paths are POSIX and absolute once the API resolved them; `~` and `.`
 * are only ever sent, never shown.
 */
import { ApiError } from '@marinoscar/platform-web/core';
import type { RemoteDirEntry } from '../../services/files-api';
import { DEFAULT_FILES_SYSTEM_SETTINGS } from './system-settings';

/** The columns the list sorts by. */
export type FileSortKey = 'name' | 'size' | 'mtime';
export type FileSortDirection = 'asc' | 'desc';
export interface FileSort {
  key: FileSortKey;
  direction: FileSortDirection;
}
export const DEFAULT_FILE_SORT: FileSort = { key: 'name', direction: 'asc' };

/** What a row acts as: a symlink counts as what it points to (a broken one as a file). */
export function entryKind(entry: Pick<RemoteDirEntry, 'type' | 'targetType'>): 'file' | 'dir' | 'other' {
  const type = entry.type === 'symlink' ? (entry.targetType ?? 'file') : entry.type;
  if (type === 'dir') return 'dir';
  if (type === 'other') return 'other';
  return 'file';
}

/** `dir` joined with `name`, without doubling the root's slash. */
export function joinRemotePath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** The parent of an absolute path (`/` stays `/`). */
export function parentRemotePath(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const at = trimmed.lastIndexOf('/');
  return at <= 0 ? '/' : trimmed.slice(0, at);
}

/** The last segment of a path (`''` for `/`). */
export function remoteBaseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export interface Breadcrumb {
  /** What the crumb shows: `/` for the root, else the segment. */
  label: string;
  path: string;
}

/** `/var/log/nginx` is `/`, `var`, `log`, `nginx`, each with its own absolute path. */
export function breadcrumbsOf(path: string): Breadcrumb[] {
  if (!path.startsWith('/')) return [{ label: path, path }];
  const crumbs: Breadcrumb[] = [{ label: '/', path: '/' }];
  let at = '';
  for (const segment of path.split('/').filter(Boolean)) {
    at = `${at}/${segment}`;
    crumbs.push({ label: segment, path: at });
  }
  return crumbs;
}

/** Dotfiles are hidden unless asked for. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/**
 * The rows to show: hidden files out unless `showHidden`, the filter (a
 * case-insensitive substring of the name), then sorted. Folders always come
 * first; within each group the chosen column decides, the name breaks ties.
 */
export function visibleEntries(
  entries: readonly RemoteDirEntry[],
  options: { showHidden: boolean; filter: string; sort: FileSort },
): RemoteDirEntry[] {
  const needle = options.filter.trim().toLowerCase();
  const kept = entries.filter(
    (e) => (options.showHidden || !isHiddenName(e.name)) && (!needle || e.name.toLowerCase().includes(needle)),
  );
  const sign = options.sort.direction === 'asc' ? 1 : -1;
  const byName = (a: RemoteDirEntry, b: RemoteDirEntry) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const time = (e: RemoteDirEntry) => {
    const t = Date.parse(e.mtime);
    return Number.isNaN(t) ? 0 : t;
  };
  return kept.sort((a, b) => {
    const folders = Number(entryKind(b) === 'dir') - Number(entryKind(a) === 'dir');
    if (folders) return folders;
    let by = 0;
    if (options.sort.key === 'size') by = a.size - b.size;
    else if (options.sort.key === 'mtime') by = time(a) - time(b);
    return sign * (by || byName(a, b));
  });
}

/** The caps the badges use: the files API's defaults (non-admins cannot read the settings). */
export interface FileSizeCaps {
  fullViewMaxBytes: number;
  pagedViewMaxBytes: number;
}
export const DEFAULT_FILE_SIZE_CAPS: FileSizeCaps = {
  fullViewMaxBytes: DEFAULT_FILES_SYSTEM_SETTINGS.fullViewMaxBytes,
  pagedViewMaxBytes: DEFAULT_FILES_SYSTEM_SETTINGS.pagedViewMaxBytes,
};

/**
 * A file's guardrail badge: `large` past the full-view cap (the viewer pages
 * it), `download-only` past the paged cap, else `null`. A hint only: the
 * viewer asks the API for the real answer when the file opens.
 */
export function sizeBadge(size: number, caps: FileSizeCaps = DEFAULT_FILE_SIZE_CAPS): 'large' | 'download-only' | null {
  if (size > caps.pagedViewMaxBytes) return 'download-only';
  if (size > caps.fullViewMaxBytes) return 'large';
  return null;
}

/** The icon family of a row. */
export type FileIconKind = 'folder' | 'folder-link' | 'link-broken' | 'image' | 'archive' | 'code' | 'text' | 'log' | 'other' | 'file';

const ARCHIVE = /\.(zip|tar|tgz|gz|bz2|xz|zst|7z|rar|tbz2|txz)$/;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/;
const CODE = /\.(c|cc|cpp|h|hpp|cs|go|java|js|jsx|ts|tsx|mjs|cjs|py|rb|rs|php|sh|bash|zsh|sql|kt|swift|lua|pl)$/;
const TEXT = /\.(md|txt|json|ya?ml|toml|ini|conf|cfg|xml|csv|env|properties)$|^(dockerfile|makefile|readme|license)$|^\.env/;
const LOG = /\.log(\.\d+)?$/;

export function fileIconKind(entry: Pick<RemoteDirEntry, 'name' | 'type' | 'targetType'>): FileIconKind {
  if (entry.type === 'symlink' && entry.targetType === null) return 'link-broken';
  const kind = entryKind(entry);
  if (kind === 'dir') return entry.type === 'symlink' ? 'folder-link' : 'folder';
  if (kind === 'other') return 'other';
  const name = entry.name.toLowerCase();
  if (IMAGE.test(name)) return 'image';
  if (ARCHIVE.test(name)) return 'archive';
  if (LOG.test(name)) return 'log';
  if (CODE.test(name)) return 'code';
  if (TEXT.test(name)) return 'text';
  return 'file';
}

/** The message a failed listing shows, by the files API's error code. */
export function listingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const byCode: Record<string, string> = {
      SFTP_UNAVAILABLE: 'This server does not offer SFTP, so its files cannot be browsed.',
      SFTP_TIMEOUT: 'The server took too long to answer. Try again.',
      SFTP_FAILED: 'The server could not list this folder.',
      FILE_PERMISSION_DENIED: 'Permission denied: the server user may not read this folder.',
      FILE_NOT_FOUND: 'This folder does not exist on the server.',
      FILE_NOT_A_DIRECTORY: 'This path is not a folder.',
      FILE_PATH_INVALID: 'The path is not valid.',
      FILES_RATE_LIMITED: 'Too many file requests. Wait a moment and try again.',
    };
    if (error.code && byCode[error.code]) return byCode[error.code]!;
    if (error.status === 404) return 'This server or session is not available to you.';
    return error.message || 'The folder could not be listed.';
  }
  return error instanceof Error && error.message ? error.message : 'The folder could not be listed.';
}

/** The code of a failed listing, when the API sent one. */
export function listingErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/**
 * Where "Show in file browser" lands for a path: a folder opens itself, a
 * file opens its folder with the file selected. A relative path (the API
 * could not resolve it) keeps its folder relative, so the listing resolves
 * it against the session's working directory.
 */
export function revealOf(path: string, type: 'file' | 'dir' | 'other'): { dir: string; select?: string } {
  if (type === 'dir') return { dir: path };
  const trimmed = path.replace(/\/+$/, '');
  const at = trimmed.lastIndexOf('/');
  const select = trimmed.slice(at + 1);
  if (at < 0) return { dir: '.', select };
  if (at === 0) return { dir: '/', select };
  return { dir: trimmed.slice(0, at), select };
}
